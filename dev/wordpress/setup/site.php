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

update_option( 'wpu_dev_variant', wpu_dev_default_variant() );

WP_CLI::success( 'Site settings applied.' );
