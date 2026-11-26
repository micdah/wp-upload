<?php
/**
 * The only code that touches FileBird (plugin-api.md §10, D17).
 *
 * - Reads use read-only SQL on `{prefix}fbv` and `{prefix}fbv_attachment_folder`
 *   and read FileBird's options.
 * - Mutations go only through FileBird's own PHP functions, so its hooks fire.
 *   A missing function answers 501 `wpu_not_implemented`; we never fall back
 *   to writing FileBird's tables or options ourselves.
 * - Per-user mode is resolved at request time (`get_current_user_id()`), not
 *   from FileBird's user cached at plugins_loaded (research 02 §2.1).
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\FileBird;

use WpUpload\Companion\Support\Errors;
use WpUpload\Companion\Support\Format;

final class Adapter {

	private const MODEL      = 'FileBird\\Model\\Folder';
	private const CONTROLLER = 'FileBird\\Controller\\FolderController';
	private const HELPERS    = 'FileBird\\Classes\\Helpers';

	/** FileBird's own limit for "Name (N)" suffixes (Folder::findUniqueFolderName). */
	public const MAX_SUFFIX = 15;

	/** @var bool|null */
	private static $tables_exist = null;

	public static function register(): void {
	}

	// ---- Detection (plugin-api.md §10.2) ---------------------------------------------------

	public static function is_active(): bool {
		return class_exists( self::MODEL );
	}

	/**
	 * `/info.filebird`: null when FileBird isn't installed.
	 *
	 * @return array{active: bool, version: string, pro: bool, perUser: bool}|null
	 */
	public static function info(): ?array {
		if ( self::is_active() ) {
			return array(
				'active'  => true,
				'version' => defined( 'NJFB_VERSION' ) ? (string) constant( 'NJFB_VERSION' ) : self::header_version(),
				'pro'     => self::is_pro(),
				'perUser' => self::is_per_user(),
			);
		}
		$installed = self::installed_plugin();
		if ( null === $installed ) {
			return null;
		}
		return array(
			'active'  => false,
			'version' => (string) ( $installed['Version'] ?? '' ),
			'pro'     => false,
			'perUser' => self::is_per_user(),
		);
	}

	public static function is_per_user(): bool {
		return filter_var( get_option( 'njt_fbv_folder_per_user', '0' ), FILTER_VALIDATE_BOOLEAN );
	}

	/**
	 * FileBird Pro, detected from public signals only (spike X9, D15): the
	 * plugin's directory (`filebird-pro/`, how Pro is distributed) or a header
	 * name that says Pro. Lite's directory is `filebird/` and its header says
	 * "FileBird Lite", so Lite is never detected as Pro. Unverified against a
	 * live Pro site; the `wpu_filebird_pro` filter overrides it.
	 */
	public static function is_pro(): bool {
		$pro = false;
		if ( self::is_active() ) {
			$basename = defined( 'NJFB_PLUGIN_BASE_NAME' ) ? (string) constant( 'NJFB_PLUGIN_BASE_NAME' ) : '';
			if ( 0 === strpos( $basename, 'filebird-pro/' ) ) {
				$pro = true;
			} elseif ( defined( 'NJFB_PLUGIN_FILE' ) ) {
				$name = self::header_name();
				$pro  = (bool) preg_match( '/\bpro\b/i', $name ) && ! preg_match( '/\blite\b/i', $name );
			}
		}
		return (bool) apply_filters( 'wpu_filebird_pro', $pro );
	}

	/**
	 * Whose tree the current request works in: the user's own in per-user mode,
	 * the shared tree (0) otherwise.
	 */
	public static function owner(): int {
		return self::is_per_user() ? get_current_user_id() : 0;
	}

	/**
	 * Whether FileBird's tables exist (they may, with FileBird inactive).
	 */
	public static function tables_exist(): bool {
		if ( null === self::$tables_exist ) {
			global $wpdb;
			$found              = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( self::folder_table() ) ) );
			$found_relation     = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( self::relation_table() ) ) );
			self::$tables_exist = null !== $found && null !== $found_relation;
		}
		return self::$tables_exist;
	}

	public static function folder_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'fbv';
	}

	public static function relation_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'fbv_attachment_folder';
	}

	// ---- Reads (read-only SQL) -------------------------------------------------------------

	/**
	 * Every folder of one owner, sorted by parent, ord, id (plugin-api.md §5.16).
	 *
	 * @return list<array{id: int, name: string, parent: int, ord: int}>
	 */
	public static function folders( int $owner ): array {
		global $wpdb;
		$table = self::folder_table();
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, name, parent, COALESCE(ord, 0) AS ord FROM {$table} WHERE created_by = %d AND type = 0 ORDER BY parent ASC, ord ASC, id ASC",
				$owner
			),
			ARRAY_A
		);
		$folders = array();
		foreach ( (array) $rows as $row ) {
			$folders[] = array(
				'id'     => (int) $row['id'],
				'name'   => Format::plain_text( (string) $row['name'] ),
				'parent' => (int) $row['parent'],
				'ord'    => (int) $row['ord'],
			);
		}
		return $folders;
	}

	public static function folder_exists( int $folder, int $owner ): bool {
		if ( $folder <= 0 || ! self::tables_exist() ) {
			return false;
		}
		global $wpdb;
		$table = self::folder_table();
		$found = $wpdb->get_var(
			$wpdb->prepare( "SELECT id FROM {$table} WHERE id = %d AND created_by = %d AND type = 0", $folder, $owner )
		);
		return null !== $found;
	}

	/**
	 * The folder each attachment is in, in one owner's tree (0 = none).
	 *
	 * @param list<int> $ids
	 * @return array<int, int> attachment id => folder id, for every requested id
	 */
	public static function folders_of( array $ids, int $owner ): array {
		$result = array_fill_keys( $ids, 0 );
		if ( array() === $ids || ! self::tables_exist() ) {
			return $result;
		}
		global $wpdb;
		$relation = self::relation_table();
		$folders  = self::folder_table();
		foreach ( array_chunk( $ids, 1000 ) as $chunk ) {
			$placeholders = implode( ',', array_fill( 0, count( $chunk ), '%d' ) );
			$rows         = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT fa.attachment_id, MIN(fa.folder_id) AS folder_id FROM {$relation} fa INNER JOIN {$folders} f ON f.id = fa.folder_id AND f.created_by = %d WHERE fa.attachment_id IN ({$placeholders}) GROUP BY fa.attachment_id",
					array_merge( array( $owner ), $chunk )
				),
				ARRAY_A
			);
			foreach ( (array) $rows as $row ) {
				$result[ (int) $row['attachment_id'] ] = (int) $row['folder_id'];
			}
		}
		return $result;
	}

	/**
	 * Folder colours, lowercase `#rrggbb`; anything else is dropped (§5.16).
	 *
	 * @return array<int, string>
	 */
	public static function colors(): array {
		$stored = get_option( 'fbv_folder_colors', array() );
		$colors = array();
		if ( ! is_array( $stored ) ) {
			return $colors;
		}
		foreach ( $stored as $id => $color ) {
			if ( is_string( $color ) && preg_match( '/^#[0-9a-f]{6}$/i', $color ) ) {
				$colors[ (int) $id ] = strtolower( $color );
			}
		}
		return $colors;
	}

	/**
	 * Attachments directly in each folder of one owner, from FileBird's
	 * relation table, plus the number of attachments in none of that owner's
	 * folders. `$visible` is an SQL condition on the attachment (alias `p`,
	 * built by Query\Visibility from trusted values only); by default every
	 * non-trashed attachment (FileBird's own count semantics).
	 *
	 * @return array{byId: array<int, int>, all: int, categorized: int}
	 */
	public static function count_from_relations( int $owner, string $visible = '' ): array {
		global $wpdb;
		$relation = self::relation_table();
		$folders  = self::folder_table();
		$visible  = '' === $visible ? "p.post_status NOT IN ('trash', 'auto-draft')" : $visible;
		$by_id    = array();
		$rows     = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT fa.folder_id, COUNT(*) AS c FROM {$relation} fa INNER JOIN {$folders} f ON f.id = fa.folder_id AND f.created_by = %d INNER JOIN {$wpdb->posts} p ON p.ID = fa.attachment_id AND p.post_type = 'attachment' WHERE {$visible} GROUP BY fa.folder_id", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$owner
			),
			ARRAY_A
		);
		foreach ( (array) $rows as $row ) {
			$by_id[ (int) $row['folder_id'] ] = (int) $row['c'];
		}
		$categorized = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT fa.attachment_id) FROM {$relation} fa INNER JOIN {$folders} f ON f.id = fa.folder_id AND f.created_by = %d INNER JOIN {$wpdb->posts} p ON p.ID = fa.attachment_id AND p.post_type = 'attachment' WHERE {$visible}", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$owner
			)
		);
		$all = (int) $wpdb->get_var(
			"SELECT COUNT(*) FROM {$wpdb->posts} p WHERE p.post_type = 'attachment' AND {$visible}" // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		);
		return array(
			'byId'        => $by_id,
			'all'         => $all,
			'categorized' => $categorized,
		);
	}

	/**
	 * How many non-trashed attachments sit directly in any of these folders.
	 *
	 * @param list<int> $folder_ids
	 */
	public static function count_files_in( array $folder_ids ): int {
		if ( array() === $folder_ids ) {
			return 0;
		}
		global $wpdb;
		$relation     = self::relation_table();
		$placeholders = implode( ',', array_fill( 0, count( $folder_ids ), '%d' ) );
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(DISTINCT fa.attachment_id) FROM {$relation} fa INNER JOIN {$wpdb->posts} p ON p.ID = fa.attachment_id AND p.post_type = 'attachment' AND p.post_status NOT IN ('trash', 'auto-draft') WHERE fa.folder_id IN ({$placeholders})",
				$folder_ids
			)
		);
	}

	// ---- Names -----------------------------------------------------------------------------

	/**
	 * What FileBird stores for a name (Folder::newFolder / updateFolderName):
	 * sanitize_text_field(wp_kses_post(sanitize_for_excel(name))).
	 */
	public static function sanitize_name( string $name ): string {
		$helpers = self::HELPERS;
		if ( class_exists( $helpers ) && method_exists( $helpers, 'sanitize_for_excel' ) ) {
			$name = (string) $helpers::sanitize_for_excel( $name );
		}
		return sanitize_text_field( wp_kses_post( $name ) );
	}

	/**
	 * Whether a sibling of `$parent` (other than `$except`) already has this
	 * stored name. MySQL's collation makes it case-insensitive, as in FileBird.
	 */
	public static function sibling_has_name( string $stored_name, int $parent, int $owner, int $except = 0 ): bool {
		global $wpdb;
		$table = self::folder_table();
		$found = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT id FROM {$table} WHERE name = %s AND parent = %d AND created_by = %d AND id != %d LIMIT 1",
				$stored_name,
				$parent,
				$owner,
				$except
			)
		);
		return null !== $found;
	}

	/**
	 * The name FileBird would end up with: the name itself, or the first free
	 * "Name (N)", or null when N would exceed 15.
	 */
	public static function free_name( string $stored_name, int $parent, int $owner, int $except = 0 ): ?string {
		if ( ! self::sibling_has_name( $stored_name, $parent, $owner, $except ) ) {
			return $stored_name;
		}
		for ( $counter = 1; $counter <= self::MAX_SUFFIX; $counter++ ) {
			$candidate = $stored_name . ' (' . $counter . ')';
			if ( ! self::sibling_has_name( $candidate, $parent, $owner, $except ) ) {
				return $candidate;
			}
		}
		return null;
	}

	// ---- Mutations (FileBird's own functions only, §10.3) ------------------------------------

	/**
	 * Creates a folder through FileBird (auto-suffixed on a clash).
	 *
	 * @return int|\WP_Error The new folder's id.
	 */
	public static function create( string $stored_name, int $parent ) {
		$model = self::MODEL;
		if ( ! method_exists( $model, 'newUniqueFolder' ) && ! method_exists( $model, 'newFolder' ) ) {
			return Errors::not_implemented( 'creating folders with this FileBird version' );
		}
		if ( null === self::free_name( $stored_name, $parent, 0 ) ) {
			return self::name_exhausted();
		}
		if ( method_exists( $model, 'newUniqueFolder' ) ) {
			$created = $model::newUniqueFolder( $stored_name, $parent );
		} else {
			$created = $model::newFolder( (string) self::free_name( $stored_name, $parent, 0 ), $parent );
		}
		if ( ! is_array( $created ) || empty( $created['id'] ) ) {
			return Errors::make( 'wpu_internal', 'FileBird could not create the folder.', 500 );
		}
		return (int) $created['id'];
	}

	/**
	 * Renames through FileBird's model, which auto-suffixes a clash.
	 *
	 * @return true|\WP_Error
	 */
	public static function rename( int $folder, string $stored_name, int $parent ) {
		$model = self::MODEL;
		if ( ! method_exists( $model, 'updateFolderName' ) ) {
			return Errors::not_implemented( 'renaming folders with this FileBird version' );
		}
		if ( null === self::free_name( $stored_name, $parent, 0, $folder ) ) {
			return self::name_exhausted();
		}
		$updated = $model::updateFolderName( $stored_name, $parent, $folder, true );
		if ( true !== $updated ) {
			return self::name_exhausted();
		}
		return true;
	}

	/**
	 * Moves and/or reorders through the logic behind FileBird's
	 * `update-folder-ord` route, called in PHP with a request we build.
	 *
	 * @param int $position 0-based index among the new siblings, without the moved folder.
	 * @return true|\WP_Error
	 */
	public static function move( int $folder, int $parent, int $position ) {
		$controller = self::CONTROLLER;
		if ( ! class_exists( $controller ) || ! method_exists( $controller, 'updateFolderOrder' ) ) {
			return Errors::not_implemented( 'moving folders with this FileBird version' );
		}
		global $wpdb;
		$table    = self::folder_table();
		$siblings = array_map(
			'intval',
			(array) $wpdb->get_col(
				$wpdb->prepare(
					"SELECT id FROM {$table} WHERE parent = %d AND created_by = 0 AND id != %d ORDER BY ord+0 ASC, id ASC",
					$parent,
					$folder
				)
			)
		);
		$request = new \WP_REST_Request( 'POST' );
		$request->set_param( 'dragNodeId', $folder );
		$request->set_param( 'toParentId', $parent );
		if ( 0 === $position || array() === $siblings ) {
			// FileBird's dropPosition 0: first child of dropNodeId.
			$request->set_param( 'dropPosition', 0 );
			$request->set_param( 'dropNodeId', $parent );
		} else {
			// dropPosition 1: right after dropNodeId among toParentId's children.
			$index = min( $position, count( $siblings ) ) - 1;
			$request->set_param( 'dropPosition', 1 );
			$request->set_param( 'dropNodeId', $siblings[ $index ] );
		}
		$result = ( new $controller() )->updateFolderOrder( $request );
		if ( is_wp_error( $result ) ) {
			return Errors::make( 'wpu_internal', 'FileBird could not move the folder.', 500 );
		}
		return true;
	}

	/**
	 * Sets or clears a colour through the logic behind FileBird's
	 * `update-folder-color` route. Callers check Pro detection first (D23).
	 *
	 * @return true|\WP_Error
	 */
	public static function set_color( int $folder, ?string $color ) {
		$controller = self::CONTROLLER;
		if ( ! class_exists( $controller ) || ! method_exists( $controller, 'updateFolderColor' ) ) {
			return Errors::not_implemented( 'folder colours with this FileBird version' );
		}
		$request = new \WP_REST_Request( 'POST' );
		$request->set_param( 'folderId', $folder );
		$request->set_param( 'color', null === $color ? '' : strtolower( $color ) );
		$result = ( new $controller() )->updateFolderColor( $request );
		if ( is_wp_error( $result ) ) {
			return Errors::make( 'wpu_internal', 'FileBird could not set the colour.', 500 );
		}
		return true;
	}

	/**
	 * Deletes a folder and its subtree through FileBird. Prefers `delete()`
	 * (the path FileBird's own UI uses, which fires `fbv_after_folder_deleted`
	 * per folder) over `deleteFolderAndItsChildren()` (no hooks).
	 *
	 * @return true|\WP_Error
	 */
	public static function delete( int $folder ) {
		$model = self::MODEL;
		if ( method_exists( $model, 'delete' ) ) {
			$model::delete( array( $folder ), '' );
			return true;
		}
		if ( method_exists( $model, 'deleteFolderAndItsChildren' ) ) {
			$model::deleteFolderAndItsChildren( $folder );
			return true;
		}
		return Errors::not_implemented( 'deleting folders with this FileBird version' );
	}

	/**
	 * Assigns attachments to a folder (0 = out of every shared folder) in one
	 * FileBird call: `assignFolder()` (one DELETE and one INSERT, what FileBird's
	 * own UI uses), else `setFoldersForPosts()` (documented, one query pair per id).
	 *
	 * @param list<int> $ids
	 * @return true|\WP_Error
	 */
	public static function assign( array $ids, int $folder ) {
		if ( array() === $ids ) {
			return true;
		}
		$model = self::MODEL;
		if ( method_exists( $model, 'assignFolder' ) ) {
			$model::assignFolder( $folder, $ids, '' );
			return true;
		}
		if ( method_exists( $model, 'setFoldersForPosts' ) ) {
			$model::setFoldersForPosts( $ids, $folder );
			return true;
		}
		return Errors::not_implemented( 'assigning folders with this FileBird version' );
	}

	// ---- Internals -------------------------------------------------------------------------

	private static function name_exhausted(): \WP_Error {
		return Errors::make(
			'wpu_folder_name_exhausted',
			'FileBird could not find a free name for this folder.',
			409
		);
	}

	/**
	 * The installed (possibly inactive) FileBird plugin's header, or null.
	 *
	 * @return array<string, string>|null
	 */
	private static function installed_plugin(): ?array {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		foreach ( get_plugins() as $file => $header ) {
			$directory = strtok( (string) $file, '/' );
			if ( 'filebird' === $directory || 'filebird-pro' === $directory ) {
				return $header;
			}
		}
		return null;
	}

	private static function header_version(): string {
		$header = self::header();
		return (string) ( $header['Version'] ?? '' );
	}

	private static function header_name(): string {
		$header = self::header();
		return (string) ( $header['Name'] ?? '' );
	}

	/**
	 * @return array<string, string>
	 */
	private static function header(): array {
		if ( ! defined( 'NJFB_PLUGIN_FILE' ) ) {
			return array();
		}
		return get_file_data(
			(string) constant( 'NJFB_PLUGIN_FILE' ),
			array(
				'Name'    => 'Plugin Name',
				'Version' => 'Version',
			)
		);
	}
}
