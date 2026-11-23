<?php
/**
 * Extra wp-config.php settings for the dev/test stack, shared by the `wordpress` and `wpcli`
 * containers through WORDPRESS_CONFIG_EXTRA (dev/compose.yml). Never shipped.
 */

// The site URL comes from dev/run (a per-worktree port in `dev`, https://wp.wpu.test in
// `test`). Defining it here instead of relying on the database keeps snapshots valid when the
// port block changes.
$wpu_site_url = getenv( 'WPU_SITE_URL' );
if ( $wpu_site_url ) {
	define( 'WP_HOME', $wpu_site_url );
	define( 'WP_SITEURL', $wpu_site_url );
}

// `local` allows Application Passwords over plain HTTP in `dev` mode.
if ( ! defined( 'WP_ENVIRONMENT_TYPE' ) ) {
	define( 'WP_ENVIRONMENT_TYPE', 'local' );
}

// In `test` mode TLS ends at the proxy. The image's wp-config.php handles this too; keep it
// explicit so the stack doesn't depend on that detail.
if ( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && 'https' === $_SERVER['HTTP_X_FORWARDED_PROTO'] ) {
	$_SERVER['HTTPS'] = 'on';
}

// WP_DEBUG itself comes from WORDPRESS_DEBUG. The log lands in wp-content, where
// `dev/run logs` collects it into test-results/.
define( 'WP_DEBUG_LOG', '/var/www/html/wp-content/debug.log' );
define( 'WP_DEBUG_DISPLAY', false );

/**
 * The `trash=on|off` variant (dev/wordpress/mu-plugins/wpu-dev.php stores it in the option
 * `wpu_dev_variant`). WordPress defines MEDIA_TRASH in wp_initial_constants(), before any
 * mu-plugin loads, so it has to be defined here. One small query per request; any failure
 * (no database yet, no table before the install) means "off".
 */
function wpu_dev_media_trash_enabled() {
	mysqli_report( MYSQLI_REPORT_OFF );
	$link = @mysqli_connect( DB_HOST, DB_USER, DB_PASSWORD, DB_NAME );
	if ( ! $link ) {
		return false;
	}
	// The same source as the image's wp-config.php (wp-cli loads the config inside a method,
	// so the global $table_prefix isn't reliable here).
	$prefix = getenv( 'WORDPRESS_TABLE_PREFIX' ) ?: 'wp_';
	$table  = preg_replace( '/[^a-z0-9_]/i', '', $prefix . 'options' );
	$result = @mysqli_query( $link, "SELECT option_value FROM `$table` WHERE option_name = 'wpu_dev_variant' LIMIT 1" );
	$row    = $result ? mysqli_fetch_row( $result ) : null;
	mysqli_close( $link );
	if ( ! $row ) {
		return false;
	}
	$variant = @unserialize( $row[0], array( 'allowed_classes' => false ) );
	return is_array( $variant ) && isset( $variant['trash'] ) && 'on' === $variant['trash'];
}
if ( ! defined( 'MEDIA_TRASH' ) ) {
	define( 'MEDIA_TRASH', wpu_dev_media_trash_enabled() );
}

// The stack is pinned: nothing may update itself behind our back.
define( 'AUTOMATIC_UPDATER_DISABLED', true );
define( 'WP_AUTO_UPDATE_CORE', false );
define( 'FS_METHOD', 'direct' );
