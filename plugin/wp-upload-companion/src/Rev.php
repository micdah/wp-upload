<?php
/**
 * The library revision `wpu_rev` (plugin-api.md §6): a monotonic integer that
 * changes whenever any route's answer could change. The server caches by it.
 *
 * - `current()` reads it with a direct SELECT (never a possibly stale cache).
 * - `bump()` is one atomic UPDATE: max(rev + 1, now in ms).
 * - Hooks only `touch()` it; the bump happens once per request, after the
 *   media index has been flushed (`finish()` on rest_post_dispatch and
 *   shutdown), so a response is never tagged with a rev older than its data.
 * - Mutation routes call `commit()` before building their response, so they
 *   report the rev after their change.
 *
 * Shared by tracks P1 and P2. Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion;

use WpUpload\Companion\Index\MediaIndex;
use WpUpload\Companion\Support\Format;

final class Rev {

	public const OPTION = 'wpu_rev';

	/** Attachment meta keys whose change can alter a route's answer. */
	private const META_KEYS = array(
		'_wp_attachment_image_alt',
		'_wp_attachment_metadata',
		'_wp_attached_file',
		'_wp_attachment_backup_sizes',
		'_thumbnail_id',
		'_wp_trash_meta_time',
	);

	/** FileBird actions that change folders or assignments (plugin-api.md §6). */
	private const FILEBIRD_ACTIONS = array(
		'fbv_after_set_folder',
		'fbv_after_assign_folder',
		'fbv_after_folder_created',
		'fbv_after_folder_renamed',
		'fbv_after_folder_deleted',
		'fbv_after_parent_updated',
		'fbv_folder_parent_updated',
		'fbv_after_delete_all',
	);

	/** Options whose change alters folder answers (colours, per-user mode). */
	private const WATCHED_OPTIONS = array(
		'fbv_folder_colors',
		'njt_fbv_folder_per_user',
	);

	/** @var bool A change happened in this request that isn't covered by a bump yet. */
	private static $dirty = false;

	public static function register(): void {
		// The option is created on install/upgrade (Plugin::maybe_upgrade);
		// current() and bump() recreate it if it went missing since.
		$touch = array( self::class, 'touch' );

		foreach ( array( 'add_attachment', 'attachment_updated', 'edit_attachment', 'delete_attachment' ) as $action ) {
			add_action( $action, $touch, 10, 0 );
		}
		foreach ( array( 'trashed_post', 'untrashed_post' ) as $action ) {
			add_action( $action, array( self::class, 'on_post_trash_change' ), 10, 1 );
		}
		foreach ( array( 'added_post_meta', 'updated_post_meta', 'deleted_post_meta' ) as $action ) {
			add_action( $action, array( self::class, 'on_meta_change' ), 10, 3 );
		}
		add_filter( 'wp_update_attachment_metadata', array( self::class, 'on_metadata_filter' ), 10, 1 );

		foreach ( self::FILEBIRD_ACTIONS as $action ) {
			add_action( $action, $touch, 10, 0 );
		}
		foreach ( self::WATCHED_OPTIONS as $option ) {
			// update_option() on a missing option only fires add_option_*.
			add_action( 'add_option_' . $option, $touch, 10, 0 );
			add_action( 'update_option_' . $option, $touch, 10, 0 );
			add_action( 'delete_option_' . $option, $touch, 10, 0 );
		}
		add_action( 'activated_plugin', array( self::class, 'on_plugin_toggle' ), 10, 1 );
		add_action( 'deactivated_plugin', array( self::class, 'on_plugin_toggle' ), 10, 1 );

		// Flush the index, then bump once, before a REST response is served...
		add_filter( 'rest_post_dispatch', array( self::class, 'finish_filter' ), 1000, 1 );
		// ...and for everything else (wp-admin, cron, WP-CLI) at the end of the request.
		add_action( 'shutdown', array( self::class, 'finish' ), 0, 0 );
	}

	/**
	 * Creates the option on install (plugin-api.md §9.2), starting from the
	 * clock so a reinstall never reuses an old value.
	 */
	public static function ensure_exists(): void {
		global $wpdb;
		// INSERT IGNORE, not add_option(): add_option() trusts the options cache, so a
		// stale cache entry would make it skip the insert while the row is missing.
		$wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')",
				self::OPTION,
				(string) Format::now_ms()
			)
		);
		wp_cache_delete( self::OPTION, 'options' );
		wp_cache_delete( 'notoptions', 'options' );
		wp_cache_delete( 'alloptions', 'options' );
	}

	/**
	 * The current rev, read straight from the table (§6 "Read"). A missing
	 * option is created once; if it still can't be read (a failing database),
	 * the clock stands in rather than retrying forever.
	 */
	public static function current(): string {
		$value = self::read();
		if ( null === $value ) {
			self::ensure_exists();
			$value = self::read();
		}
		if ( null === $value ) {
			return (string) Format::now_ms();
		}
		return self::normalise( $value );
	}

	private static function read(): ?string {
		global $wpdb;
		$value = $wpdb->get_var(
			$wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", self::OPTION )
		);
		return null === $value ? null : (string) $value;
	}

	/**
	 * Atomically bumps and returns the value this bump wrote. LAST_INSERT_ID(expr)
	 * remembers it per connection, so concurrent bumps each get their own value
	 * back instead of whatever is stored by the time a SELECT runs.
	 */
	public static function bump(): string {
		global $wpdb;
		$updated = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$wpdb->options} SET option_value = LAST_INSERT_ID(GREATEST(CAST(option_value AS UNSIGNED) + 1, %d)) WHERE option_name = %s",
				Format::now_ms(),
				self::OPTION
			)
		);
		$value = null;
		if ( 1 === $updated ) {
			$value = (string) $wpdb->get_var( 'SELECT LAST_INSERT_ID()' );
		} else {
			self::ensure_exists();
		}
		wp_cache_delete( self::OPTION, 'options' );
		wp_cache_delete( 'alloptions', 'options' );
		self::$dirty = false;
		if ( null === $value || ! ctype_digit( $value ) || '0' === $value ) {
			return self::current();
		}
		return $value;
	}

	/**
	 * Marks that something visible changed; the bump follows at the end of the request.
	 */
	public static function touch(): void {
		self::$dirty = true;
	}

	public static function is_dirty(): bool {
		return self::$dirty;
	}

	/**
	 * For mutation routes: writes pending index rows, then bumps. Returns the rev
	 * to report (the rev after the change).
	 */
	public static function commit(): string {
		MediaIndex::flush();
		return self::bump();
	}

	/**
	 * End of request: pending index rows first, then one bump if anything changed.
	 */
	public static function finish(): void {
		MediaIndex::flush();
		if ( self::$dirty ) {
			self::bump();
		}
	}

	/**
	 * @param mixed $response Passed through untouched.
	 * @return mixed
	 */
	public static function finish_filter( $response ) {
		self::finish();
		return $response;
	}

	/**
	 * @param int $post_id
	 */
	public static function on_post_trash_change( $post_id ): void {
		if ( 'attachment' === get_post_type( (int) $post_id ) ) {
			self::touch();
		}
	}

	/**
	 * @param mixed $meta_ids
	 * @param int   $object_id
	 * @param string $meta_key
	 */
	public static function on_meta_change( $meta_ids, $object_id, $meta_key ): void {
		if ( in_array( $meta_key, self::META_KEYS, true ) ) {
			self::touch();
		}
	}

	/**
	 * @param mixed $data Passed through untouched.
	 * @return mixed
	 */
	public static function on_metadata_filter( $data ) {
		self::touch();
		return $data;
	}

	/**
	 * @param string $plugin Plugin basename.
	 */
	public static function on_plugin_toggle( $plugin ): void {
		if ( 0 === strpos( (string) $plugin, 'filebird' ) ) {
			self::touch();
		}
	}

	/**
	 * A decimal string, whatever the stored value looks like.
	 */
	private static function normalise( string $value ): string {
		$value = trim( $value );
		if ( '' === $value || ! ctype_digit( $value ) ) {
			return '0';
		}
		$value = ltrim( $value, '0' );
		return '' === $value ? '0' : $value;
	}
}
