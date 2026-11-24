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
 *   vp=on|off         hides Visual Portfolio from the active plugins (D22; its data stays)
 *   role=editor|author switches the one app user's role
 *
 * Drive it with `dev/run variant ...` (which calls `wp wpu-dev variant ...`), or, where there is
 * no Docker (the test runner), with `POST /wp-json/wpu-dev/v1/variant` as the app user.
 *
 * FileBird itself is never modified (D17): no writes to its tables or options. Per-user mode is
 * answered through a `pre_option_` filter, and "FileBird off" filters `active_plugins`.
 * "Visual Portfolio off" works the same way, so its saved layouts and posts stay in place.
 */

defined( 'ABSPATH' ) || exit;

const WPU_DEV_VARIANT_OPTION  = 'wpu_dev_variant';
const WPU_DEV_APP_USER_OPTION = 'wpu_dev_app_user';

/**
 * Plugins a variant can hide, by variant key.
 */
const WPU_DEV_HIDEABLE_PLUGINS = array(
	'filebird' => 'filebird/filebird.php',
	'vp'       => 'visual-portfolio/class-visual-portfolio.php',
);

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
		'vp'       => 'on',
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
 * The plugin files the current variant hides (`filebird=off`, `vp=off`).
 *
 * @return string[]
 */
function wpu_dev_hidden_plugins() {
	$variant = wpu_dev_variant();
	$hidden  = array();
	foreach ( WPU_DEV_HIDEABLE_PLUGINS as $key => $plugin_file ) {
		if ( 'off' === $variant[ $key ] ) {
			$hidden[] = $plugin_file;
		}
	}
	return $hidden;
}

/**
 * True when a variant hides this plugin file.
 *
 * @param string $plugin_file Plugin file relative to the plugins directory.
 * @return bool
 */
function wpu_dev_plugin_is_hidden( $plugin_file ) {
	return in_array( $plugin_file, wpu_dev_hidden_plugins(), true );
}

/**
 * "FileBird off" and "Visual Portfolio off": WordPress loads only the plugins this filter
 * returns, and is_plugin_active() reads the same option, so a hidden plugin behaves exactly as
 * if deactivated. Its tables, options and posts stay as they are.
 */
add_filter(
	'option_active_plugins',
	function ( $plugins ) {
		$hidden = wpu_dev_hidden_plugins();
		if ( ! $hidden || ! is_array( $plugins ) ) {
			return $plugins;
		}
		return array_values( array_diff( $plugins, $hidden ) );
	}
);

/**
 * Activating another plugin while one is hidden saves the filtered list. Put the hidden plugins
 * back into what is stored when they were active, so a variant never deactivates one for real.
 */
add_filter(
	'pre_update_option_active_plugins',
	function ( $new_value ) {
		$hidden = wpu_dev_hidden_plugins();
		if ( ! $hidden || ! is_array( $new_value ) ) {
			return $new_value;
		}
		global $wpdb;
		$stored_raw = $wpdb->get_var(
			$wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", 'active_plugins' )
		);
		$stored     = maybe_unserialize( $stored_raw );
		foreach ( $hidden as $plugin_file ) {
			$was_active = is_array( $stored ) && in_array( $plugin_file, $stored, true );
			if ( $was_active && ! in_array( $plugin_file, $new_value, true ) ) {
				$new_value[] = $plugin_file;
			}
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

/**
 * The app user (D26), recorded by dev/wordpress/setup/users.php. Null before `dev/run up`.
 *
 * @return WP_User|null
 */
function wpu_dev_find_app_user() {
	$login = get_option( WPU_DEV_APP_USER_OPTION );
	$user  = $login ? get_user_by( 'login', $login ) : false;
	return $user ? $user : null;
}

/**
 * The allowed values of every switch.
 *
 * @return array<string, string[]>
 */
function wpu_dev_allowed_variant_values() {
	return array(
		'trash'    => array( 'on', 'off' ),
		'filebird' => array( 'on', 'off' ),
		'peruser'  => array( 'on', 'off' ),
		'vp'       => array( 'on', 'off' ),
		'role'     => array( 'editor', 'author' ),
	);
}

/**
 * Validates and applies switches (`key => value`), shared by the wp-cli command and the REST
 * route so both behave the same.
 *
 * @param array<string, mixed> $requested Switches to change.
 * @return true|WP_Error
 */
function wpu_dev_apply_variant( array $requested ) {
	$allowed_values = wpu_dev_allowed_variant_values();
	foreach ( $requested as $key => $value ) {
		if ( ! isset( $allowed_values[ $key ] ) ) {
			return new WP_Error( 'wpu_dev_unknown_variant', "Unknown variant '$key'. Use trash=on|off filebird=on|off peruser=on|off vp=on|off role=editor|author." );
		}
		if ( ! is_string( $value ) || ! in_array( $value, $allowed_values[ $key ], true ) ) {
			return new WP_Error( 'wpu_dev_invalid_variant', "Invalid value for $key. Use " . implode( '|', $allowed_values[ $key ] ) . '.' );
		}
	}

	if ( isset( $requested['role'] ) ) {
		$app_user = wpu_dev_find_app_user();
		if ( ! $app_user ) {
			return new WP_Error( 'wpu_dev_no_app_user', 'The app user is not set up yet. Run `dev/run up` first.' );
		}
		$app_user->set_role( $requested['role'] );
		unset( $requested['role'] );
	}
	if ( $requested ) {
		update_option( WPU_DEV_VARIANT_OPTION, array_merge( wpu_dev_variant(), $requested ) );
	}
	return true;
}

/**
 * The current switches including the app user's role.
 *
 * @return array<string, string>
 */
function wpu_dev_variant_state() {
	$variant         = wpu_dev_variant();
	$app_user        = wpu_dev_find_app_user();
	$roles           = $app_user ? $app_user->roles : array();
	$variant['role'] = $roles ? implode( ',', $roles ) : 'none';
	return $variant;
}

/**
 * `GET|POST /wp-json/wpu-dev/v1/variant`: the same switches as `dev/run variant`, reachable from
 * the test runner, which has no Docker (P1 CR-1, P2 CR-P2-2). Only on a `local` environment (the
 * dev/test stack), and only for the app user or an administrator: the app user may switch its
 * own role between Editor and Author and back. The body is a JSON object such as
 * `{"trash": "on", "role": "author"}`; both methods answer the current state.
 */
add_action(
	'rest_api_init',
	function () {
		if ( 'local' !== wp_get_environment_type() ) {
			return;
		}
		register_rest_route(
			'wpu-dev/v1',
			'/variant',
			array(
				'methods'             => array( 'GET', 'POST' ),
				'permission_callback' => function () {
					$app_user = wpu_dev_find_app_user();
					$is_app   = $app_user && get_current_user_id() === $app_user->ID;
					return $is_app || current_user_can( 'manage_options' );
				},
				'callback'            => function ( WP_REST_Request $request ) {
					if ( 'POST' === $request->get_method() ) {
						$body    = $request->get_json_params();
						$applied = wpu_dev_apply_variant( is_array( $body ) ? $body : array() );
						if ( is_wp_error( $applied ) ) {
							$applied->add_data( array( 'status' => 400 ) );
							return $applied;
						}
					}
					return rest_ensure_response( wpu_dev_variant_state() );
				},
			)
		);
	}
);

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	/**
	 * Gives posts a fixed date (published and modified), unless they have it already.
	 *
	 * @param int[] $post_ids Post ids.
	 */
	function wpu_dev_fix_post_dates( array $post_ids ) {
		global $wpdb;
		$post_ids = array_values( array_filter( array_map( 'intval', $post_ids ) ) );
		if ( ! $post_ids ) {
			return;
		}
		$fixed_date   = '2024-01-01 00:00:00';
		$placeholders = implode( ',', array_fill( 0, count( $post_ids ), '%d' ) );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$wpdb->query(
			$wpdb->prepare(
				"UPDATE {$wpdb->posts} SET post_date = %s, post_date_gmt = %s, post_modified = %s, post_modified_gmt = %s
				WHERE ID IN ($placeholders) AND post_modified_gmt <> %s",
				array_merge( array( $fixed_date, $fixed_date, $fixed_date, $fixed_date ), $post_ids, array( $fixed_date ) )
			)
		);
		foreach ( $post_ids as $post_id ) {
			clean_post_cache( $post_id );
		}
	}

	/**
	 * Visual Portfolio does its first-run work lazily: on `init` after activation it creates a
	 * "Portfolio" archive page (plus a revision), and on the first front-end or wp-admin request
	 * it runs its migrations and adds a placeholder image to the media library (`vp_general`
	 * `no_image`). Left alone, that happens at a random moment (during a test, or after a
	 * restore), dated "now", and changes the media count. The seeds call this at their end
	 * instead, so it happens at a fixed point with fixed dates. Afterwards nothing is lazy any
	 * more (`vpf_db_version` is set).
	 */
	function wpu_dev_finish_visual_portfolio_setup() {
		global $wpdb;
		if ( ! class_exists( 'Visual_Portfolio_Image_Placeholder' ) ) {
			return;
		}
		if ( ! get_option( 'vpf_db_version' ) ) {
			( new Visual_Portfolio_Image_Placeholder() )->create_placeholder_image();
			( new Visual_Portfolio_Migrations() )->init();
		}

		$archive_page = (int) get_option( '_vp_add_archive_page', 0 );
		$post_ids     = array( $archive_page );
		if ( $archive_page > 0 ) {
			$post_ids = array_merge( $post_ids, wp_get_post_revisions( $archive_page, array( 'fields' => 'ids' ) ) );
		}

		$general     = get_option( 'vp_general' );
		$placeholder = is_array( $general ) ? (int) ( $general['no_image'] ?? 0 ) : 0;
		if ( $placeholder > 0 ) {
			$post_ids[] = $placeholder;
			// The guid carries the upload month of "now"; point it at the file's fixed place.
			$wpdb->update( $wpdb->posts, array( 'guid' => wp_get_attachment_url( $placeholder ) ), array( 'ID' => $placeholder ) );
		}
		wpu_dev_fix_post_dates( $post_ids );
	}

	/**
	 * Prints the variants as one `key=value` line, easy to read and to parse.
	 */
	function wpu_dev_print_variant() {
		$pairs = array();
		foreach ( wpu_dev_variant_state() as $key => $value ) {
			$pairs[] = $key . '=' . $value;
		}
		WP_CLI::line( implode( ' ', $pairs ) );
	}

	/**
	 * Switches dev-stack variants: trash=on|off filebird=on|off peruser=on|off vp=on|off
	 * role=editor|author.
	 * Without arguments it prints the current state.
	 *
	 * @param string[] $args Positional `key=value` pairs.
	 */
	function wpu_dev_variant_command( $args ) {
		$requested = array();
		foreach ( $args as $pair ) {
			$parts = explode( '=', $pair, 2 );
			if ( 2 !== count( $parts ) ) {
				WP_CLI::error( "Unknown variant '$pair'. Use trash=on|off filebird=on|off peruser=on|off vp=on|off role=editor|author." );
			}
			$requested[ $parts[0] ] = $parts[1];
		}

		$applied = wpu_dev_apply_variant( $requested );
		if ( is_wp_error( $applied ) ) {
			WP_CLI::error( $applied->get_error_message() );
		}

		wpu_dev_print_variant();
	}

	WP_CLI::add_command( 'wpu-dev variant', 'wpu_dev_variant_command' );
}
