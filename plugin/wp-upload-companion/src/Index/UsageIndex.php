<?php
/**
 * The usage index: the `wpu_usage` and `wpu_usage_sources` tables, the hooks
 * that keep them current, and the time-budgeted backfill that
 * `POST /maintenance/step` drives (docs/media-manager/contracts/plugin-api.md
 * §5.21, §6, §8.2, §9).
 *
 * Owned by track P2. P1's maintenance step, `/info`, `/rev` and facets call
 * the public static methods below.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Index;

use WpUpload\Companion\Field\WpuField;
use WpUpload\Companion\Mutation\OptionLock;
use WpUpload\Companion\Mutation\Rev;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Usage\Parser;
use WpUpload\Companion\Usage\UsageCountProvider;

final class UsageIndex {

	/** Schema version; a change runs dbDelta() (§9.2). 2: `modified_gmt` on sources. */
	public const DB_VERSION = '2';

	/** Parser version; sources scanned with a lower one are rescanned. 2: fills `modified_gmt`. */
	public const ROW_VERSION = 2;

	public const DB_VERSION_OPTION = 'wpu_usage_index_db_version';
	public const STATE_OPTION      = 'wpu_usage_index_state';
	private const SCHEMA_LOCK      = 'wpu_usage_index_schema_lock';

	/** Posts per backfill batch (§5.21). */
	private const BATCH = 50;

	/** Post types with `show_ui` that never use media in a way we index (§8.2). */
	private const EXCLUDED_TYPES = array( 'attachment', 'revision', 'nav_menu_item', 'wp_global_styles', 'wp_font_family', 'wp_font_face' );

	/** Types indexed even when a site hides their UI (§8.2). */
	private const ALWAYS_TYPES = array( 'wp_template', 'wp_template_part', 'wp_block', 'wp_navigation' );

	private const STATUSES = array( 'publish', 'future', 'draft', 'pending', 'private' );

	/** Site-level options that hold a used attachment id. */
	private const SITE_OPTIONS = array( 'site_logo', 'site_icon' );

	private static ?Parser $parser = null;

	public static function register(): void {
		Plugin::provide_feature( 'usage' );
		Plugin::provide_feature( 'usage-visual-portfolio' );
		WpuField::add_provider( new UsageCountProvider() );
		self::ensure_schema();

		add_action( 'save_post', array( self::class, 'on_save_post' ), 20, 2 );
		add_action( 'deleted_post', array( self::class, 'on_deleted_post' ), 10, 2 );
		add_action( 'trashed_post', array( self::class, 'on_post_changed' ) );
		add_action( 'untrashed_post', array( self::class, 'on_post_changed' ) );
		add_action( 'delete_attachment', array( self::class, 'on_delete_attachment' ) );
		foreach ( array( 'added_post_meta', 'updated_post_meta', 'deleted_post_meta' ) as $hook ) {
			add_action( $hook, array( self::class, 'on_post_meta' ), 10, 3 );
		}
		foreach ( self::SITE_OPTIONS as $option ) {
			add_action( "add_option_{$option}", array( self::class, 'on_site_option' ) );
			add_action( "update_option_{$option}", array( self::class, 'on_site_option' ) );
			add_action( "delete_option_{$option}", array( self::class, 'on_site_option' ) );
		}
		add_action( 'updated_option', array( self::class, 'on_updated_option' ) );
		// The first set_theme_mod() for a theme creates its option instead of updating it.
		add_action( 'added_option', array( self::class, 'on_updated_option' ) );
		add_action( 'init', array( self::class, 'check_visual_portfolio' ), 99 );
	}

	// -------------------------------------------------------------------------
	// Public API for P1 (maintenance step, /info, /rev, facets) and P2 routes.
	// -------------------------------------------------------------------------

	public static function usage_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'wpu_usage';
	}

	public static function sources_table(): string {
		global $wpdb;
		return $wpdb->prefix . 'wpu_usage_sources';
	}

	/**
	 * Whether the `visual-portfolio` context is scanned: only while Visual
	 * Portfolio is active (feature `usage-visual-portfolio`, D22).
	 */
	public static function visual_portfolio_active(): bool {
		return class_exists( '\Visual_Portfolio' ) || function_exists( 'visual_portfolio' );
	}

	/**
	 * `index.usage` for `/info` and `/rev`, from the state option only (no
	 * query). Maintenance steps recount; hooks keep `total` current.
	 *
	 * @return array{state: string, done: int, total: int}
	 */
	public static function status(): array {
		$state = self::state();
		return array(
			'state' => $state['state'],
			'done'  => 'ready' === $state['state'] ? $state['total'] : min( $state['done'], $state['total'] ),
			'total' => $state['total'],
		);
	}

	/**
	 * SQL true when the attachment has no usage row (the `unused` facet).
	 * `$attachment_id_sql` is a column expression from P1's query, never input.
	 */
	public static function unused_condition( string $attachment_id_sql ): string {
		return 'NOT EXISTS (SELECT 1 FROM ' . self::usage_table() . " wpu_u WHERE wpu_u.attachment_id = {$attachment_id_sql})";
	}

	/**
	 * Whether `usage` answers are complete (`/usage.complete`, facets'
	 * `usageComplete`, `wpu.usageCount` not null).
	 */
	public static function complete(): bool {
		return 'ready' === self::state()['state'];
	}

	/**
	 * One budgeted unit of backfill (§5.21 step 5): drops sources of posts
	 * that are gone, scans posts not yet scanned or changed since, then the
	 * site-level slots. Called by P1's `POST /maintenance/step`.
	 *
	 * @param float $deadline `microtime(true)` value after which no new post is started.
	 * @return array{did: int, more: bool, changed: bool}
	 */
	public static function step( float $deadline ): array {
		$state   = self::state();
		$did     = 0;
		$changed = self::drop_orphan_sources();

		while ( self::now() < $deadline ) {
			$ids = self::pending_ids( $state );
			if ( array() === $ids ) {
				if ( null === $state['cursor'] ) {
					break;
				}
				// The reconcile pass is past the last post (its last batch was full, or there
				// were none): end it, then look for regular pending posts.
				$state['cursor'] = null;
				self::save_state( $state );
				continue;
			}
			foreach ( $ids as $id ) {
				if ( self::now() >= $deadline ) {
					break 2;
				}
				$changed = self::reindex_post( $id ) || $changed;
				++$did;
				if ( null !== $state['cursor'] ) {
					$state['cursor'] = $id;
				}
			}
			if ( null !== $state['cursor'] && count( $ids ) < self::BATCH ) {
				$state['cursor'] = null; // The reconcile pass reached the end.
			}
			self::save_state( $state );
		}

		if ( self::now() < $deadline && self::site_needs_scan() ) {
			$changed = self::reindex_site() || $changed;
			++$did;
		}

		$more = null !== $state['cursor'] || array() !== self::pending_ids( $state ) || self::site_needs_scan();
		if ( ! $more && 'ready' !== $state['state'] ) {
			$state['state']      = 'ready';
			$state['staleSince'] = null;
			$changed             = true;
		}
		$status          = self::status_from( $state );
		$state['done']   = $status['done'];
		$state['total']  = $status['total'];
		self::save_state( $state );
		if ( $changed ) {
			Rev::touch();
		}
		return array(
			'did'     => $did,
			'more'    => $more,
			'changed' => $changed,
		);
	}

	/**
	 * Marks the index stale (deactivation, a failed consistency check, §9.3):
	 * the next maintenance steps rescan every post once.
	 */
	public static function mark_stale(): void {
		$state               = self::state();
		$state['state']      = 'stale';
		$state['staleSince'] = gmdate( 'Y-m-d\TH:i:s\Z' );
		$state['cursor']     = 0;
		self::save_state( $state );
		// The site-level slots are rescanned too (options may have changed while hooks didn't run).
		global $wpdb;
		$wpdb->update( self::sources_table(), array( 'row_version' => 0 ), array( 'source_id' => 0 ), array( '%d' ), array( '%d' ) );
		Rev::touch();
	}

	/**
	 * The cheap check `/info` runs (§9.3): an indexable post whose
	 * `post_modified_gmt` differs from the one recorded when it was scanned
	 * (or that was never scanned) means hooks were missed. Cached for 60 s.
	 */
	public static function check_consistency( bool $use_cache = true ): void {
		if ( 'ready' !== self::state()['state'] ) {
			return;
		}
		if ( $use_cache && false !== get_transient( 'wpu_usage_consistency' ) ) {
			return;
		}
		set_transient( 'wpu_usage_consistency', 1, MINUTE_IN_SECONDS );
		global $wpdb;
		[ $type_sql, $status_sql ] = self::indexable_sql( 'p' );
		$missed                    = $wpdb->get_var( "SELECT p.ID FROM {$wpdb->posts} p LEFT JOIN " . self::sources_table() . " s ON s.source_id = p.ID WHERE {$type_sql} AND {$status_sql} AND (s.source_id IS NULL OR NOT (s.modified_gmt <=> p.post_modified_gmt)) LIMIT 1" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		if ( null !== $missed ) {
			self::mark_stale();
		}
	}

	/**
	 * Refs per attachment (distinct using posts, plus one per site-level
	 * slot), for `wpu.usageCount` and `/usage.count`.
	 *
	 * @param list<int> $ids
	 * @return array<int, int> id => count (0 for unused)
	 */
	public static function counts( array $ids ): array {
		$counts = array_fill_keys( $ids, 0 );
		if ( array() === $ids ) {
			return $counts;
		}
		global $wpdb;
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$rows         = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT attachment_id, COUNT(DISTINCT CASE WHEN source_id = 0 THEN CONCAT(\'s:\', context) ELSE source_id END) AS refs FROM ' . self::usage_table() . " WHERE attachment_id IN ({$placeholders}) GROUP BY attachment_id", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				...$ids
			)
		);
		foreach ( (array) $rows as $row ) {
			$counts[ (int) $row->attachment_id ] = (int) $row->refs;
		}
		return $counts;
	}

	/**
	 * Every usage row of the given attachments.
	 *
	 * @param list<int> $ids
	 * @return list<object{attachment_id: string, source_id: string, context: string}>
	 */
	public static function rows_for( array $ids ): array {
		if ( array() === $ids ) {
			return array();
		}
		global $wpdb;
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		return array_values(
			(array) $wpdb->get_results(
				$wpdb->prepare(
					'SELECT attachment_id, source_id, context FROM ' . self::usage_table() . " WHERE attachment_id IN ({$placeholders})", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
					...$ids
				)
			)
		);
	}

	/**
	 * Scans one post and replaces its rows. Returns true when its set of
	 * rows changed (only then does rev move, §6).
	 */
	public static function reindex_post( int $post_id ): bool {
		$post = get_post( $post_id );
		if ( ! $post instanceof \WP_Post || ! self::is_indexable( $post ) ) {
			return self::remove_source( $post_id );
		}
		$changed = self::replace_rows( $post_id, self::parser()->parse_post( $post ) );
		self::mark_scanned( $post_id, $post->post_modified_gmt );
		return $changed;
	}

	/**
	 * Scans the site-level slots (source 0).
	 */
	public static function reindex_site(): bool {
		$changed = self::replace_rows( 0, self::parser()->parse_site() );
		self::mark_scanned( 0, null );
		return $changed;
	}

	/**
	 * The post types the index covers (§8.2), resolved at call time so types
	 * registered by other plugins count.
	 *
	 * @return list<string>
	 */
	public static function indexable_types(): array {
		$types = array_keys( get_post_types( array( 'show_ui' => true ) ) );
		$types = array_merge( $types, array_filter( self::ALWAYS_TYPES, 'post_type_exists' ) );
		return array_values( array_unique( array_diff( $types, self::EXCLUDED_TYPES ) ) );
	}

	public static function is_indexable( \WP_Post $post ): bool {
		return in_array( $post->post_type, self::indexable_types(), true ) && in_array( $post->post_status, self::STATUSES, true );
	}

	// -------------------------------------------------------------------------
	// Hooks
	// -------------------------------------------------------------------------

	public static function on_save_post( int $post_id, \WP_Post $post ): void {
		if ( in_array( $post->post_type, array( 'revision', 'attachment' ), true ) || 'auto-draft' === $post->post_status || wp_is_post_autosave( $post_id ) ) {
			return;
		}
		self::changed_post( $post_id, $post );
	}

	public static function on_post_changed( int $post_id ): void {
		$post = get_post( $post_id );
		if ( $post instanceof \WP_Post ) {
			self::changed_post( $post_id, $post );
		}
	}

	/**
	 * @param \WP_Post|null $post The deleted post (WordPress passes it since 5.5).
	 */
	public static function on_deleted_post( int $post_id, $post = null ): void {
		if ( self::remove_source( $post_id ) ) {
			Rev::touch();
		}
		if ( $post instanceof \WP_Post && 'vp_lists' === $post->post_type ) {
			self::rescan_layout_users( $post_id );
		}
	}

	/**
	 * A deleted attachment is used nowhere any more.
	 */
	public static function on_delete_attachment( int $attachment_id ): void {
		global $wpdb;
		$wpdb->delete( self::usage_table(), array( 'attachment_id' => $attachment_id ), array( '%d' ) );
	}

	/**
	 * `_thumbnail_id` (featured image) and Visual Portfolio's `vp_images`
	 * change without a post save when set through the REST API or code.
	 */
	/**
	 * @param int|int[] $meta_id  Meta id(s) (unused).
	 * @param int       $post_id  The post.
	 * @param string    $meta_key The meta key.
	 */
	public static function on_post_meta( $meta_id, $post_id, $meta_key ): void {
		if ( '_thumbnail_id' !== $meta_key && 'vp_images' !== $meta_key ) {
			return;
		}
		$post = get_post( (int) $post_id );
		if ( $post instanceof \WP_Post && 'attachment' !== $post->post_type ) {
			self::changed_post( (int) $post_id, $post );
		}
	}

	public static function on_site_option(): void {
		if ( self::reindex_site() ) {
			Rev::touch();
		}
	}

	/**
	 * Classic themes keep the logo in the `custom_logo` theme mod.
	 */
	public static function on_updated_option( string $option ): void {
		if ( str_starts_with( $option, 'theme_mods_' ) ) {
			self::on_site_option();
		}
	}

	/**
	 * Visual Portfolio was activated or deactivated since the last request:
	 * its context appears or disappears (D22).
	 */
	public static function check_visual_portfolio(): void {
		$state  = self::state();
		$active = self::visual_portfolio_active();
		if ( $state['vp'] === $active ) {
			return;
		}
		global $wpdb;
		$state['vp'] = $active;
		if ( $active ) {
			// Rescan the posts that can hold Visual Portfolio galleries.
			$wpdb->query(
				$wpdb->prepare(
					'UPDATE ' . self::sources_table() . " s INNER JOIN {$wpdb->posts} p ON p.ID = s.source_id SET s.row_version = 0 WHERE p.post_type = %s OR p.post_content LIKE %s OR p.post_content LIKE %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
					'vp_lists',
					'%' . $wpdb->esc_like( 'visual-portfolio' ) . '%',
					'%' . $wpdb->esc_like( '[visual_portfolio' ) . '%'
				)
			);
			if ( 'ready' === $state['state'] ) {
				$state['state'] = 'building';
			}
		} else {
			$wpdb->delete( self::usage_table(), array( 'context' => 'visual-portfolio' ), array( '%s' ) );
		}
		self::save_state( $state );
		Rev::touch();
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private static function changed_post( int $post_id, \WP_Post $post ): void {
		if ( self::reindex_post( $post_id ) ) {
			Rev::touch();
		}
		if ( 'vp_lists' === $post->post_type ) {
			self::rescan_layout_users( $post_id );
		}
	}

	/**
	 * Posts that embed a saved layout report its images (§8.2), so they are
	 * rescanned when the layout changes. A few are done now, the rest are
	 * left for the maintenance step.
	 */
	private static function rescan_layout_users( int $layout_id ): void {
		global $wpdb;
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type NOT IN ('revision', 'attachment') AND ID <> %d AND (post_content LIKE %s OR post_content LIKE %s) ORDER BY ID",
				$layout_id,
				'%' . $wpdb->esc_like( 'visual-portfolio' ) . '%',
				'%' . $wpdb->esc_like( '[visual_portfolio' ) . '%'
			)
		);
		$changed = false;
		foreach ( array_map( 'intval', (array) $ids ) as $index => $id ) {
			if ( $index < self::BATCH ) {
				$changed = self::reindex_post( $id ) || $changed;
			} else {
				$wpdb->update( self::sources_table(), array( 'row_version' => 0 ), array( 'source_id' => $id ), array( '%d' ), array( '%d' ) );
			}
		}
		if ( $changed ) {
			Rev::touch();
		}
	}

	/**
	 * @param array<int, list<string>> $refs attachment id => contexts
	 */
	private static function replace_rows( int $source_id, array $refs ): bool {
		global $wpdb;
		$table = self::usage_table();
		$new   = array();
		foreach ( $refs as $attachment_id => $contexts ) {
			foreach ( $contexts as $context ) {
				$new[ $attachment_id . '|' . $context ] = array( $attachment_id, $context );
			}
		}
		$old_rows = $wpdb->get_results( $wpdb->prepare( "SELECT attachment_id, context FROM {$table} WHERE source_id = %d", $source_id ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$old      = array();
		foreach ( (array) $old_rows as $row ) {
			$old[ $row->attachment_id . '|' . $row->context ] = true;
		}
		if ( array() === array_diff_key( $old, $new ) && array() === array_diff_key( $new, $old ) ) {
			return false;
		}
		$wpdb->delete( $table, array( 'source_id' => $source_id ), array( '%d' ) );
		foreach ( array_chunk( array_values( $new ), 200 ) as $chunk ) {
			$values = array();
			$args   = array();
			foreach ( $chunk as [ $attachment_id, $context ] ) {
				$values[] = '(%d, %d, %s)';
				array_push( $args, $attachment_id, $source_id, $context );
			}
			$wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$table} (attachment_id, source_id, context) VALUES " . implode( ',', $values ), ...$args ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		}
		return true;
	}

	/**
	 * Records the scan with the post's `post_modified_gmt` at that time; a post
	 * is pending again only when that value changes (a future-dated
	 * `post_modified_gmt` would otherwise look newer than every scan).
	 */
	private static function mark_scanned( int $source_id, ?string $modified_gmt ): void {
		global $wpdb;
		$affected = $wpdb->replace(
			self::sources_table(),
			array(
				'source_id'    => $source_id,
				'scanned_gmt'  => current_time( 'mysql', true ),
				'modified_gmt' => $modified_gmt,
				'row_version'  => self::ROW_VERSION,
			),
			array( '%d', '%s', '%s', '%d' )
		);
		// REPLACE reports 1 for a new row and 2 for a replaced one.
		if ( 1 === $affected && $source_id > 0 ) {
			self::adjust_total( 1 );
		}
	}

	private static function remove_source( int $source_id ): bool {
		global $wpdb;
		$removed = (int) $wpdb->delete( self::usage_table(), array( 'source_id' => $source_id ), array( '%d' ) );
		$source  = (int) $wpdb->delete( self::sources_table(), array( 'source_id' => $source_id ), array( '%d' ) );
		if ( $source > 0 && $source_id > 0 ) {
			self::adjust_total( -1 );
		}
		return $removed > 0;
	}

	/**
	 * Keeps the stored counts of `status()` current between maintenance
	 * steps, without counting queries.
	 */
	private static function adjust_total( int $delta ): void {
		$state          = self::state();
		$state['total'] = max( 0, $state['total'] + $delta );
		$state['done']  = max( 0, min( $state['total'], $state['done'] + $delta ) );
		self::save_state( $state );
	}

	/**
	 * Drops the rows of posts that were deleted, trashed or became
	 * unindexable while hooks didn't run.
	 */
	private static function drop_orphan_sources(): bool {
		global $wpdb;
		[ $type_sql, $status_sql ] = self::indexable_sql( 'p' );
		$ids                       = $wpdb->get_col(
			'SELECT s.source_id FROM ' . self::sources_table() . " s LEFT JOIN {$wpdb->posts} p ON p.ID = s.source_id AND {$type_sql} AND {$status_sql} WHERE s.source_id > 0 AND p.ID IS NULL LIMIT 500" // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		);
		$changed = false;
		foreach ( array_map( 'intval', (array) $ids ) as $id ) {
			$changed = self::remove_source( $id ) || $changed;
		}
		return $changed;
	}

	/**
	 * The next batch to scan: during a reconcile pass every post after the
	 * cursor; otherwise posts never scanned, changed since, or scanned by an
	 * older parser.
	 *
	 * @param array<string, mixed> $state
	 * @return list<int>
	 */
	private static function pending_ids( array $state ): array {
		global $wpdb;
		[ $type_sql, $status_sql ] = self::indexable_sql( 'p' );
		if ( null !== $state['cursor'] ) {
			$sql = $wpdb->prepare( "SELECT p.ID FROM {$wpdb->posts} p WHERE {$type_sql} AND {$status_sql} AND p.ID > %d ORDER BY p.ID LIMIT %d", (int) $state['cursor'], self::BATCH ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		} else {
			$sql = $wpdb->prepare( "SELECT p.ID FROM {$wpdb->posts} p LEFT JOIN " . self::sources_table() . " s ON s.source_id = p.ID WHERE {$type_sql} AND {$status_sql} AND (s.source_id IS NULL OR NOT (s.modified_gmt <=> p.post_modified_gmt) OR s.row_version < %d) ORDER BY p.ID LIMIT %d", self::ROW_VERSION, self::BATCH ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		}
		return array_values( array_map( 'intval', (array) $wpdb->get_col( $sql ) ) ); // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
	}

	private static function site_needs_scan(): bool {
		global $wpdb;
		$version = $wpdb->get_var( 'SELECT row_version FROM ' . self::sources_table() . ' WHERE source_id = 0' ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		return null === $version || (int) $version < self::ROW_VERSION;
	}

	/**
	 * SQL conditions for indexable posts, with every value escaped.
	 *
	 * @return array{0: string, 1: string}
	 */
	private static function indexable_sql( string $alias ): array {
		$types    = array_map( 'esc_sql', self::indexable_types() );
		$statuses = array_map( 'esc_sql', self::STATUSES );
		return array(
			"{$alias}.post_type IN ('" . implode( "','", $types ) . "')",
			"{$alias}.post_status IN ('" . implode( "','", $statuses ) . "')",
		);
	}

	private static function count_indexable(): int {
		global $wpdb;
		[ $type_sql, $status_sql ] = self::indexable_sql( 'p' );
		return (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$wpdb->posts} p WHERE {$type_sql} AND {$status_sql}" ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * @param array<string, mixed> $state
	 */
	private static function count_done( array $state ): int {
		global $wpdb;
		[ $type_sql, $status_sql ] = self::indexable_sql( 'p' );
		if ( null !== $state['cursor'] ) {
			return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} p WHERE {$type_sql} AND {$status_sql} AND p.ID <= %d", (int) $state['cursor'] ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		}
		return (int) $wpdb->get_var( $wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} p INNER JOIN " . self::sources_table() . " s ON s.source_id = p.ID WHERE {$type_sql} AND {$status_sql} AND s.modified_gmt <=> p.post_modified_gmt AND s.row_version >= %d", self::ROW_VERSION ) ); // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	/**
	 * @param array<string, mixed> $state
	 * @return array{state: string, done: int, total: int}
	 */
	private static function status_from( array $state ): array {
		$total = self::count_indexable();
		return array(
			'state' => $state['state'],
			'done'  => 'ready' === $state['state'] ? $total : min( $total, self::count_done( $state ) ),
			'total' => $total,
		);
	}

	/**
	 * `wpu_usage_index_state` (§8.4) plus two internal keys: `cursor` (the
	 * reconcile pass's last id, null outside one) and `vp` (whether Visual
	 * Portfolio was active at the last check).
	 *
	 * @return array{state: string, done: int, total: int, staleSince: ?string, cursor: ?int, vp: bool}
	 */
	public static function state(): array {
		$stored = get_option( self::STATE_OPTION );
		$stored = is_array( $stored ) ? $stored : array();
		$state  = in_array( $stored['state'] ?? '', array( 'ready', 'building', 'stale' ), true ) ? $stored['state'] : 'building';
		return array(
			'state'      => $state,
			'done'       => (int) ( $stored['done'] ?? 0 ),
			'total'      => (int) ( $stored['total'] ?? 0 ),
			'staleSince' => isset( $stored['staleSince'] ) ? (string) $stored['staleSince'] : null,
			'cursor'     => isset( $stored['cursor'] ) ? (int) $stored['cursor'] : null,
			'vp'         => (bool) ( $stored['vp'] ?? false ),
		);
	}

	/**
	 * @param array<string, mixed> $state
	 */
	private static function save_state( array $state ): void {
		update_option( self::STATE_OPTION, $state, true );
	}

	private static function parser(): Parser {
		if ( null === self::$parser ) {
			self::$parser = new Parser( self::visual_portfolio_active() );
		}
		return self::$parser;
	}

	private static function now(): float {
		return microtime( true );
	}

	/**
	 * Creates or upgrades the tables when the code's schema version differs
	 * from the stored one (§9.2). Never relies on activation hooks. Runs on
	 * every load (cheap: one autoloaded option) and from P1's maintenance step.
	 */
	public static function ensure_schema(): void {
		if ( self::DB_VERSION === get_option( self::DB_VERSION_OPTION ) ) {
			return;
		}
		// One atomic INSERT (Mutation\OptionLock): only one request runs dbDelta().
		if ( ! OptionLock::acquire( self::SCHEMA_LOCK, MINUTE_IN_SECONDS ) ) {
			return;
		}
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$charset = $wpdb->get_charset_collate();
		dbDelta(
			'CREATE TABLE ' . self::usage_table() . " (
  attachment_id bigint(20) unsigned NOT NULL,
  source_id bigint(20) unsigned NOT NULL,
  context varchar(32) NOT NULL,
  PRIMARY KEY  (attachment_id,source_id,context),
  KEY source (source_id)
) {$charset};"
		);
		dbDelta(
			'CREATE TABLE ' . self::sources_table() . " (
  source_id bigint(20) unsigned NOT NULL,
  scanned_gmt datetime NOT NULL,
  modified_gmt datetime NULL,
  row_version smallint(5) unsigned NOT NULL,
  PRIMARY KEY  (source_id)
) {$charset};"
		);
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION, true );
		$state = self::state();
		if ( 'ready' === $state['state'] ) {
			$state['state'] = 'building';
		}
		$state['vp'] = self::visual_portfolio_active();
		self::save_state( $state );
		OptionLock::release( self::SCHEMA_LOCK );
		Rev::touch();
		// Post types are registered on init; count the indexable posts after it.
		if ( did_action( 'init' ) ) {
			self::recount();
		} else {
			add_action( 'init', array( self::class, 'recount' ), 100 );
		}
	}

	/**
	 * Stores fresh `done` and `total` counts for `status()`.
	 */
	public static function recount(): void {
		$state          = self::state();
		$status         = self::status_from( $state );
		$state['done']  = $status['done'];
		$state['total'] = $status['total'];
		self::save_state( $state );
	}
}
