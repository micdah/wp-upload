<?php
/**
 * Wires every component of the plugin. Each class registers its own hooks
 * and routes in register(); this list is pre-wired by the M0 scaffold so
 * tracks P1 and P2 only fill in their own classes (implementation plan §2.5).
 *
 * Also owns the install and lifecycle rules of plugin-api.md §9: upgrade
 * detection, the deactivation stale mark and uninstall, and the `features[]`
 * list of /info (§2.2).
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion;

use WpUpload\Companion\Index\MediaIndex;
use WpUpload\Companion\Index\UsageBridge;

final class Plugin {

	public const REST_NAMESPACE = 'wp-upload/v1';

	/** `PLUGIN_FEATURES` in shared/library-api.ts: the order /info lists them in. */
	public const FEATURE_ORDER = array(
		'collection',
		'facets',
		'media-batch',
		'trash',
		'usage',
		'image-edit',
		'image-regenerate',
		'image-replace',
		'folders',
		'folder-colors',
		'maintenance',
		'usage-visual-portfolio',
	);

	public const OPTION_INSTALLED_VERSION = 'wpu_installed_version';

	/** @var list<class-string> Components, each with a static register(). */
	private const COMPONENTS = array(
		// Track P1.
		Rev::class,
		FileBird\Adapter::class,
		Index\MediaIndex::class,
		Field\WpuField::class,
		Rest\InfoController::class,
		Rest\CollectionController::class,
		Rest\FoldersController::class,
		Rest\MaintenanceController::class,
		// Track P2.
		Index\UsageIndex::class,
		Rest\MediaController::class,
		Rest\TrashController::class,
		Rest\UsageController::class,
		Rest\ImagesController::class,
	);

	/** Tables dropped on uninstall (§9.4). */
	private const TABLES = array( 'wpu_media_index', 'wpu_usage', 'wpu_usage_sources' );

	/** @var array<string, true> Features provided by the registered components. */
	private static $features = array();

	public static function boot(): void {
		foreach ( self::COMPONENTS as $component ) {
			$component::register();
		}
		self::maybe_upgrade();
		if ( 'plugin' !== self::install_mode() ) {
			return;
		}
		// Plugins can be deactivated from wp-admin, WP-CLI and core's REST API
		// (`/wp/v2/plugins`), so the deactivation hook is always registered (it is
		// only an add_action()).
		register_deactivation_hook( WPU_FILE, array( self::class, 'deactivate' ) );
		// register_uninstall_hook() reads and may write an option, so it runs only
		// where plugins are usually managed; WordPress keeps the stored callback.
		$can_manage_plugins = is_admin() || ( defined( 'WP_CLI' ) && WP_CLI );
		if ( $can_manage_plugins ) {
			register_uninstall_hook( WPU_FILE, array( self::class, 'uninstall' ) );
		}
	}

	/**
	 * Called by a component's register() for every optional capability it
	 * implements (§2.2). The build reads these calls to write plugin.json, so
	 * pass a string literal.
	 */
	public static function provide_feature( string $feature ): void {
		self::$features[ $feature ] = true;
	}

	/**
	 * Provided features, known ones in `PLUGIN_FEATURES` order, then any others.
	 *
	 * @return list<string>
	 */
	public static function features(): array {
		$known   = array_values( array_intersect( self::FEATURE_ORDER, array_keys( self::$features ) ) );
		$unknown = array_values( array_diff( array_keys( self::$features ), self::FEATURE_ORDER ) );
		return array_merge( $known, $unknown );
	}

	/**
	 * 'mu-plugin' when this file lives in WPMU_PLUGIN_DIR, else 'plugin' (§9.1).
	 */
	public static function install_mode(): string {
		if ( ! defined( 'WPMU_PLUGIN_DIR' ) ) {
			return 'plugin';
		}
		$file      = wp_normalize_path( (string) WPU_FILE );
		$mu_plugin = trailingslashit( wp_normalize_path( (string) WPMU_PLUGIN_DIR ) );
		return 0 === strpos( $file, $mu_plugin ) ? 'mu-plugin' : 'plugin';
	}

	/**
	 * A new WPU_VERSION ran for the first time: upgrade steps (none yet in
	 * 1.0) and a rev bump (§9.2).
	 */
	private static function maybe_upgrade(): void {
		if ( get_option( self::OPTION_INSTALLED_VERSION ) === WPU_VERSION ) {
			return;
		}
		update_option( self::OPTION_INSTALLED_VERSION, WPU_VERSION, true );
		Rev::ensure_exists();
		Rev::touch();
	}

	/**
	 * Regular plugin only: while the plugin is off no hook runs, so both
	 * indexes are marked stale and reconciled after reactivation (§9.3).
	 */
	public static function deactivate(): void {
		MediaIndex::mark_stale();
		UsageBridge::mark_stale();
		Rev::bump();
	}

	/**
	 * Regular plugin only: drops the plugin's tables, options and edit-backup
	 * meta. Media files, including edit backups, stay (§9.4).
	 */
	public static function uninstall(): void {
		global $wpdb;
		foreach ( self::TABLES as $table ) {
			$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . $table ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		}
		$options = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT option_name FROM {$wpdb->options} WHERE (option_name LIKE %s OR option_name LIKE %s OR option_name LIKE %s) AND option_name NOT LIKE %s",
				$wpdb->esc_like( 'wpu_' ) . '%',
				$wpdb->esc_like( '_transient_wpu_' ) . '%',
				$wpdb->esc_like( '_transient_timeout_wpu_' ) . '%',
				$wpdb->esc_like( 'wpu_dev_' ) . '%'
			)
		);
		foreach ( (array) $options as $option ) {
			delete_option( (string) $option );
		}
		delete_post_meta_by_key( '_wpu_edit_backups' );
	}
}
