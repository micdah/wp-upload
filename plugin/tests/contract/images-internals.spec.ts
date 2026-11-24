// PHP-level regression checks of the image engine (track P2): failure paths that HTTP can't
// provoke (an editor that can't load, a missing backup, a failed replace) and the locking and
// file helpers. They run PHP inside WordPress through `dev/run wp eval`, so they need Docker
// on the host and are skipped inside the runner.

import { describe, expect, it, vi } from 'vitest'
import { wpEvalAvailable, wpEvalJson } from './support/variants.ts'

// Response bodies are checked field by field.
// biome-ignore lint/suspicious/noExplicitAny: JSON printed by the PHP checks.
type Json = any

/** Runs PHP in WordPress (`dev/run wp eval`) and returns the JSON it printed last. */
function php(code: string): Json {
  return wpEvalJson(PRELUDE + code)
}

// Shared PHP: the engine's classes, an admin user, and a fresh JPEG attachment to work on.
const PRELUDE = `
use WpUpload\\Companion\\Images\\Engine;
use WpUpload\\Companion\\Images\\EditStack;
use WpUpload\\Companion\\Images\\Files;
use WpUpload\\Companion\\Mutation\\OptionLock;
require_once ABSPATH . 'wp-admin/includes/image.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/image-edit.php';
wp_set_current_user( 1 );
function p2_jpeg_copy( $name ) {
  foreach ( get_posts( array( 'post_type' => 'attachment', 'post_mime_type' => 'image/jpeg', 'posts_per_page' => 50, 'fields' => 'ids', 'orderby' => 'ID', 'order' => 'ASC' ) ) as $source ) {
    $meta = wp_get_attachment_metadata( $source );
    if ( empty( $meta['original_image'] ) && ( $meta['width'] ?? 0 ) >= 600 ) {
      $tmp = wp_tempnam( $name );
      copy( get_attached_file( $source ), $tmp );
      return media_handle_sideload( array( 'name' => $name, 'tmp_name' => $tmp ), 0 );
    }
  }
  return 0;
}
function p2_files( $id ) {
  $dir = dirname( get_attached_file( $id ) );
  $out = array();
  foreach ( Files::of_meta( wp_get_attachment_metadata( $id ) ) as $name ) {
    $out[ $name ] = is_file( "$dir/$name" ) ? md5_file( "$dir/$name" ) : null;
  }
  return $out;
}
`

const runnable = wpEvalAvailable

// wp-cli starts a container per call, and the engine makes every sub-size.
vi.setConfig({ testTimeout: 120_000 })

describe.skipIf(!runnable)('image engine internals', () => {
  it('keeps the undo stack and the original when a replace fails (finding 1)', () => {
    const result = php(`
      $id = p2_jpeg_copy( 'p2-replace-fail.jpg' );
      $before = md5_file( get_attached_file( $id ) );
      Engine::edit( $id, array( array( 'op' => 'flipH' ) ), null, 'all' );
      $bad = wp_tempnam( 'bad.jpg' );
      file_put_contents( $bad, 'not an image' );
      $replace = Engine::replace( $id, $bad );
      $state = Engine::state( $id );
      $stack = count( EditStack::get( $id ) );
      $restore = Engine::restore( $id );
      echo wp_json_encode( array(
        'replaceError' => is_wp_error( $replace ) ? $replace->get_error_code() : null,
        'state' => $state,
        'stack' => $stack,
        'restored' => ! is_wp_error( $restore ) && md5_file( get_attached_file( $id ) ) === $before,
      ) );
      wp_delete_attachment( $id, true );
    `)
    expect(result.replaceError).toBe('wpu_image_error')
    expect(result.state).toMatchObject({ undoable: true, restorable: true })
    expect(result.stack).toBe(1)
    expect(result.restored).toBe(true)
  })

  it('answers an error and keeps every size when the editor can’t load (finding 2)', () => {
    const result = php(`
      $id = p2_jpeg_copy( 'p2-regenerate-fail.jpg' );
      $files = p2_files( $id );
      add_filter( 'wp_image_editors', '__return_empty_array', 999 );
      $regenerate = Engine::regenerate( $id );
      remove_all_filters( 'wp_image_editors' );
      echo wp_json_encode( array(
        'error' => is_wp_error( $regenerate ) ? $regenerate->get_error_code() : null,
        'status' => is_wp_error( $regenerate ) ? $regenerate->get_error_data()['status'] : null,
        'same' => p2_files( $id ) === $files,
        'sizes' => count( $files ),
      ) );
      wp_delete_attachment( $id, true );
    `)
    expect(result.error).toBe('wpu_image_error')
    expect(result.status).toBe(500)
    expect(result.sizes).toBeGreaterThan(1)
    expect(result.same).toBe(true)
  })

  it('never writes sub-sizes in place while regenerating (finding 3)', () => {
    const result = php(`
      $id = p2_jpeg_copy( 'p2-regenerate-inodes.jpg' );
      $dir = dirname( get_attached_file( $id ) );
      $meta = wp_get_attachment_metadata( $id );
      $thumb = $dir . '/' . $meta['sizes']['thumbnail']['file'];
      link( $thumb, $thumb . '.p2-link' );
      $linked = md5_file( $thumb . '.p2-link' );
      Engine::regenerate( $id );
      clearstatcache();
      echo wp_json_encode( array(
        'linkUnchanged' => md5_file( $thumb . '.p2-link' ) === $linked,
        'newInode' => fileinode( $thumb ) !== fileinode( $thumb . '.p2-link' ),
      ) );
      unlink( $thumb . '.p2-link' );
      wp_delete_attachment( $id, true );
    `)
    expect(result).toEqual({ linkUnchanged: true, newInode: true })
  })

  it('refuses a PDF regenerate the site can’t render and keeps its previews (finding 4)', () => {
    const result = php(`
      $pdf = get_posts( array( 'post_type' => 'attachment', 'post_mime_type' => 'application/pdf', 'posts_per_page' => 1, 'fields' => 'ids' ) );
      if ( ! $pdf ) { echo wp_json_encode( array( 'skip' => true ) ); return; }
      $id = $pdf[0];
      $meta = wp_get_attachment_metadata( $id );
      $files = p2_files( $id );
      add_filter( 'wp_image_editors', '__return_empty_array', 999 );
      $regenerate = Engine::regenerate( $id );
      remove_all_filters( 'wp_image_editors' );
      echo wp_json_encode( array(
        'error' => is_wp_error( $regenerate ) ? $regenerate->get_error_code() : null,
        'status' => is_wp_error( $regenerate ) ? $regenerate->get_error_data()['status'] : null,
        'metaSame' => wp_get_attachment_metadata( $id ) === $meta,
        'filesSame' => p2_files( $id ) === $files,
      ) );
    `)
    if (result.skip) return
    expect(result).toEqual({
      error: 'wpu_unsupported_type',
      status: 415,
      metaSame: true,
      filesSame: true,
    })
  })

  it('takes the item lock atomically and releases only its own (finding 8)', () => {
    const result = php(`
      global $wpdb;
      $key = 'wpu_p2_test_lock';
      $wpdb->delete( $wpdb->options, array( 'option_name' => $key ) );
      $first = OptionLock::acquire( $key, 60 );
      $second = OptionLock::acquire( $key, 60 );
      // Expire it: another request may now take it over.
      $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s", '1:old', $key ) );
      $takeover = OptionLock::acquire( $key, 60 );
      // A lock taken over by someone else is never released by us.
      $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s", '9999999999:someone-else', $key ) );
      OptionLock::release( $key );
      $kept = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $key ) );
      $wpdb->delete( $wpdb->options, array( 'option_name' => $key ) );
      echo wp_json_encode( compact( 'first', 'second', 'takeover', 'kept' ) );
    `)
    expect(result).toEqual({
      first: true,
      second: false,
      takeover: true,
      kept: '9999999999:someone-else',
    })
  })

  it('copies over a file without writing through its hard links (finding 9)', () => {
    const result = php(`
      $dir = get_temp_dir();
      file_put_contents( "$dir/p2-target", 'old' );
      @unlink( "$dir/p2-backup" );
      link( "$dir/p2-target", "$dir/p2-backup" );
      file_put_contents( "$dir/p2-source", 'new' );
      $ok = Files::copy_replace( "$dir/p2-source", "$dir/p2-target" );
      echo wp_json_encode( array( 'ok' => $ok, 'target' => file_get_contents( "$dir/p2-target" ), 'backup' => file_get_contents( "$dir/p2-backup" ) ) );
      foreach ( array( 'p2-target', 'p2-backup', 'p2-source' ) as $name ) { @unlink( "$dir/$name" ); }
    `)
    expect(result).toEqual({ ok: true, target: 'new', backup: 'old' })
  })

  it('refuses an undo whose backup is missing and keeps the stack (finding 10)', () => {
    const result = php(`
      $id = p2_jpeg_copy( 'p2-undo-missing.jpg' );
      Engine::edit( $id, array( array( 'op' => 'rotate', 'angle' => 90 ) ), null, 'all' );
      $stack = EditStack::get( $id );
      $dir = dirname( get_attached_file( $id ) );
      $saved = $stack[0]['saved'];
      unlink( $dir . '/' . reset( $saved ) );
      $undo = Engine::undo( $id );
      echo wp_json_encode( array(
        'error' => is_wp_error( $undo ) ? $undo->get_error_code() : null,
        'stack' => count( EditStack::get( $id ) ),
        'width' => wp_get_attachment_metadata( $id )['width'],
        'rotatedWidth' => $stack[0]['after']['width'],
      ) );
      wp_delete_attachment( $id, true );
    `)
    expect(result.error).toBe('wpu_io_error')
    expect(result.stack).toBe(1)
    expect(result.width).toBe(result.rotatedWidth)
  })

  it('treats a wp-admin thumbnail-only edit as a change that ends the undo stack (finding 11)', () => {
    const result = php(`
      $id = p2_jpeg_copy( 'p2-admin-thumb.jpg' );
      Engine::edit( $id, array( array( 'op' => 'flipH' ) ), null, 'all' );
      $before = Engine::state( $id )['undoable'];
      add_filter( 'image_edit_thumbnails_separately', '__return_true' );
      $_REQUEST['history'] = wp_json_encode( array( array( 'r' => 90 ) ) );
      $_REQUEST['target'] = 'thumbnail';
      $_REQUEST['do'] = 'save';
      wp_save_image( $id );
      echo wp_json_encode( array( 'before' => $before, 'after' => Engine::state( $id )['undoable'] ) );
      wp_delete_attachment( $id, true );
    `)
    expect(result).toEqual({ before: true, after: false })
  })
})
