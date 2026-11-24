<?php
/**
 * The `wpu_media_index` table (plugin-api.md §8.1): one row per attachment
 * with everything the collection and facet queries filter and sort on, so they
 * never touch postmeta or FileBird's relation table.
 *
 * - Schema: created and upgraded with dbDelta() when `wpu_media_index_db_version`
 *   differs from DB_VERSION (§9.2).
 * - Kept current by hooks: changed ids are collected during the request and
 *   written by `flush()` (called by Rev::finish() on rest_post_dispatch and
 *   shutdown, by Rev::commit() in mutation routes, and before the `wpu` field
 *   is computed).
 * - Repaired by `step()` (POST /maintenance/step): backfill, reconcile after a
 *   stale mark, and the denormalised FileBird folder column.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Index;

use WpUpload\Companion\FileBird\Adapter;
use WpUpload\Companion\Mutation\OptionLock;
use WpUpload\Companion\Rev;

final class MediaIndex {

	public const TABLE = 'wpu_media_index';

	/** Schema version; a change runs dbDelta(). 2: `modified_gmt`. */
	public const DB_VERSION = '2';

	/** Row format; rows with a lower `row_version` are re-indexed. 2: fills `modified_gmt`. */
	public const ROW_VERSION = 2;

	public const OPTION_DB_VERSION = 'wpu_media_index_db_version';
	public const OPTION_STATE      = 'wpu_media_index_state';
	private const SCHEMA_LOCK      = 'wpu_media_index_schema_lock';

	/** Attachments per maintenance batch (§5.21). */
	private const BATCH = 200;

	/**
	 * Attachments indexed and saved together within a maintenance batch: the
	 * deadline is checked and the cursor saved after each, so a step stops
	 * close to its budget even when rows are slow to compute.
	 */
	private const SUB_BATCH = 20;

	/** Seconds the /info consistency check is cached (§9.3). */
	private const CHECK_TTL = 60;

	/** PDFs up to this size are read whole to count pages (best effort). */
	private const PDF_FULL_READ_MAX_BYTES = 2000000;

	/** Of larger PDFs, only this many bytes at the start and at the end are read. */
	private const PDF_WINDOW_BYTES = 1000000;

	private const META_KEYS = array(
		'_wp_attachment_image_alt',
		'_wp_attachment_metadata',
		'_wp_attached_file',
		'_wp_trash_meta_time',
	);

	/** @var array<int, true> Attachments to re-index at the next flush. */
	private static $dirty = array();

	/** @var array<int, true> Attachments whose shared FileBird folder changed elsewhere. */
	private static $folder_dirty = array();

	/** @var bool Set while our own folder routes call FileBird; they write folder_id themselves. */
	private static $own_folder_change = false;

	public static function register(): void {
		self::maybe_upgrade();

		$mark = array( self::class, 'mark' );
		add_action( 'add_attachment', $mark, 10, 1 );
		add_action( 'attachment_updated', $mark, 10, 1 );
		add_action( 'edit_attachment', $mark, 10, 1 );
		add_action( 'delete_attachment', $mark, 10, 1 );
		add_action( 'trashed_post', array( self::class, 'mark_if_attachment' ), 10, 1 );
		add_action( 'untrashed_post', array( self::class, 'mark_if_attachment' ), 10, 1 );
		foreach ( array( 'added_post_meta', 'updated_post_meta', 'deleted_post_meta' ) as $action ) {
			add_action( $action, array( self::class, 'on_meta_change' ), 10, 3 );
		}

		// FileBird changes made outside our own routes (wp-admin, FileBird's UI, uploads with ?fbv=).
		add_action( 'fbv_after_set_folder', array( self::class, 'on_folder_set' ), 10, 1 );
		add_action( 'fbv_after_assign_folder', array( self::class, 'on_folder_assign' ), 10, 2 );
		add_action( 'fbv_after_folder_deleted', array( self::class, 'on_folder_deleted' ), 10, 1 );
		add_action( 'fbv_after_delete_all', array( self::class, 'on_delete_all' ), 10, 0 );
	}

	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . self::TABLE;
	}

	// ---- Schema (§9.2) ---------------------------------------------------------------------

	public static function maybe_upgrade(): void {
		if ( get_option( self::OPTION_DB_VERSION ) === self::DB_VERSION ) {
			return;
		}
		self::ensure_schema();
	}

	/**
	 * Runs dbDelta() under a short lock and records the schema version. A new
	 * table starts in `building` state.
	 */
	public static function ensure_schema(): void {
		global $wpdb;
		if ( get_option( self::OPTION_DB_VERSION ) === self::DB_VERSION ) {
			return;
		}
		// One atomic INSERT (Mutation\OptionLock): only one request runs dbDelta().
		if ( ! OptionLock::acquire( self::SCHEMA_LOCK, MINUTE_IN_SECONDS ) ) {
			return;
		}
		try {
			require_once ABSPATH . 'wp-admin/includes/upgrade.php';
			$table           = self::table();
			$charset_collate = $wpdb->get_charset_collate();
			dbDelta(
				"CREATE TABLE {$table} (
  attachment_id bigint(20) unsigned NOT NULL,
  status varchar(20) NOT NULL,
  author bigint(20) unsigned NOT NULL DEFAULT 0,
  uploaded_gmt datetime NOT NULL,
  month char(7) NOT NULL,
  kind tinyint(3) unsigned NOT NULL,
  mime varchar(100) NOT NULL,
  width int(10) unsigned NOT NULL DEFAULT 0,
  height int(10) unsigned NOT NULL DEFAULT 0,
  pixels bigint(20) unsigned NOT NULL DEFAULT 0,
  filesize bigint(20) unsigned NULL DEFAULT NULL,
  filename varchar(255) NOT NULL,
  has_alt tinyint(1) NOT NULL DEFAULT 0,
  search_extra text NOT NULL,
  duration int(10) unsigned NULL DEFAULT NULL,
  pages int(10) unsigned NULL DEFAULT NULL,
  folder_id bigint(20) unsigned NOT NULL DEFAULT 0,
  trashed_gmt datetime NULL DEFAULT NULL,
  modified_gmt datetime NULL DEFAULT NULL,
  row_version smallint(5) unsigned NOT NULL,
  indexed_gmt datetime NOT NULL,
  PRIMARY KEY  (attachment_id),
  KEY status_uploaded (status,uploaded_gmt,attachment_id),
  KEY status_folder (status,folder_id),
  KEY status_kind (status,kind),
  KEY status_month (status,month),
  KEY status_size (status,filesize),
  KEY status_pixels (status,pixels),
  KEY trashed (status,trashed_gmt)
) {$charset_collate};"
			);
			$had_version = false !== get_option( self::OPTION_DB_VERSION );
			update_option( self::OPTION_DB_VERSION, self::DB_VERSION, true );
			// A new table, or rows of an older format (§9.2): build the missing and outdated rows.
			if ( ! $had_version || false === get_option( self::OPTION_STATE ) || self::has_outdated_rows() ) {
				$state          = self::new_state( 'building' );
				$state['total'] = self::count_attachments();
				self::save_state( $state );
				delete_transient( 'wpu_media_index_check' );
			}
			Rev::touch();
		} finally {
			OptionLock::release( self::SCHEMA_LOCK );
		}
	}

	private static function has_outdated_rows(): bool {
		global $wpdb;
		$table = self::table();
		return null !== $wpdb->get_var(
			$wpdb->prepare( "SELECT attachment_id FROM {$table} WHERE row_version < %d LIMIT 1", self::ROW_VERSION )
		);
	}

	public static function drop(): void {
		global $wpdb;
		$table = self::table();
		$wpdb->query( "DROP TABLE IF EXISTS {$table}" );
	}

	// ---- Hooks -----------------------------------------------------------------------------

	/**
	 * @param int $post_id
	 */
	public static function mark( $post_id ): void {
		$post_id = (int) $post_id;
		if ( $post_id > 0 ) {
			self::$dirty[ $post_id ] = true;
		}
	}

	/**
	 * @param int $post_id
	 */
	public static function mark_if_attachment( $post_id ): void {
		if ( 'attachment' === get_post_type( (int) $post_id ) ) {
			self::mark( $post_id );
		}
	}

	/**
	 * @param mixed  $meta_ids
	 * @param int    $object_id
	 * @param string $meta_key
	 */
	public static function on_meta_change( $meta_ids, $object_id, $meta_key ): void {
		if ( in_array( $meta_key, self::META_KEYS, true ) ) {
			self::mark_if_attachment( $object_id );
		}
	}

	/**
	 * @param int $post_id
	 */
	public static function on_folder_set( $post_id ): void {
		if ( ! self::$own_folder_change ) {
			self::$folder_dirty[ (int) $post_id ] = true;
		}
	}

	/**
	 * @param int   $folder_id
	 * @param mixed $attachment_ids
	 */
	public static function on_folder_assign( $folder_id, $attachment_ids ): void {
		if ( self::$own_folder_change || ! is_array( $attachment_ids ) ) {
			return;
		}
		foreach ( $attachment_ids as $id ) {
			self::$folder_dirty[ (int) $id ] = true;
		}
	}

	/**
	 * FileBird already removed the relation rows; clear the denormalised column.
	 *
	 * @param int $folder_id
	 */
	public static function on_folder_deleted( $folder_id ): void {
		self::clear_folders( array( (int) $folder_id ) );
	}

	public static function on_delete_all(): void {
		global $wpdb;
		$table = self::table();
		$wpdb->query( "UPDATE {$table} SET folder_id = 0 WHERE folder_id <> 0" );
	}

	/**
	 * Our folder routes wrap their FileBird calls in this, then write folder_id
	 * themselves (some FileBird hooks fire only from its own controllers, so
	 * the plugin never relies on them for its own changes, §8.1).
	 *
	 * @template T
	 * @param callable(): T $operation
	 * @return T
	 */
	public static function own_folder_change( callable $operation ) {
		self::$own_folder_change = true;
		try {
			return $operation();
		} finally {
			self::$own_folder_change = false;
		}
	}

	// ---- Writing ---------------------------------------------------------------------------

	/**
	 * Writes every pending row. Safe to call any number of times.
	 */
	public static function flush(): void {
		if ( array() === self::$dirty && array() === self::$folder_dirty ) {
			return;
		}
		if ( get_option( self::OPTION_DB_VERSION ) !== self::DB_VERSION ) {
			return;
		}
		$ids                = array_keys( self::$dirty );
		$folder_ids         = array_keys( array_diff_key( self::$folder_dirty, self::$dirty ) );
		self::$dirty        = array();
		self::$folder_dirty = array();

		$changed = false;
		if ( array() !== $ids ) {
			$result  = self::index_ids( $ids );
			$changed = $result['changed'] > 0;
			if ( $result['added'] > 0 || $result['deleted'] > 0 ) {
				self::refresh_total();
			}
		}
		if ( array() !== $folder_ids && self::sync_folders( $folder_ids ) > 0 ) {
			$changed = true;
		}
		if ( $changed ) {
			Rev::touch();
		}
	}

	/**
	 * Sets the denormalised folder of these attachments (our own assign route).
	 *
	 * @param list<int> $ids
	 */
	public static function set_folder( array $ids, int $folder ): void {
		global $wpdb;
		$table = self::table();
		foreach ( array_chunk( $ids, 1000 ) as $chunk ) {
			$placeholders = implode( ',', array_fill( 0, count( $chunk ), '%d' ) );
			$wpdb->query(
				$wpdb->prepare(
					"UPDATE {$table} SET folder_id = %d WHERE attachment_id IN ({$placeholders})",
					array_merge( array( $folder ), $chunk )
				)
			);
		}
	}

	/**
	 * Moves rows of deleted folders to Uncategorized.
	 *
	 * @param list<int> $folder_ids
	 */
	public static function clear_folders( array $folder_ids ): void {
		if ( array() === $folder_ids ) {
			return;
		}
		global $wpdb;
		$table        = self::table();
		$placeholders = implode( ',', array_fill( 0, count( $folder_ids ), '%d' ) );
		$wpdb->query(
			$wpdb->prepare( "UPDATE {$table} SET folder_id = 0 WHERE folder_id IN ({$placeholders})", $folder_ids )
		);
	}

	/**
	 * Re-reads the shared-tree folder of these attachments from FileBird
	 * (read-only) and fixes the column. Returns the number of rows changed.
	 *
	 * @param list<int> $ids
	 */
	private static function sync_folders( array $ids ): int {
		if ( ! Adapter::tables_exist() ) {
			return 0;
		}
		$by_folder = array();
		foreach ( Adapter::folders_of( $ids, 0 ) as $id => $folder ) {
			$by_folder[ $folder ][] = $id;
		}
		global $wpdb;
		$table   = self::table();
		$changed = 0;
		foreach ( $by_folder as $folder => $folder_ids ) {
			foreach ( array_chunk( $folder_ids, 1000 ) as $chunk ) {
				$placeholders = implode( ',', array_fill( 0, count( $chunk ), '%d' ) );
				$changed     += (int) $wpdb->query(
					$wpdb->prepare(
						"UPDATE {$table} SET folder_id = %d WHERE folder_id <> %d AND attachment_id IN ({$placeholders})",
						array_merge( array( $folder, $folder ), $chunk )
					)
				);
			}
		}
		return $changed;
	}

	/**
	 * Computes and writes the rows of these attachments; deletes rows of ids
	 * that are no longer indexable. Rows whose content is unchanged only get a
	 * fresh `indexed_gmt`.
	 *
	 * @param list<int> $ids
	 * @return array{changed: int, added: int, deleted: int}
	 */
	public static function index_ids( array $ids ): array {
		$totals = array(
			'changed' => 0,
			'added'   => 0,
			'deleted' => 0,
		);
		foreach ( array_chunk( $ids, self::BATCH ) as $chunk ) {
			$result             = self::index_chunk( $chunk );
			$totals['changed'] += $result['changed'];
			$totals['added']   += $result['added'];
			$totals['deleted'] += $result['deleted'];
		}
		return $totals;
	}

	/**
	 * @param list<int> $ids
	 * @return array{changed: int, added: int, deleted: int}
	 */
	private static function index_chunk( array $ids ): array {
		global $wpdb;
		$table        = self::table();
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );

		$posts = array();
		$rows  = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT ID, post_type, post_status, post_author, post_date, post_date_gmt, post_modified_gmt, post_mime_type FROM {$wpdb->posts} WHERE ID IN ({$placeholders})",
				$ids
			),
			ARRAY_A
		);
		foreach ( (array) $rows as $row ) {
			$posts[ (int) $row['ID'] ] = $row;
		}

		$existing = array();
		$rows     = $wpdb->get_results(
			$wpdb->prepare( "SELECT * FROM {$table} WHERE attachment_id IN ({$placeholders})", $ids ),
			ARRAY_A
		);
		foreach ( (array) $rows as $row ) {
			$existing[ (int) $row['attachment_id'] ] = $row;
		}

		$indexable = array();
		foreach ( $ids as $id ) {
			$post = $posts[ $id ] ?? null;
			if ( null !== $post && 'attachment' === $post['post_type'] && 'auto-draft' !== $post['post_status'] ) {
				$indexable[] = $id;
			}
		}
		update_meta_cache( 'post', $indexable );
		$folders = Adapter::tables_exist() ? Adapter::folders_of( $indexable, 0 ) : array();

		$result    = array(
			'changed' => 0,
			'added'   => 0,
			'deleted' => 0,
		);
		$to_write  = array();
		$untouched = array();
		$changed   = 0;
		foreach ( $indexable as $id ) {
			$row  = self::compute_row( $posts[ $id ], (int) ( $folders[ $id ] ?? 0 ) );
			$same = isset( $existing[ $id ] ) && self::same_content( $existing[ $id ], $row );
			if ( $same && self::same_modified( $existing[ $id ], $row ) ) {
				$untouched[] = $id;
				continue;
			}
			if ( ! isset( $existing[ $id ] ) ) {
				++$result['added'];
			}
			if ( ! $same ) {
				++$changed; // A new `modified_gmt` alone changes no answer.
			}
			$to_write[] = $row;
		}

		$now = current_time( 'mysql', true );
		if ( array() !== $to_write ) {
			self::write_rows( $to_write, $now );
			$result['changed'] += $changed;
		}
		if ( array() !== $untouched ) {
			$untouched_placeholders = implode( ',', array_fill( 0, count( $untouched ), '%d' ) );
			$wpdb->query(
				$wpdb->prepare(
					"UPDATE {$table} SET indexed_gmt = %s WHERE attachment_id IN ({$untouched_placeholders})",
					array_merge( array( $now ), $untouched )
				)
			);
		}

		$gone = array_values( array_diff( array_keys( $existing ), $indexable ) );
		if ( array() !== $gone ) {
			$gone_placeholders = implode( ',', array_fill( 0, count( $gone ), '%d' ) );
			$deleted           = (int) $wpdb->query(
				$wpdb->prepare( "DELETE FROM {$table} WHERE attachment_id IN ({$gone_placeholders})", $gone )
			);
			$result['deleted'] += $deleted;
			$result['changed'] += $deleted;
		}
		return $result;
	}

	/** Columns written by write_rows(), in order (indexed_gmt is appended). */
	private const COLUMNS = array(
		'attachment_id' => '%d',
		'status'        => '%s',
		'author'        => '%d',
		'uploaded_gmt'  => '%s',
		'month'         => '%s',
		'kind'          => '%d',
		'mime'          => '%s',
		'width'         => '%d',
		'height'        => '%d',
		'pixels'        => '%d',
		'filesize'      => '%d',
		'filename'      => '%s',
		'has_alt'       => '%d',
		'search_extra'  => '%s',
		'duration'      => '%d',
		'pages'         => '%d',
		'folder_id'     => '%d',
		'trashed_gmt'   => '%s',
		'modified_gmt'  => '%s',
		'row_version'   => '%d',
	);

	/** Columns that only track the source, not what any route answers. */
	private const BOOKKEEPING_COLUMNS = array( 'modified_gmt' );

	/**
	 * @param list<array<string, mixed>> $rows
	 */
	private static function write_rows( array $rows, string $now ): void {
		global $wpdb;
		$table   = self::table();
		$columns = array_keys( self::COLUMNS );
		$values  = array();
		foreach ( $rows as $row ) {
			$parts = array();
			foreach ( self::COLUMNS as $column => $format ) {
				$value   = $row[ $column ];
				$parts[] = null === $value ? 'NULL' : $wpdb->prepare( $format, $value );
			}
			$parts[]  = $wpdb->prepare( '%s', $now );
			$values[] = '(' . implode( ',', $parts ) . ')';
		}
		$updates = array();
		foreach ( array_merge( $columns, array( 'indexed_gmt' ) ) as $column ) {
			if ( 'attachment_id' !== $column ) {
				$updates[] = "{$column} = VALUES({$column})";
			}
		}
		// Every value above went through prepare() or is the literal NULL.
		$wpdb->query(
			"INSERT INTO {$table} (" . implode( ',', $columns ) . ',indexed_gmt) VALUES '
			. implode( ',', $values )
			. ' ON DUPLICATE KEY UPDATE ' . implode( ',', $updates )
		);
	}

	/**
	 * @param array<string, mixed> $stored Row as read from the table (strings).
	 * @param array<string, mixed> $row    Freshly computed row.
	 */
	private static function same_content( array $stored, array $row ): bool {
		foreach ( array_keys( self::COLUMNS ) as $column ) {
			if ( in_array( $column, self::BOOKKEEPING_COLUMNS, true ) ) {
				continue;
			}
			$a = $stored[ $column ] ?? null;
			$b = $row[ $column ];
			if ( null === $a || null === $b ) {
				if ( $a !== $b ) {
					return false;
				}
				continue;
			}
			if ( (string) $a !== (string) $b ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Whether the stored row was computed from the attachment as it is now
	 * (its `post_modified_gmt`, compared like SQL's `<=>`).
	 *
	 * @param array<string, mixed> $stored Row as read from the table (strings).
	 * @param array<string, mixed> $row    Freshly computed row.
	 */
	private static function same_modified( array $stored, array $row ): bool {
		$a = $stored['modified_gmt'] ?? null;
		$b = $row['modified_gmt'];
		if ( null === $a || null === $b ) {
			return $a === $b;
		}
		return (string) $a === (string) $b;
	}

	// ---- Computing a row -------------------------------------------------------------------

	/**
	 * @param array<string, string> $post Columns of wp_posts.
	 * @return array<string, mixed>
	 */
	public static function compute_row( array $post, int $folder ): array {
		$id       = (int) $post['ID'];
		$mime     = (string) $post['post_mime_type'];
		$kind     = MediaKinds::from_mime( $mime );
		$meta     = wp_get_attachment_metadata( $id, true );
		$meta     = is_array( $meta ) ? $meta : array();
		$attached = (string) get_post_meta( $id, '_wp_attached_file', true );
		$alt      = (string) get_post_meta( $id, '_wp_attachment_image_alt', true );
		$path     = get_attached_file( $id, true );
		$path     = is_string( $path ) ? $path : '';

		list( $width, $height ) = self::dimensions( $kind, $mime, $meta, $path );

		$filesize = isset( $meta['filesize'] ) && is_numeric( $meta['filesize'] ) ? (int) $meta['filesize'] : null;
		if ( null === $filesize && '' !== $path && is_readable( $path ) ) {
			$size     = @filesize( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
			$filesize = false === $size ? null : (int) $size;
		}

		$filename = ! empty( $meta['original_image'] ) ? wp_basename( (string) $meta['original_image'] ) : wp_basename( $attached );
		if ( '' === $filename && '' !== $path ) {
			$filename = wp_basename( $path );
		}

		$duration = null;
		if ( ( MediaKinds::VIDEO === $kind || MediaKinds::AUDIO === $kind ) && isset( $meta['length'] ) && is_numeric( $meta['length'] ) ) {
			$duration = max( 0, (int) round( (float) $meta['length'] ) );
		}

		$pages = null;
		if ( 'application/pdf' === strtolower( $mime ) ) {
			$pages = self::pdf_pages( $path );
		}

		$image_meta = isset( $meta['image_meta'] ) && is_array( $meta['image_meta'] ) ? $meta['image_meta'] : array();
		$keywords   = isset( $image_meta['keywords'] ) && is_array( $image_meta['keywords'] ) ? $image_meta['keywords'] : array();
		$search     = array_filter(
			array_merge(
				array(
					$alt,
					$attached,
					$filename,
					(string) ( $image_meta['title'] ?? '' ),
					(string) ( $image_meta['caption'] ?? '' ),
				),
				array_map( 'strval', $keywords )
			),
			static function ( $value ) {
				return '' !== trim( $value );
			}
		);

		$uploaded = (string) $post['post_date_gmt'];
		if ( '' === $uploaded || 0 === strpos( $uploaded, '0000-00-00' ) ) {
			$uploaded = get_gmt_from_date( (string) $post['post_date'] );
		}

		// The attachment's own modification time, stored per row: the row is outdated
		// exactly when it differs, so a future-dated `post_modified_gmt` never makes the
		// index look stale (as comparing it with the newest index write did).
		$modified = isset( $post['post_modified_gmt'] ) ? (string) $post['post_modified_gmt'] : null;

		$trashed = null;
		if ( 'trash' === $post['post_status'] ) {
			$trashed_at = get_post_meta( $id, '_wp_trash_meta_time', true );
			if ( is_numeric( $trashed_at ) ) {
				$trashed = gmdate( 'Y-m-d H:i:s', (int) $trashed_at );
			}
		}

		return array(
			'attachment_id' => $id,
			'status'        => (string) $post['post_status'],
			'author'        => (int) $post['post_author'],
			'uploaded_gmt'  => $uploaded,
			'month'         => substr( (string) $post['post_date'], 0, 7 ),
			'kind'          => $kind,
			'mime'          => substr( $mime, 0, 100 ),
			'width'         => $width,
			'height'        => $height,
			'pixels'        => $width * $height,
			'filesize'      => $filesize,
			'filename'      => function_exists( 'mb_substr' ) ? mb_substr( $filename, 0, 255 ) : substr( $filename, 0, 255 ),
			'has_alt'       => '' !== trim( $alt ) ? 1 : 0,
			'search_extra'  => function_exists( 'mb_strtolower' ) ? mb_strtolower( implode( "\n", $search ) ) : strtolower( implode( "\n", $search ) ),
			'duration'      => $duration,
			'pages'         => $pages,
			'folder_id'     => $folder,
			'trashed_gmt'   => $trashed,
			'modified_gmt'  => $modified,
			'row_version'   => self::ROW_VERSION,
		);
	}

	/**
	 * Width and height as the collection rows report them (§5.2): the attached
	 * file for images (the `-scaled` one), SVG from its markup, the frame size
	 * for video, the preview's full size for PDFs, otherwise 0.
	 *
	 * @param array<string, mixed> $meta
	 * @return array{0: int, 1: int}
	 */
	private static function dimensions( int $kind, string $mime, array $meta, string $path ): array {
		$width  = isset( $meta['width'] ) && is_numeric( $meta['width'] ) ? (int) $meta['width'] : 0;
		$height = isset( $meta['height'] ) && is_numeric( $meta['height'] ) ? (int) $meta['height'] : 0;

		if ( MediaKinds::IMAGE === $kind || MediaKinds::VIDEO === $kind ) {
			return array( max( 0, $width ), max( 0, $height ) );
		}
		if ( MediaKinds::SVG === $kind ) {
			if ( $width > 0 && $height > 0 ) {
				return array( $width, $height );
			}
			return self::svg_dimensions( $path );
		}
		if ( 'application/pdf' === strtolower( $mime ) ) {
			$full = $meta['sizes']['full'] ?? null;
			if ( is_array( $full ) && isset( $full['width'], $full['height'] ) ) {
				return array( max( 0, (int) $full['width'] ), max( 0, (int) $full['height'] ) );
			}
		}
		return array( 0, 0 );
	}

	/**
	 * Reads `width`/`height` (unitless or px) from the root element, else the
	 * `viewBox`. Anything else (percentages, ems, unreadable files) is 0 × 0.
	 *
	 * @return array{0: int, 1: int}
	 */
	private static function svg_dimensions( string $path ): array {
		if ( '' === $path || ! is_readable( $path ) ) {
			return array( 0, 0 );
		}
		$head = (string) file_get_contents( $path, false, null, 0, 65536 ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		if ( ! preg_match( '/<svg\b([^>]*)>/i', $head, $match ) ) {
			return array( 0, 0 );
		}
		$attributes = $match[1];
		$length     = static function ( string $name ) use ( $attributes ): float {
			if ( preg_match( '/\s' . $name . '\s*=\s*["\']\s*([0-9.]+)\s*(px)?\s*["\']/i', $attributes, $value ) ) {
				return (float) $value[1];
			}
			return 0.0;
		};
		$width  = $length( 'width' );
		$height = $length( 'height' );
		if ( $width > 0 && $height > 0 ) {
			return array( (int) round( $width ), (int) round( $height ) );
		}
		if ( preg_match( '/\sviewBox\s*=\s*["\']\s*[-0-9.eE]+[\s,]+[-0-9.eE]+[\s,]+([0-9.eE]+)[\s,]+([0-9.eE]+)\s*["\']/', $attributes, $box ) ) {
			$box_width  = (int) round( (float) $box[1] );
			$box_height = (int) round( (float) $box[2] );
			if ( $box_width > 0 && $box_height > 0 ) {
				return array( $box_width, $box_height );
			}
		}
		return array( 0, 0 );
	}

	/**
	 * Best-effort PDF page count. A small PDF is read whole: its page objects,
	 * else the largest /Count. Of a larger one only the first and last
	 * PDF_WINDOW_BYTES are read (the page tree root is usually near one end)
	 * and the largest /Count found there is used, since page objects in a
	 * partial read would undercount. Bounded reads keep a maintenance step
	 * within its budget (§5.21).
	 */
	private static function pdf_pages( string $path ): ?int {
		if ( '' === $path || ! is_readable( $path ) ) {
			return null;
		}
		$size = @filesize( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		if ( false === $size || $size < 1 ) {
			return null;
		}
		if ( $size <= self::PDF_FULL_READ_MAX_BYTES ) {
			$content = (string) @file_get_contents( $path ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
			$pages   = (int) preg_match_all( '#/Type\s*/Page(?![a-zA-Z])#', $content );
			if ( 0 === $pages ) {
				$pages = self::largest_count( $content );
			}
			return $pages > 0 ? $pages : null;
		}
		$head  = (string) @file_get_contents( $path, false, null, 0, self::PDF_WINDOW_BYTES ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$tail  = (string) @file_get_contents( $path, false, null, max( 0, $size - self::PDF_WINDOW_BYTES ), self::PDF_WINDOW_BYTES ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents
		$pages = max( self::largest_count( $head ), self::largest_count( $tail ) );
		return $pages > 0 ? $pages : null;
	}

	/**
	 * The largest `/Count n` in a piece of a PDF (the page tree root's), else 0.
	 */
	private static function largest_count( string $content ): int {
		if ( ! preg_match_all( '#/Count\s+(\d+)#', $content, $counts ) ) {
			return 0;
		}
		return (int) max( array_map( 'intval', $counts[1] ) );
	}

	// ---- Reading ---------------------------------------------------------------------------

	/**
	 * Index rows by attachment id (for the `wpu` field).
	 *
	 * @param list<int> $ids
	 * @return array<int, array<string, string|null>>
	 */
	public static function rows( array $ids ): array {
		if ( array() === $ids ) {
			return array();
		}
		global $wpdb;
		$table  = self::table();
		$result = array();
		foreach ( array_chunk( $ids, 500 ) as $chunk ) {
			$placeholders = implode( ',', array_fill( 0, count( $chunk ), '%d' ) );
			$rows         = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT attachment_id, kind, width, height, filesize, duration, pages FROM {$table} WHERE attachment_id IN ({$placeholders})",
					$chunk
				),
				ARRAY_A
			);
			foreach ( (array) $rows as $row ) {
				$result[ (int) $row['attachment_id'] ] = $row;
			}
		}
		return $result;
	}

	// ---- State (§8.4) ----------------------------------------------------------------------

	/**
	 * @return array{state: string, done: int, total: int, staleSince: int|null, cursor: int}
	 */
	public static function state(): array {
		$stored = get_option( self::OPTION_STATE );
		$stored = is_array( $stored ) ? $stored : array();
		$state  = isset( $stored['state'] ) && in_array( $stored['state'], array( 'ready', 'building', 'stale' ), true )
			? (string) $stored['state']
			: 'building';
		return array(
			'state'      => $state,
			'done'       => isset( $stored['done'] ) ? (int) $stored['done'] : 0,
			'total'      => isset( $stored['total'] ) ? (int) $stored['total'] : 0,
			'staleSince' => isset( $stored['staleSince'] ) ? (int) $stored['staleSince'] : null,
			'cursor'     => isset( $stored['cursor'] ) ? (int) $stored['cursor'] : 0,
		);
	}

	/**
	 * `{state, done, total}` from the option only (cheap enough for GET /rev).
	 *
	 * @return array{state: string, done: int, total: int}
	 */
	public static function status(): array {
		$state = self::state();
		$total = max( 0, (int) $state['total'] );
		$done  = 'ready' === $state['state'] ? $total : min( $total, max( 0, (int) $state['done'] ) );
		return array(
			'state' => $state['state'],
			'done'  => $done,
			'total' => $total,
		);
	}

	public static function is_ready(): bool {
		return 'ready' === self::state()['state']
			&& get_option( self::OPTION_DB_VERSION ) === self::DB_VERSION;
	}

	/**
	 * Marks the index stale (deactivation, a failed consistency check): the
	 * next maintenance steps reconcile every row once.
	 */
	public static function mark_stale(): void {
		$state               = self::state();
		$state['state']      = 'stale';
		$state['staleSince'] = time();
		$state['cursor']     = 0;
		$state['done']       = 0;
		$state['total']      = self::count_attachments();
		self::save_state( $state );
		delete_transient( 'wpu_media_index_check' );
		Rev::touch();
	}

	/**
	 * The cheap consistency check behind /info (§9.3), cached for 60 s: row
	 * count vs attachment count, and any attachment whose `post_modified_gmt`
	 * differs from the one its row was computed from (or that has no row). A
	 * mismatch marks the index stale. Comparing per row (not the newest
	 * modification with the newest index write) keeps a future-dated
	 * attachment from marking the index stale over and over.
	 */
	public static function check_consistency( bool $use_cache = true ): void {
		if ( ! self::is_ready() ) {
			return;
		}
		if ( $use_cache && false !== get_transient( 'wpu_media_index_check' ) ) {
			return;
		}
		global $wpdb;
		$table         = self::table();
		$attachments   = self::count_attachments();
		$rows          = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
		$consistent    = $attachments === $rows;
		if ( $consistent ) {
			$missed     = $wpdb->get_var(
				"SELECT p.ID FROM {$wpdb->posts} p LEFT JOIN {$table} i ON i.attachment_id = p.ID WHERE p.post_type = 'attachment' AND p.post_status <> 'auto-draft' AND (i.attachment_id IS NULL OR NOT (i.modified_gmt <=> p.post_modified_gmt)) LIMIT 1"
			);
			$consistent = null === $missed;
		}
		if ( ! $consistent ) {
			self::mark_stale();
			return;
		}
		set_transient( 'wpu_media_index_check', 1, self::CHECK_TTL );
	}

	public static function count_attachments(): int {
		global $wpdb;
		return (int) $wpdb->get_var(
			"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_status <> 'auto-draft'"
		);
	}

	private static function refresh_total(): void {
		$state = self::state();
		$total = self::count_attachments();
		if ( $total !== (int) $state['total'] ) {
			$state['total'] = $total;
			self::save_state( $state );
		}
	}

	/**
	 * @return array{state: string, done: int, total: int, staleSince: int|null, cursor: int}
	 */
	private static function new_state( string $state ): array {
		return array(
			'state'      => $state,
			'done'       => 0,
			'total'      => 0,
			'staleSince' => null,
			'cursor'     => 0,
		);
	}

	/**
	 * @param array<string, mixed> $state
	 */
	private static function save_state( array $state ): void {
		update_option( self::OPTION_STATE, $state, true );
	}

	// ---- Maintenance (§5.21 steps 3-4) -----------------------------------------------------

	/**
	 * Indexes until the deadline. Returns how many attachments were (re)indexed
	 * or removed, and whether anything visible changed.
	 *
	 * @param float $deadline microtime(true) value to stop at.
	 * @return array{did: int, changed: bool}
	 */
	public static function step( float $deadline ): array {
		$result = array(
			'did'     => 0,
			'changed' => false,
		);
		if ( get_option( self::OPTION_DB_VERSION ) !== self::DB_VERSION ) {
			return $result;
		}
		if ( self::is_ready() ) {
			self::check_consistency( false );
			if ( self::is_ready() ) {
				return $result;
			}
		}

		$state = self::state();
		// The first sub-batch always runs, so every step makes progress even when
		// the budget went on the lock and the schema checks.
		$started = false;
		while ( ! $started || microtime( true ) < $deadline ) {
			$ids = 'stale' === $state['state']
				? self::next_ids( (int) $state['cursor'], false )
				: self::next_ids( (int) $state['cursor'], true );
			if ( array() === $ids ) {
				if ( self::delete_orphans() > 0 ) {
					$result['changed'] = true;
				}
				$state['state']      = 'ready';
				$state['staleSince'] = null;
				$state['cursor']     = 0;
				$state['total']      = self::count_attachments();
				$state['done']       = $state['total'];
				$result['changed']   = true;
				self::save_state( $state );
				set_transient( 'wpu_media_index_check', 1, self::CHECK_TTL );
				return $result;
			}
			// Small sub-batches, each written and recorded in the cursor before the next
			// starts: the deadline is checked between them, and a request killed by the
			// host (max_execution_time) still keeps the work it finished.
			foreach ( array_chunk( $ids, self::SUB_BATCH ) as $chunk ) {
				if ( $started && microtime( true ) >= $deadline ) {
					break 2;
				}
				$started          = true;
				$written          = self::index_chunk( $chunk );
				$result['did']   += count( $chunk );
				$state['cursor']  = (int) max( $chunk );
				if ( $written['changed'] > 0 ) {
					$result['changed'] = true;
				}
				self::save_state( $state );
			}
		}
		$state['total'] = self::count_attachments();
		$state['done']  = self::count_attachments_up_to( (int) $state['cursor'] );
		self::save_state( $state );
		return $result;
	}

	/**
	 * In shared mode, makes `folder_id` match FileBird's relation table for
	 * every row in one statement (reads FileBird's tables, writes only ours).
	 * Returns the number of rows fixed.
	 */
	public static function reconcile_folders(): int {
		if ( ! Adapter::tables_exist() || get_option( self::OPTION_DB_VERSION ) !== self::DB_VERSION ) {
			return 0;
		}
		global $wpdb;
		$table    = self::table();
		$relation = Adapter::relation_table();
		$folders  = Adapter::folder_table();
		return (int) $wpdb->query(
			"UPDATE {$table} i LEFT JOIN (SELECT fa.attachment_id, MIN(fa.folder_id) AS folder_id FROM {$relation} fa INNER JOIN {$folders} f ON f.id = fa.folder_id AND f.created_by = 0 GROUP BY fa.attachment_id) r ON r.attachment_id = i.attachment_id SET i.folder_id = COALESCE(r.folder_id, 0) WHERE i.folder_id <> COALESCE(r.folder_id, 0)"
		);
	}

	/**
	 * The next batch by ascending id: only missing or outdated rows while
	 * building, every attachment while reconciling a stale index.
	 *
	 * @return list<int>
	 */
	private static function next_ids( int $cursor, bool $only_outdated ): array {
		global $wpdb;
		$table = self::table();
		if ( $only_outdated ) {
			$sql = $wpdb->prepare(
				"SELECT p.ID FROM {$wpdb->posts} p LEFT JOIN {$table} i ON i.attachment_id = p.ID WHERE p.post_type = 'attachment' AND p.post_status <> 'auto-draft' AND p.ID > %d AND (i.attachment_id IS NULL OR i.row_version < %d OR NOT (i.modified_gmt <=> p.post_modified_gmt)) ORDER BY p.ID ASC LIMIT %d",
				$cursor,
				self::ROW_VERSION,
				self::BATCH
			);
		} else {
			$sql = $wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_status <> 'auto-draft' AND ID > %d ORDER BY ID ASC LIMIT %d",
				$cursor,
				self::BATCH
			);
		}
		return array_values( array_map( 'intval', (array) $wpdb->get_col( $sql ) ) );
	}

	private static function count_attachments_up_to( int $cursor ): int {
		global $wpdb;
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = 'attachment' AND post_status <> 'auto-draft' AND ID <= %d",
				$cursor
			)
		);
	}

	/**
	 * Rows whose attachment is gone (deleted while the plugin was off).
	 */
	private static function delete_orphans(): int {
		global $wpdb;
		$table = self::table();
		return (int) $wpdb->query(
			"DELETE i FROM {$table} i LEFT JOIN {$wpdb->posts} p ON p.ID = i.attachment_id AND p.post_type = 'attachment' AND p.post_status <> 'auto-draft' WHERE p.ID IS NULL"
		);
	}
}
