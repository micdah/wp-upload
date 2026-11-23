<?php
/**
 * Plugin Name: wp-upload dev variants
 * Description: Dev/test-stack switches for the media manager (implementation plan §5.3). Mounted by dev/compose.yml only. Never shipped.
 *
 * Variants live in one option, so a DB snapshot restore also restores them, and every switch
 * takes effect on the next request without a restart:
 *
 *   trash=on|off      MEDIA_TRASH (defined in dev/wordpress/wp-config-extra.php from this
 *                     option, because WordPress defines it before mu-plugins load)
 *   filebird=on|off   hides FileBird from the active plugins (its data stays untouched)
 *   peruser=on|off    answers FileBird's per-user-folders setting
 *   role=editor|author switches the one app user's role
 *
 * Drive it with `dev/run variant ...` (which calls `wp wpu-dev variant ...`).
 *
 * FileBird itself is never modified (D17): no writes to its tables or options. Per-user mode is
 * answered through a `pre_option_` filter, and "FileBird off" filters `active_plugins`.
 */

defined( 'ABSPATH' ) || exit;

const WPU_DEV_VARIANT_OPTION  = 'wpu_dev_variant';
const WPU_DEV_APP_USER_OPTION = 'wpu_dev_app_user';
const WPU_DEV_FILEBIRD_PLUGIN = 'filebird/filebird.php';

/**
 * The default state every snapshot is taken in.
 *
 * @return array<string, string>
 */
function wpu_dev_default_variant() {
	return array(
		'trash'    => 'off',
		'filebird' => 'on',
		'peruser'  => 'off',
	);
}

/**
 * The current switches. Falls back to the defaults while WordPress is being installed, when
 * the options table doesn't exist yet.
 *
 * @return array<string, string>
 */
function wpu_dev_variant() {
	$defaults = wpu_dev_default_variant();
	if ( wp_installing() ) {
		return $defaults;
	}
	$stored = get_option( WPU_DEV_VARIANT_OPTION, array() );
	if ( ! is_array( $stored ) ) {
		$stored = array();
	}
	return array_merge( $defaults, array_intersect_key( $stored, $defaults ) );
}

/**
 * "FileBird off": WordPress loads only the plugins this filter returns, and is_plugin_active()
 * reads the same option, so FileBird behaves exactly as if deactivated. Its tables stay as
 * they are.
 */
add_filter(
	'option_active_plugins',
	function ( $plugins ) {
		if ( 'off' !== wpu_dev_variant()['filebird'] || ! is_array( $plugins ) ) {
			return $plugins;
		}
		return array_values( array_diff( $plugins, array( WPU_DEV_FILEBIRD_PLUGIN ) ) );
	}
);

/**
 * Activating another plugin while FileBird is hidden saves the filtered list. Put FileBird back
 * in what is stored when it was active, so "filebird=off" never deactivates it for real.
 */
add_filter(
	'pre_update_option_active_plugins',
	function ( $new_value ) {
		if ( 'off' !== wpu_dev_variant()['filebird'] || ! is_array( $new_value ) ) {
			return $new_value;
		}
		global $wpdb;
		$stored_raw = $wpdb->get_var(
			$wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", 'active_plugins' )
		);
		$stored     = maybe_unserialize( $stored_raw );
		$was_active = is_array( $stored ) && in_array( WPU_DEV_FILEBIRD_PLUGIN, $stored, true );
		if ( $was_active && ! in_array( WPU_DEV_FILEBIRD_PLUGIN, $new_value, true ) ) {
			$new_value[] = WPU_DEV_FILEBIRD_PLUGIN;
		}
		return $new_value;
	}
);

/**
 * FileBird's per-user folder mode ('1' = each user has their own tree). Answered here so that
 * FileBird's own option is never written.
 */
add_filter(
	'pre_option_njt_fbv_folder_per_user',
	function () {
		return 'on' === wpu_dev_variant()['peruser'] ? '1' : '0';
	}
);

/**
 * `test` mode: the WordPress HTTP API verifies TLS against a bundle that also holds the dev CA,
 * so requests to https://wp.wpu.test (loopback, REST preloads) work. The CA is trusted nowhere
 * outside the stack.
 */
$wpu_dev_ca_bundle = getenv( 'WPU_DEV_CA_BUNDLE' );
if ( $wpu_dev_ca_bundle && is_readable( $wpu_dev_ca_bundle ) ) {
	add_filter(
		'http_request_args',
		function ( $args ) use ( $wpu_dev_ca_bundle ) {
			$args['sslcertificates'] = $wpu_dev_ca_bundle;
			return $args;
		}
	);
}

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	/**
	 * The app user's login, recorded by dev/wordpress/setup/app-user.php.
	 */
	function wpu_dev_app_user() {
		$login = get_option( WPU_DEV_APP_USER_OPTION );
		$user  = $login ? get_user_by( 'login', $login ) : false;
		if ( ! $user ) {
			WP_CLI::error( 'The app user is not set up yet. Run `dev/run up` first.' );
		}
		return $user;
	}

	/**
	 * Prints the variants as one `key=value` line, easy to read and to parse.
	 */
	function wpu_dev_print_variant() {
		$variant         = wpu_dev_variant();
		$roles           = wpu_dev_app_user()->roles;
		$variant['role'] = $roles ? implode( ',', $roles ) : 'none';
		$pairs           = array();
		foreach ( $variant as $key => $value ) {
			$pairs[] = $key . '=' . $value;
		}
		WP_CLI::line( implode( ' ', $pairs ) );
	}

	/**
	 * Switches dev-stack variants: trash=on|off filebird=on|off peruser=on|off role=editor|author.
	 * Without arguments it prints the current state.
	 *
	 * @param string[] $args Positional `key=value` pairs.
	 */
	function wpu_dev_variant_command( $args ) {
		$allowed_values = array(
			'trash'    => array( 'on', 'off' ),
			'filebird' => array( 'on', 'off' ),
			'peruser'  => array( 'on', 'off' ),
			'role'     => array( 'editor', 'author' ),
		);

		$requested = array();
		foreach ( $args as $pair ) {
			$parts = explode( '=', $pair, 2 );
			if ( 2 !== count( $parts ) || ! isset( $allowed_values[ $parts[0] ] ) ) {
				WP_CLI::error( "Unknown variant '$pair'. Use trash=on|off filebird=on|off peruser=on|off role=editor|author." );
			}
			list( $key, $value ) = $parts;
			if ( ! in_array( $value, $allowed_values[ $key ], true ) ) {
				WP_CLI::error( "Invalid value for $key: '$value'. Use " . implode( '|', $allowed_values[ $key ] ) . '.' );
			}
			$requested[ $key ] = $value;
		}

		if ( isset( $requested['role'] ) ) {
			wpu_dev_app_user()->set_role( $requested['role'] );
			unset( $requested['role'] );
		}
		if ( $requested ) {
			update_option( WPU_DEV_VARIANT_OPTION, array_merge( wpu_dev_variant(), $requested ) );
		}

		wpu_dev_print_variant();
	}

	WP_CLI::add_command( 'wpu-dev variant', 'wpu_dev_variant_command' );
}
