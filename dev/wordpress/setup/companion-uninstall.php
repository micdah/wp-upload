<?php
/**
 * Removes every trace of the companion plugin from the database, as its uninstall hook would
 * (contract plugin-api.md §9.4), without running any of its code. Run by `dev/run test
 * plugin-contract` before the runs against the oldest supported build and the mu-plugins
 * install, so each starts like a site that never had the plugin. Never shipped.
 *
 * - deactivates it silently (no deactivation hook), so `active_plugins` doesn't point at it;
 * - drops its tables (`{prefix}wpu_*`: `wpu_media_index`, `wpu_usage`, `wpu_usage_sources` and
 *   any later ones);
 * - deletes its options and transients (`wpu_*`, except the dev stack's own `wpu_dev_*`) and its
 *   post meta (`_wpu_*`, e.g. `_wpu_edit_backups`).
 *
 * The plugin's files are handled by dev/run (install_companion_build).
 */

require_once ABSPATH . 'wp-admin/includes/plugin.php';

global $wpdb;

deactivate_plugins( 'wp-upload-companion/wp-upload-companion.php', true );

$wpu_dev_like_tables = $wpdb->esc_like( $wpdb->prefix . 'wpu_' ) . '%';
// phpcs:ignore WordPress.DB.DirectDatabaseQuery
$wpu_dev_tables = $wpdb->get_col( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpu_dev_like_tables ) );
foreach ( $wpu_dev_tables as $wpu_dev_table ) {
	// The name comes from SHOW TABLES and matches the plugin's prefix; identifiers can't be
	// bound as parameters.
	$wpdb->query( 'DROP TABLE IF EXISTS `' . str_replace( '`', '', $wpu_dev_table ) . '`' ); // phpcs:ignore
}

// phpcs:disable WordPress.DB.DirectDatabaseQuery
$wpu_dev_deleted_options = $wpdb->query(
	$wpdb->prepare(
		"DELETE FROM {$wpdb->options}
		WHERE ( option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s )
		AND option_name NOT LIKE %s",
		$wpdb->esc_like( 'wpu_' ) . '%',
		$wpdb->esc_like( '_transient_wpu_' ) . '%',
		$wpdb->esc_like( '_transient_timeout_wpu_' ) . '%',
		$wpdb->esc_like( 'wpu_dev_' ) . '%'
	)
);
$wpu_dev_deleted_meta    = $wpdb->query(
	$wpdb->prepare( "DELETE FROM {$wpdb->postmeta} WHERE meta_key LIKE %s", $wpdb->esc_like( '_wpu_' ) . '%' )
);
// phpcs:enable WordPress.DB.DirectDatabaseQuery
wp_cache_flush();

WP_CLI::log(
	sprintf(
		'Companion plugin state removed: %d tables, %d options, %d post meta rows.',
		count( $wpu_dev_tables ),
		(int) $wpu_dev_deleted_options,
		(int) $wpu_dev_deleted_meta
	)
);
