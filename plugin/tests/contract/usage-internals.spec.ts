// PHP-level regression checks of the usage index (track P2): the backfill step that P1's
// maintenance route drives, and hook paths HTTP can't reach in one request. They run PHP
// inside WordPress through `dev/run wp eval`, so they need Docker on the host and are skipped
// inside the runner.

import { describe, expect, it, vi } from 'vitest'
import { wpEvalAvailable, wpEvalJson } from './support/variants.ts'

// biome-ignore lint/suspicious/noExplicitAny: JSON printed by the PHP checks.
type Json = any

/** Runs PHP in WordPress (`dev/run wp eval`) and returns the JSON it printed last. */
function php(code: string): Json {
  return wpEvalJson(PRELUDE + code)
}

const PRELUDE = `
use WpUpload\\Companion\\Index\\UsageIndex;
wp_set_current_user( 1 );
/** Runs backfill steps until nothing is left (at most 20). */
function p2_backfill() {
  $steps = array();
  for ( $i = 0; $i < 20; $i++ ) {
    $step = UsageIndex::step( microtime( true ) + 10 );
    $steps[] = $step;
    if ( ! $step['more'] ) { break; }
  }
  return $steps;
}
function p2_rows( $source ) {
  global $wpdb;
  return $wpdb->get_results( $wpdb->prepare( 'SELECT attachment_id, context FROM ' . UsageIndex::usage_table() . ' WHERE source_id = %d ORDER BY attachment_id, context', $source ), ARRAY_A );
}
function p2_image_ids( $count ) {
  return get_posts( array( 'post_type' => 'attachment', 'post_mime_type' => 'image/jpeg', 'posts_per_page' => $count, 'fields' => 'ids', 'orderby' => 'ID', 'order' => 'ASC' ) );
}
`

const runnable = wpEvalAvailable

vi.setConfig({ testTimeout: 120_000 })

describe.skipIf(!runnable)('usage index internals', () => {
  it('ends a reconcile pass whose last batch was full, or that found no post (finding 5)', () => {
    const result = php(`
      p2_backfill();
      UsageIndex::mark_stale();
      // A cursor past every post: the pass has nothing left, as after a full last batch.
      $state = UsageIndex::state();
      $state['cursor'] = PHP_INT_MAX;
      update_option( UsageIndex::STATE_OPTION, $state );
      $steps = p2_backfill();
      $final = UsageIndex::state();
      echo wp_json_encode( array( 'steps' => count( $steps ), 'more' => end( $steps )['more'], 'state' => $final['state'], 'cursor' => $final['cursor'] ) );
    `)
    expect(result).toMatchObject({ more: false, state: 'ready', cursor: null })
    expect(result.steps).toBeLessThanOrEqual(2)
  })

  it('doesn’t rescan a future-dated post forever, nor call the index stale for it (finding 6)', () => {
    const result = php(`
      $image = p2_image_ids( 1 )[0];
      $post = wp_insert_post( array(
        'post_type' => 'post', 'post_status' => 'future', 'post_title' => 'P2 future post',
        'post_date' => '2030-01-01 10:00:00', 'post_date_gmt' => '2030-01-01 10:00:00',
        'post_content' => '<!-- wp:image {"id":' . $image . '} --><figure class="wp-block-image"><img class="wp-image-' . $image . '"/></figure><!-- /wp:image -->',
      ) );
      p2_backfill();
      $again = UsageIndex::step( microtime( true ) + 10 );
      UsageIndex::check_consistency( false );
      $state = UsageIndex::state()['state'];
      $rows = p2_rows( $post );
      wp_delete_post( $post, true );
      echo wp_json_encode( array( 'did' => $again['did'], 'more' => $again['more'], 'state' => $state, 'rows' => count( $rows ) ) );
    `)
    expect(result).toEqual({ did: 0, more: false, state: 'ready', rows: 1 })
  })

  it('sees a saved layout’s vp_images written later in the same request (finding 7)', () => {
    const result = php(`
      if ( ! UsageIndex::visual_portfolio_active() ) { echo wp_json_encode( array( 'skip' => true ) ); return; }
      [ $a, $b ] = p2_image_ids( 2 );
      $layout = wp_insert_post( array( 'post_type' => 'vp_lists', 'post_status' => 'publish', 'post_title' => 'P2 layout' ) );
      update_post_meta( $layout, 'vp_content_source', 'images' );
      update_post_meta( $layout, 'vp_images', array( array( 'id' => $a ) ) );
      $post = wp_insert_post( array( 'post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'P2 layout user',
        'post_content' => '<!-- wp:visual-portfolio/saved {"id":"' . $layout . '"} /-->' ) );
      update_post_meta( $layout, 'vp_images', array( array( 'id' => $a ), array( 'id' => $b ) ) );
      $ids = array_map( 'intval', wp_list_pluck( p2_rows( $post ), 'attachment_id' ) );
      wp_delete_post( $post, true );
      wp_delete_post( $layout, true );
      echo wp_json_encode( array( 'ids' => $ids, 'expected' => array( $a, $b ) ) );
    `)
    if (result.skip) return
    expect(result.ids).toEqual(result.expected)
  })

  it('rescans the site slots after a stale mark, and sees a first theme mod (finding 12)', () => {
    const result = php(`
      global $wpdb;
      p2_backfill();
      UsageIndex::mark_stale();
      $version = (int) $wpdb->get_var( 'SELECT row_version FROM ' . UsageIndex::sources_table() . ' WHERE source_id = 0' );
      p2_backfill();
      $rescanned = (int) $wpdb->get_var( 'SELECT row_version FROM ' . UsageIndex::sources_table() . ' WHERE source_id = 0' );

      // The first set_theme_mod() for a theme adds its option (added_option, not updated_option).
      $logo = get_option( 'site_logo' );
      $mods_name = 'theme_mods_' . get_option( 'stylesheet' );
      $mods = get_option( $mods_name );
      delete_option( 'site_logo' );
      delete_option( $mods_name );
      $image = p2_image_ids( 3 )[2];
      set_theme_mod( 'custom_logo', $image );
      $site = p2_rows( 0 );
      // Put the site back as it was.
      delete_option( $mods_name );
      if ( false !== $mods ) { add_option( $mods_name, $mods ); }
      if ( false !== $logo ) { add_option( 'site_logo', $logo ); }
      echo wp_json_encode( array( 'staleVersion' => $version, 'rescanned' => $rescanned, 'logo' => $image, 'site' => $site ) );
    `)
    expect(result.staleVersion).toBe(0)
    expect(result.rescanned).toBeGreaterThan(0)
    expect(result.site).toContainEqual({
      attachment_id: String(result.logo),
      context: 'site-logo',
    })
  })
})
