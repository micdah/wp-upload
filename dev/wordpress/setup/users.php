<?php
/**
 * Ensures the dev/test stack's two app users and their Application Passwords exist (D26), plus
 * an Application Password for the administrator:
 *
 * - the app user (an Editor, D9) that the `app` container and the host server log in as. Its
 *   role can be switched with `dev/run variant role=editor|author`;
 * - a separate Author user, so tests can check per-item permissions on another user's media in
 *   one run, without flipping the app user's role;
 * - the administrator (created by the install), whose password lets the contract tests in the
 *   runner use the dev mu-plugin's admin-only `wpu-dev/v1/eval` route instead of `wp eval`.
 *
 * Run by `dev/run up` and after every snapshot restore, through `wp eval-file`. Never shipped.
 *
 * Arguments: <app login> <known app password> <author login> <known author password>
 * <admin login> <known admin password> (a known password may be an empty string).
 *
 * Why it takes the known passwords: `up` is idempotent, and a snapshot restore brings back the
 * password hashes of the time the snapshot was taken. When dev/run still holds a password that
 * WordPress accepts, it is kept, so a running dev server, the `app` container and the
 * snapshots stay valid. Otherwise the old dev password is revoked and a new one is created.
 *
 * Prints three lines on stdout and nothing else: the valid app password, the valid Author
 * password, then the valid administrator app password.
 */

const WPU_DEV_APP_PASSWORD_NAME = 'wp-upload dev stack';

$wpu_users_app_login    = $args[0] ?? '';
$wpu_users_app_known    = $args[1] ?? '';
$wpu_users_author_login = $args[2] ?? '';
$wpu_users_author_known = $args[3] ?? '';
$wpu_users_admin_login  = $args[4] ?? '';
$wpu_users_admin_known  = $args[5] ?? '';
if ( '' === $wpu_users_app_login || '' === $wpu_users_author_login || '' === $wpu_users_admin_login ) {
	WP_CLI::error( 'Usage: wp eval-file users.php <app login> <known app password> <author login> <known author password> <admin login> <known admin password>' );
}

/**
 * Creates the user with the given role when it doesn't exist.
 *
 * @param string $login        User login.
 * @param string $display_name Display name for a new user.
 * @param string $role         Role of a new user.
 * @return WP_User
 */
function wpu_dev_ensure_user( $login, $display_name, $role ) {
	$user = get_user_by( 'login', $login );
	if ( $user ) {
		return $user;
	}
	$user_id = wp_insert_user(
		array(
			'user_login'   => $login,
			'user_email'   => $login . '@example.com',
			'user_pass'    => wp_generate_password( 32 ),
			'display_name' => $display_name,
			'role'         => $role,
		)
	);
	if ( is_wp_error( $user_id ) ) {
		WP_CLI::error( $user_id );
	}
	return get_user_by( 'id', $user_id );
}

/**
 * True when the plain-text password matches one of the user's dev-stack app passwords.
 *
 * @param WP_User $user           The user.
 * @param string  $plain_password Password in the chunked form dev/run keeps.
 * @return bool
 */
function wpu_dev_password_is_valid( WP_User $user, $plain_password ) {
	if ( '' === $plain_password ) {
		return false;
	}
	// WordPress ignores the spaces of the chunked form when it authenticates.
	$stripped = preg_replace( '/[^a-z\d]/i', '', $plain_password );
	foreach ( WP_Application_Passwords::get_user_application_passwords( $user->ID ) as $item ) {
		if ( WPU_DEV_APP_PASSWORD_NAME !== $item['name'] ) {
			continue;
		}
		$matches = method_exists( 'WP_Application_Passwords', 'check_password' )
			? WP_Application_Passwords::check_password( $stripped, $item['password'] )
			: wp_check_password( $stripped, $item['password'], $user->ID );
		if ( $matches ) {
			return true;
		}
	}
	return false;
}

/**
 * Revokes earlier dev-stack app passwords and creates a fresh one.
 *
 * @param WP_User $user The user.
 * @return string The new password, chunked.
 */
function wpu_dev_create_password( WP_User $user ) {
	foreach ( WP_Application_Passwords::get_user_application_passwords( $user->ID ) as $item ) {
		if ( WPU_DEV_APP_PASSWORD_NAME === $item['name'] ) {
			WP_Application_Passwords::delete_application_password( $user->ID, $item['uuid'] );
		}
	}
	$created = WP_Application_Passwords::create_new_application_password(
		$user->ID,
		array( 'name' => WPU_DEV_APP_PASSWORD_NAME )
	);
	if ( is_wp_error( $created ) ) {
		WP_CLI::error( $created );
	}
	return WP_Application_Passwords::chunk_password( $created[0] );
}

/**
 * The password dev/run should keep: the known one while it still works, else a new one.
 *
 * @param WP_User $user           The user.
 * @param string  $known_password The password dev/run holds.
 * @return string
 */
function wpu_dev_valid_password( WP_User $user, $known_password ) {
	if ( wpu_dev_password_is_valid( $user, $known_password ) ) {
		return $known_password;
	}
	return wpu_dev_create_password( $user );
}

// The app user keeps whatever role it has, so `up` never undoes a `role=` variant.
$wpu_users_app = wpu_dev_ensure_user( $wpu_users_app_login, 'wp-upload app', 'editor' );
update_option( 'wpu_dev_app_user', $wpu_users_app_login );

// The Author user is always an Author: nothing switches it, so a stray role change is undone.
$wpu_users_author = wpu_dev_ensure_user( $wpu_users_author_login, 'wp-upload author', 'author' );
if ( array( 'author' ) !== array_values( $wpu_users_author->roles ) ) {
	$wpu_users_author->set_role( 'author' );
}
update_option( 'wpu_dev_author_user', $wpu_users_author_login );

// The administrator exists since the install; it only gets an app password here.
$wpu_users_admin = get_user_by( 'login', $wpu_users_admin_login );
if ( ! $wpu_users_admin ) {
	WP_CLI::error( "The administrator '$wpu_users_admin_login' doesn't exist." );
}

echo wpu_dev_valid_password( $wpu_users_app, $wpu_users_app_known ) . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
echo wpu_dev_valid_password( $wpu_users_author, $wpu_users_author_known ) . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
echo wpu_dev_valid_password( $wpu_users_admin, $wpu_users_admin_known ) . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput
