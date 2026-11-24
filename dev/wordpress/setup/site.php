<?php
/**
 * One-time site settings after `wp core install`. Run by `dev/run up` through `wp eval-file`.
 * Never shipped.
 *
 * Why: a fixed, minimal baseline (UTC, pretty permalinks, no sample content, default variants)
 * makes the `base` snapshot, and every seed taken from it, deterministic.
 */

update_option( 'blogdescription', 'wp-upload dev stack' );
update_option( 'timezone_string', 'UTC' );
update_option( 'gmt_offset', 0 );
update_option( 'date_format', 'Y-m-d' );
update_option( 'time_format', 'H:i' );
update_option( 'uploads_use_yearmonth_folders', 1 );
update_option( 'permalink_structure', '/%postname%/' );
flush_rewrite_rules( false );

// The sample post, page and comment would only add noise to the media and usage data.
foreach ( get_posts(
	array(
		'post_type'   => array( 'post', 'page' ),
		'post_status' => 'any',
		'numberposts' => -1,
		'fields'      => 'ids',
	)
) as $sample_post_id ) {
	wp_delete_post( $sample_post_id, true );
}
foreach ( get_comments( array( 'fields' => 'ids' ) ) as $sample_comment_id ) {
	wp_delete_comment( $sample_comment_id, true );
}

// The block theme creates a fallback navigation menu (a `wp_navigation` post) the first time
// it renders a page. In `test` mode the installer's pretty-permalink loopback renders one, in
// `dev` mode (no working loopback) nothing does. Create it here in both modes, with a fixed
// date, so both modes get the same post ids and nothing appears later during a test.
if ( class_exists( 'WP_Navigation_Fallback' ) ) {
	WP_Navigation_Fallback::get_fallback();
	$wpu_dev_navigation_ids = get_posts(
		array(
			'post_type'   => 'wp_navigation',
			'post_status' => 'any',
			'numberposts' => -1,
			'fields'      => 'ids',
		)
	);
	wpu_dev_fix_post_dates( $wpu_dev_navigation_ids );
	// Its guid is a dated permalink of "now"; use the plain form instead.
	foreach ( $wpu_dev_navigation_ids as $wpu_dev_navigation_id ) {
		$GLOBALS['wpdb']->update(
			$GLOBALS['wpdb']->posts,
			array( 'guid' => home_url( '/?p=' . $wpu_dev_navigation_id ) ),
			array( 'ID' => $wpu_dev_navigation_id )
		);
	}
}

update_option( 'wpu_dev_variant', wpu_dev_default_variant() );

WP_CLI::success( 'Site settings applied.' );
