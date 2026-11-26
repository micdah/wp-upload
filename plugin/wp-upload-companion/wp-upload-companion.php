<?php
/**
 * Plugin Name:       wp-upload companion
 * Description:       REST API for the wp-upload media manager: collection queries, folders over FileBird, batch metadata, trash, where-used and in-place image editing.
 * Version:           1.0.0-dev.5
 * Requires at least: 7.0
 * Requires PHP:      8.1
 * License:           MIT
 * Text Domain:       wp-upload-companion
 *
 * Works as a regular plugin and as a mu-plugin (implementation plan D12).
 * This entry file is owned by the orchestrator: tracks never change the
 * version constants (implementation plan §2.6).
 *
 * @package WpUpload\Companion
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// Release version (semver). Bumped by the orchestrator whenever shipped
// plugin source changes; plugin/scripts/check-version-bump.mjs enforces it.
const WPU_VERSION = '1.0.0-dev.5';

// Contract level (major.minor) of the wp-upload/v1 API
// (docs/media-manager/contracts/plugin-api.md §2).
const WPU_API = '1.0';

const WPU_MIN_PHP = '8.1';
const WPU_MIN_WP  = '7.0';
const WPU_FILE    = __FILE__;

// Below the minimums the plugin registers no routes, so the app shows its
// setup screen with an explanation (D27).
if ( version_compare( PHP_VERSION, WPU_MIN_PHP, '<' ) ) {
	error_log( sprintf( 'wp-upload companion: PHP %s is below the required %s; no routes registered.', PHP_VERSION, WPU_MIN_PHP ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	return;
}

// @build-strip-start
// Development autoloader for the multi-file source. The single-file build
// (plugin/scripts/build.mjs) inlines every class and drops this block.
spl_autoload_register(
	static function ( string $class_name ): void {
		$prefix = 'WpUpload\\Companion\\';
		if ( ! str_starts_with( $class_name, $prefix ) ) {
			return;
		}
		$relative = str_replace( '\\', '/', substr( $class_name, strlen( $prefix ) ) );
		$path     = __DIR__ . '/src/' . $relative . '.php';
		if ( is_readable( $path ) ) {
			require_once $path;
		}
	}
);
// @build-strip-end

add_action(
	'plugins_loaded',
	static function (): void {
		global $wp_version;
		if ( version_compare( $wp_version, WPU_MIN_WP, '<' ) ) {
			error_log( sprintf( 'wp-upload companion: WordPress %s is below the required %s; no routes registered.', $wp_version, WPU_MIN_WP ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
			return;
		}
		\WpUpload\Companion\Plugin::boot();
	}
);

// The uninstall callback is also recorded on activation, as WordPress advises:
// the activation request includes this file after `plugins_loaded`, so boot()
// doesn't run there, and a plugin activated and then deleted without a wp-admin
// or WP-CLI load in between (core's REST API: `/wp/v2/plugins`) would otherwise
// be deleted without dropping its tables and options (§9.4).
register_activation_hook(
	__FILE__,
	static function (): void {
		register_uninstall_hook( __FILE__, array( \WpUpload\Companion\Plugin::class, 'uninstall' ) );
	}
);
