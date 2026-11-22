<?php
/**
 * Ensures the one app user (an Editor, D9) and its Application Password exist.
 * Run by `dev/run up` through `wp eval-file`. Never shipped.
 *
 * Arguments: <login> [<known app password>]
 *
 * Why it takes the known password: `up` is idempotent. When dev/run still holds a password
 * that WordPress accepts, it is kept, so a running dev server and the snapshots stay valid.
 * Otherwise the old dev password is revoked and a new one is printed.
 *
 * Prints the valid app password on stdout and nothing else.
 */

const WPU_DEV_APP_PASSWORD_NAME = 'wp-upload dev stack';

$login          = $args[0] ?? '';
$known_password = $args[1] ?? '';
if ( '' === $login ) {
	WP_CLI::error( 'Usage: wp eval-file app-user.php <login> [<known app password>]' );
}

/**
 * Creates the user as an Editor when it doesn't exist. An existing user keeps its role, so
 * `up` never undoes a `role=` variant.
 */
function wpu_dev_ensure_user( $login ) {
	$user = get_user_by( 'login', $login );
	if ( $user ) {
		return $user;
	}
	$user_id = wp_insert_user(
		array(
			'user_login'   => $login,
			'user_email'   => $login . '@example.com',
			'user_pass'    => wp_generate_password( 32 ),
			'display_name' => 'wp-upload app',
			'role'         => 'editor',
		)
	);
	if ( is_wp_error( $user_id ) ) {
		WP_CLI::error( $user_id );
	}
	return get_user_by( 'id', $user_id );
}

/**
 * True when the plain-text password matches one of the user's dev-stack app passwords.
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

$user = wpu_dev_ensure_user( $login );
update_option( 'wpu_dev_app_user', $login );

if ( wpu_dev_password_is_valid( $user, $known_password ) ) {
	echo $known_password; // phpcs:ignore WordPress.Security.EscapeOutput
} else {
	echo wpu_dev_create_password( $user ); // phpcs:ignore WordPress.Security.EscapeOutput
}
