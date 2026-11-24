<?php
/**
 * Activates the stack's third-party plugins (FileBird, Visual Portfolio) unless they are active
 * already or hidden by a variant. Run by `dev/run up` and after every snapshot restore, through
 * `wp eval-file`. Never shipped.
 *
 * Arguments: <plugin slug> ...
 *
 * Why a script instead of `wp plugin activate`: one wp-cli call for every plugin keeps
 * `dev/run reset` fast, and a plugin that a variant hides (`filebird=off`, `vp=off`) must not be
 * activated for real, because that would run its activation hook (D17: FileBird's options are
 * never written by the stack).
 */

require_once ABSPATH . 'wp-admin/includes/plugin.php';

/**
 * The plugin file (`slug/main.php`) of an installed plugin, or null.
 *
 * @param string $slug Plugin directory name.
 * @return string|null
 */
function wpu_dev_plugin_file( $slug ) {
	foreach ( array_keys( get_plugins() ) as $plugin_file ) {
		if ( dirname( $plugin_file ) === $slug ) {
			return $plugin_file;
		}
	}
	return null;
}

foreach ( $args as $wpu_dev_slug ) {
	$wpu_dev_plugin_file = wpu_dev_plugin_file( $wpu_dev_slug );
	if ( null === $wpu_dev_plugin_file ) {
		WP_CLI::error( "The plugin '$wpu_dev_slug' isn't installed. Run `dev/run up` first." );
	}
	if ( wpu_dev_plugin_is_hidden( $wpu_dev_plugin_file ) ) {
		WP_CLI::log( "Plugin '$wpu_dev_slug' is hidden by a variant; leaving it as it is." );
		continue;
	}
	if ( is_plugin_active( $wpu_dev_plugin_file ) ) {
		continue;
	}
	$wpu_dev_result = activate_plugin( $wpu_dev_plugin_file );
	if ( is_wp_error( $wpu_dev_result ) ) {
		WP_CLI::error( $wpu_dev_result );
	}
	WP_CLI::log( "Plugin '$wpu_dev_slug' activated." );
}

// Visual Portfolio's activation hook asks for a welcome-screen redirect with a 30 s transient.
// Nobody visits wp-admin in between, and the transient's timestamp would make snapshots differ.
delete_transient( '_visual_portfolio_welcome_screen_activation_redirect' );
