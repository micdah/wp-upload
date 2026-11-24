<?php
/**
 * The collection query behind GET /collection and GET /facets
 * (plugin-api.md §5.2-5.3, server-api.md §6): parameter validation, then SQL
 * built from whitelisted fragments.
 *
 * Two shapes:
 * - **index** (the media index is `ready`): FROM `wpu_media_index`, joining
 *   `wp_posts` by primary key only when a filter or sort needs it. Folder
 *   filters use the denormalised `folder_id` in shared mode.
 * - **posts** (index building or stale): FROM `wp_posts` LEFT JOIN the index,
 *   so items without an index row are still listed (0 × 0, kind from the MIME
 *   type, unknown size, no alt/EXIF search), and folder filters read FileBird's
 *   relation table (read-only).
 *
 * SQL safety: every value is an integer cast or went through $wpdb->prepare()
 * on its own fragment; the assembled statement is never passed to prepare()
 * again (the kind CASE holds LIKE patterns with `%`).
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Query;

use WpUpload\Companion\FileBird\Adapter;
use WpUpload\Companion\Index\MediaIndex;
use WpUpload\Companion\Index\MediaKinds;
use WpUpload\Companion\Index\UsageBridge;
use WpUpload\Companion\Support\Errors;
use WpUpload\Companion\Support\Params;

final class CollectionQuery {

	public const SORTS = array( 'date-desc', 'date-asc', 'title-asc', 'name-asc', 'size-desc', 'size-asc', 'dimensions-desc', 'type-asc' );

	public const MAX_ROWS     = 250000;
	public const MAX_Q_LENGTH = 200;
	public const MAX_TERMS    = 10;

	private const TYPES   = array( 'image', 'video', 'audio', 'document' );
	private const SIZES   = array(
		'gt1' => 1000000,
		'gt5' => 5000000,
	);
	private const ORIENTS = array( 'landscape', 'portrait', 'square' );

	/** @var string|int 'all', 'trash' or a folder id (0 = Uncategorized) */
	private $folder = 'all';

	/** @var string|null */
	private $q = null;

	/** @var list<string> */
	private $terms = array();

	/** @var string|null */
	private $type = null;

	/** @var string|null */
	private $alt = null;

	/** @var string|null */
	private $size = null;

	/** @var string|null */
	private $orient = null;

	/** @var string|null */
	private $month = null;

	/** @var string */
	private $sort = 'date-desc';

	/** @var bool */
	private $index_mode;

	/** @var bool */
	private $per_user;

	/** @var int */
	private $owner;

	/** @var Visibility */
	private $visibility;

	private function __construct() {
		$this->index_mode = MediaIndex::is_ready();
		$this->per_user   = Adapter::is_active() && Adapter::is_per_user();
		$this->owner      = Adapter::is_active() ? Adapter::owner() : 0;
		$this->visibility = new Visibility();
	}

	/**
	 * Validates and normalises the query parameters (§5.2 "Params").
	 *
	 * @return self|\WP_Error
	 */
	public static function from_request( \WP_REST_Request $request ) {
		$query = new self();

		$folder = Params::query_string( $request, 'folder' );
		if ( is_wp_error( $folder ) ) {
			return $folder;
		}
		if ( null !== $folder ) {
			if ( ! preg_match( '/^(all|trash|0|[1-9][0-9]*)$/', $folder ) ) {
				return Errors::invalid_param( 'folder', 'folder must be all, trash, 0 or a folder id.' );
			}
			$query->folder = ( 'all' === $folder || 'trash' === $folder ) ? $folder : (int) $folder;
		}

		$q = Params::query_string( $request, 'q' );
		if ( is_wp_error( $q ) ) {
			return $q;
		}
		if ( null !== $q ) {
			$q = Params::collapse_whitespace( $q );
			if ( '' !== $q ) {
				$length = function_exists( 'mb_strlen' ) ? mb_strlen( $q ) : strlen( $q );
				if ( $length > self::MAX_Q_LENGTH ) {
					return Errors::invalid_param( 'q', 'q must be at most 200 characters.' );
				}
				$terms = explode( ' ', $q );
				if ( count( $terms ) > self::MAX_TERMS ) {
					return Errors::invalid_param( 'q', 'q must have at most 10 terms.' );
				}
				$query->q     = $q;
				$query->terms = $terms;
			}
		}

		$enums = array(
			'type'   => self::TYPES,
			'alt'    => array( 'missing' ),
			'size'   => array_keys( self::SIZES ),
			'orient' => self::ORIENTS,
			'sort'   => self::SORTS,
		);
		foreach ( $enums as $param => $allowed ) {
			$value = Params::query_string( $request, $param );
			if ( is_wp_error( $value ) ) {
				return $value;
			}
			if ( null === $value ) {
				continue;
			}
			if ( ! in_array( $value, $allowed, true ) ) {
				return Errors::invalid_param( $param, sprintf( '%s must be one of: %s.', $param, implode( ', ', $allowed ) ) );
			}
			$query->{$param} = $value;
		}

		$month = Params::query_string( $request, 'month' );
		if ( is_wp_error( $month ) ) {
			return $month;
		}
		if ( null !== $month ) {
			if ( ! preg_match( '/^[0-9]{4}-(0[1-9]|1[0-2])$/', $month ) ) {
				return Errors::invalid_param( 'month', 'month must be YYYY-MM.' );
			}
			$query->month = $month;
		}

		if ( 'trash' === $query->folder ) {
			// The Trash ignores every other filter and the sort (§5.2 `folder`).
			$query->q      = null;
			$query->terms  = array();
			$query->type   = null;
			$query->alt    = null;
			$query->size   = null;
			$query->orient = null;
			$query->month  = null;
			$query->sort   = 'date-desc';
		}

		if ( is_int( $query->folder ) ) {
			if ( ! Adapter::is_active() ) {
				return Errors::filebird_inactive();
			}
			if ( $query->folder > 0 && ! Adapter::folder_exists( $query->folder, $query->owner ) ) {
				return Errors::folder_not_found( $query->folder );
			}
		}
		return $query;
	}

	/**
	 * The normalised parameters, every key present (`CollectionQuery`).
	 *
	 * @return array<string, mixed>
	 */
	public function to_array(): array {
		return array(
			'folder' => $this->folder,
			'q'      => $this->q,
			'type'   => $this->type,
			'alt'    => $this->alt,
			'size'   => $this->size,
			'orient' => $this->orient,
			'month'  => $this->month,
			'sort'   => $this->sort,
		);
	}

	public function index_complete(): bool {
		return $this->index_mode;
	}

	// ---- /collection -----------------------------------------------------------------------

	/**
	 * `[id, width, height, kindCode]` per item, flattened, in order.
	 *
	 * @return array{total: int, rows: list<int>}|\WP_Error 422 `wpu_collection_too_large` beyond 250 000 items.
	 */
	public function rows() {
		global $wpdb;
		$c     = $this->columns();
		$order = $this->order_by( $c );
		$sql   = "SELECT {$c['id']}, {$c['width']}, {$c['height']}, {$c['kind']}"
			. $this->from( $this->needs_posts_for_rows() )
			. ' WHERE ' . implode( ' AND ', $this->conditions( true ) )
			. " ORDER BY {$order} LIMIT " . ( self::MAX_ROWS + 1 );

		$result = $wpdb->get_results( $sql, ARRAY_N ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		if ( count( (array) $result ) > self::MAX_ROWS ) {
			$total = (int) $wpdb->get_var( // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
				'SELECT COUNT(*)' . $this->from( $this->needs_posts_for_rows() ) . ' WHERE ' . implode( ' AND ', $this->conditions( true ) )
			);
			return Errors::make(
				'wpu_collection_too_large',
				'The collection has more than 250 000 items; narrow it with a filter.',
				422,
				array( 'total' => $total )
			);
		}
		$rows = array();
		foreach ( (array) $result as $row ) {
			$rows[] = (int) $row[0];
			$rows[] = (int) $row[1];
			$rows[] = (int) $row[2];
			$rows[] = (int) $row[3];
		}
		return array(
			'total' => intdiv( count( $rows ), 4 ),
			'rows'  => $rows,
		);
	}

	// ---- /facets ---------------------------------------------------------------------------

	/**
	 * `view`, `folder` and `months` of the Facets response.
	 *
	 * @return array{view: array<string, mixed>, folder: array<string, mixed>, months: list<array{month: string, count: int}>}
	 */
	public function facets(): array {
		$view   = $this->counts( true );
		$folder = $this->has_filters() ? $this->counts( false ) : $view;
		return array(
			'view'   => $view,
			'folder' => $folder,
			'months' => 'trash' === $this->folder ? array() : $this->months(),
		);
	}

	/**
	 * @return array<string, mixed>
	 */
	private function counts( bool $with_filters ): array {
		global $wpdb;
		$c        = $this->columns();
		$unused   = UsageBridge::unused_condition( $c['id'] );
		$editable = $this->visibility->can_edit_others() ? 'COUNT(*)' : 'SUM(' . $c['author'] . ' = ' . (int) $this->visibility->user() . ')';
		$needs_posts = $with_filters ? $this->needs_posts_for_filters() : $this->visibility->needs_parent();

		$sql = 'SELECT COUNT(*) AS total'
			. ", SUM(COALESCE({$c['filesize']}, 0)) AS bytes"
			. ", SUM({$c['kind']} IN (0,1)) AS image"
			. ", SUM({$c['kind']} = 2) AS video"
			. ", SUM({$c['kind']} = 3) AS audio"
			. ", SUM({$c['kind']} >= 4) AS document"
			. ", SUM({$c['kind']} IN (0,1) AND {$c['has_alt']} = 0) AS missing_alt"
			. ", SUM({$unused}) AS unused"
			. ", {$editable} AS editable"
			. $this->from( $needs_posts )
			. ' WHERE ' . implode( ' AND ', $this->conditions( $with_filters ) );

		$row = (array) $wpdb->get_row( $sql, ARRAY_A ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		return array(
			'total'      => (int) ( $row['total'] ?? 0 ),
			'bytes'      => (int) ( $row['bytes'] ?? 0 ),
			'types'      => array(
				'image'    => (int) ( $row['image'] ?? 0 ),
				'video'    => (int) ( $row['video'] ?? 0 ),
				'audio'    => (int) ( $row['audio'] ?? 0 ),
				'document' => (int) ( $row['document'] ?? 0 ),
			),
			'missingAlt' => (int) ( $row['missing_alt'] ?? 0 ),
			'unused'     => (int) ( $row['unused'] ?? 0 ),
			'editable'   => (int) ( $row['editable'] ?? 0 ),
		);
	}

	/**
	 * Months with items in the folder alone, newest first.
	 *
	 * @return list<array{month: string, count: int}>
	 */
	private function months(): array {
		global $wpdb;
		$c   = $this->columns();
		$sql = "SELECT {$c['month']} AS month, COUNT(*) AS c"
			. $this->from( $this->visibility->needs_parent() )
			. ' WHERE ' . implode( ' AND ', $this->conditions( false ) )
			. " GROUP BY {$c['month']} ORDER BY {$c['month']} DESC";

		$months = array();
		foreach ( (array) $wpdb->get_results( $sql, ARRAY_A ) as $row ) { // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			if ( preg_match( '/^[0-9]{4}-(0[1-9]|1[0-2])$/', (string) $row['month'] ) && (int) $row['c'] > 0 ) {
				$months[] = array(
					'month' => (string) $row['month'],
					'count' => (int) $row['c'],
				);
			}
		}
		return $months;
	}

	// ---- SQL building ----------------------------------------------------------------------

	private function has_filters(): bool {
		return null !== $this->q || null !== $this->type || null !== $this->alt || null !== $this->size
			|| null !== $this->orient || null !== $this->month;
	}

	private function needs_posts_for_filters(): bool {
		return $this->visibility->needs_parent() || array() !== $this->terms;
	}

	private function needs_posts_for_rows(): bool {
		return $this->needs_posts_for_filters() || 'title-asc' === $this->sort;
	}

	/**
	 * Column expressions for the current shape.
	 *
	 * @return array<string, string>
	 */
	private function columns(): array {
		if ( $this->index_mode ) {
			return array(
				'id'           => 'i.attachment_id',
				'status'       => 'i.status',
				'author'       => 'i.author',
				'kind'         => 'i.kind',
				'width'        => 'i.width',
				'height'       => 'i.height',
				'pixels'       => 'i.pixels',
				'filesize'     => 'i.filesize',
				'filename'     => 'i.filename',
				'has_alt'      => 'i.has_alt',
				'month'        => 'i.month',
				'uploaded'     => 'i.uploaded_gmt',
				'mime'         => 'i.mime',
				'trashed'      => 'i.trashed_gmt',
				'search_extra' => 'i.search_extra',
			);
		}
		return array(
			'id'           => 'p.ID',
			'status'       => 'p.post_status',
			'author'       => 'p.post_author',
			'kind'         => 'COALESCE(i.kind, ' . MediaKinds::sql_case( 'p.post_mime_type' ) . ')',
			'width'        => 'COALESCE(i.width, 0)',
			'height'       => 'COALESCE(i.height, 0)',
			'pixels'       => 'COALESCE(i.pixels, 0)',
			'filesize'     => 'i.filesize',
			'filename'     => "COALESCE(i.filename, '')",
			'has_alt'      => 'COALESCE(i.has_alt, 0)',
			'month'        => 'LEFT(p.post_date, 7)',
			'uploaded'     => 'p.post_date_gmt',
			'mime'         => 'p.post_mime_type',
			'trashed'      => 'COALESCE(i.trashed_gmt, p.post_modified_gmt)',
			'search_extra' => "COALESCE(i.search_extra, '')",
		);
	}

	private function from( bool $needs_posts ): string {
		global $wpdb;
		$index = MediaIndex::table();
		if ( $this->index_mode ) {
			$from = " FROM {$index} i";
			if ( $needs_posts ) {
				$from .= " INNER JOIN {$wpdb->posts} p ON p.ID = i.attachment_id";
			}
		} else {
			$from = " FROM {$wpdb->posts} p LEFT JOIN {$index} i ON i.attachment_id = p.ID";
		}
		return $from;
	}

	/**
	 * @param bool $with_filters false: visibility and folder only (the `folder` facet, months).
	 * @return list<string>
	 */
	private function conditions( bool $with_filters ): array {
		global $wpdb;
		$c          = $this->columns();
		$conditions = array();
		if ( ! $this->index_mode ) {
			$conditions[] = "p.post_type = 'attachment'";
		}

		if ( 'trash' === $this->folder ) {
			$conditions[] = $this->visibility->trash( $c['status'], $c['author'] );
			return $conditions;
		}
		$conditions[] = $this->visibility->live( $c['status'], $c['author'] );

		if ( is_int( $this->folder ) ) {
			$conditions[] = $this->folder_condition( $this->folder, $c['id'] );
		}
		if ( ! $with_filters ) {
			return $conditions;
		}

		foreach ( $this->terms as $term ) {
			$like         = '%' . $wpdb->esc_like( $term ) . '%';
			$lower        = '%' . $wpdb->esc_like( function_exists( 'mb_strtolower' ) ? mb_strtolower( $term ) : strtolower( $term ) ) . '%';
			$conditions[] = $wpdb->prepare(
				"(p.post_title LIKE %s OR p.post_excerpt LIKE %s OR p.post_content LIKE %s OR {$c['search_extra']} LIKE %s)",
				$like,
				$like,
				$like,
				$lower
			);
		}
		if ( null !== $this->type ) {
			$conditions[] = "{$c['kind']} IN (" . implode( ',', MediaKinds::TYPE_FILTER_CODES[ $this->type ] ) . ')';
			if ( 'document' === $this->type ) {
				// Unknown codes from a newer row format count as `other`.
				$conditions[ count( $conditions ) - 1 ] = "{$c['kind']} >= 4";
			}
		}
		if ( 'missing' === $this->alt ) {
			$conditions[] = "{$c['kind']} IN (0,1) AND {$c['has_alt']} = 0";
		}
		if ( null !== $this->size ) {
			$conditions[] = "{$c['filesize']} > " . (int) self::SIZES[ $this->size ];
		}
		if ( null !== $this->orient ) {
			$w            = $c['width'];
			$h            = $c['height'];
			$known        = "{$w} > 0 AND {$h} > 0";
			$landscape    = "{$w} * 10 > {$h} * 11";
			$portrait     = "{$w} * 10 < {$h} * 9";
			$conditions[] = 'landscape' === $this->orient
				? "({$known} AND {$landscape})"
				: ( 'portrait' === $this->orient
					? "({$known} AND {$portrait})"
					: "({$known} AND NOT ({$landscape}) AND NOT ({$portrait}))" );
		}
		if ( null !== $this->month ) {
			$conditions[] = $wpdb->prepare( "{$c['month']} = %s", $this->month );
		}
		return $conditions;
	}

	/**
	 * `folder=<id>`: a relation row for exactly that folder. `folder=0`: no row
	 * in the owner's tree (shared tree, or this user's in per-user mode).
	 */
	private function folder_condition( int $folder, string $id ): string {
		if ( $this->index_mode && ! $this->per_user ) {
			return 'i.folder_id = ' . $folder;
		}
		$relation = Adapter::relation_table();
		$folders  = Adapter::folder_table();
		if ( $folder > 0 ) {
			return "EXISTS (SELECT 1 FROM {$relation} fa WHERE fa.attachment_id = {$id} AND fa.folder_id = {$folder})";
		}
		$owner = (int) $this->owner;
		return "NOT EXISTS (SELECT 1 FROM {$relation} fa INNER JOIN {$folders} f ON f.id = fa.folder_id AND f.created_by = {$owner} WHERE fa.attachment_id = {$id})";
	}

	/**
	 * ORDER BY for the sort key; ties always end with the id (§5.2 `sort`).
	 *
	 * @param array<string, string> $c
	 */
	private function order_by( array $c ): string {
		if ( 'trash' === $this->folder ) {
			return "{$c['trashed']} DESC, {$c['id']} DESC";
		}
		switch ( $this->sort ) {
			case 'date-asc':
				return "{$c['uploaded']} ASC, {$c['id']} ASC";
			case 'title-asc':
				return "p.post_title ASC, {$c['id']} ASC";
			case 'name-asc':
				return "{$c['filename']} ASC, {$c['id']} ASC";
			case 'size-desc':
				return "{$c['filesize']} IS NULL ASC, {$c['filesize']} DESC, {$c['id']} DESC";
			case 'size-asc':
				return "{$c['filesize']} IS NULL ASC, {$c['filesize']} ASC, {$c['id']} ASC";
			case 'dimensions-desc':
				return "{$c['pixels']} = 0 ASC, {$c['pixels']} DESC, {$c['id']} DESC";
			case 'type-asc':
				return "{$c['mime']} ASC, {$c['uploaded']} DESC, {$c['id']} DESC";
			default:
				return "{$c['uploaded']} DESC, {$c['id']} DESC";
		}
	}
}
