<?php
/**
 * `GET /trash`, `POST /trash/restore` and `POST /trash/empty`
 * (docs/media-manager/contracts/plugin-api.md §5.7–5.9), plus the trash
 * state helpers `POST /media/trash` uses.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\FileBird\Adapter;
use WpUpload\Companion\Mutation\Api;
use WpUpload\Companion\Mutation\Budget;
use WpUpload\Companion\Mutation\Rev;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Query\Visibility;

final class TrashController {

	/** `POST /trash/empty` budget bounds and default, in ms (§5.9). */
	private const EMPTY_BUDGET_MIN     = 100;
	private const EMPTY_BUDGET_MAX     = 20000;
	private const EMPTY_BUDGET_DEFAULT = 10000;

	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		register_rest_route(
			Plugin::REST_NAMESPACE,
			'/trash',
			array(
				'methods'             => 'GET',
				'callback'            => Api::guarded( array( self::class, 'summary' ) ),
				'permission_callback' => array( Api::class, 'can_upload' ),
			)
		);
		register_rest_route(
			Plugin::REST_NAMESPACE,
			'/trash/restore',
			array(
				'methods'             => 'POST',
				'callback'            => Api::guarded( array( self::class, 'restore' ) ),
				'permission_callback' => array( Api::class, 'can_upload' ),
			)
		);
		register_rest_route(
			Plugin::REST_NAMESPACE,
			'/trash/empty',
			array(
				'methods'             => 'POST',
				'callback'            => Api::guarded( array( self::class, 'empty_trash' ) ),
				'permission_callback' => array( Api::class, 'can_upload' ),
			)
		);
	}

	/**
	 * `/info.trash.enabled`: MEDIA_TRASH on and EMPTY_TRASH_DAYS above 0.
	 */
	public static function enabled(): bool {
		return defined( 'MEDIA_TRASH' ) && MEDIA_TRASH && self::days() > 0;
	}

	public static function days(): int {
		return defined( 'EMPTY_TRASH_DAYS' ) ? (int) EMPTY_TRASH_DAYS : 30;
	}

	/**
	 * `TrashState` of a trashed item: `trashedAt` from `_wp_trash_meta_time`
	 * and `daysLeft` until WordPress's daily purge (§5.5). Null when the item
	 * isn't trashed.
	 *
	 * @return array{trashedAt: string|null, daysLeft: int|null}|null
	 */
	public static function trash_state( int $id ): ?array {
		$post = get_post( $id );
		if ( ! $post instanceof \WP_Post || 'trash' !== $post->post_status ) {
			return null;
		}
		$time       = (int) get_post_meta( $id, '_wp_trash_meta_time', true );
		$trashed_at = $time > 0 ? Api::iso_from_unix( $time ) : null;
		$days       = self::days();
		$days_left  = null;
		if ( $days > 0 ) {
			$elapsed   = $time > 0 ? intdiv( max( 0, time() - $time ), DAY_IN_SECONDS ) : 0;
			$days_left = max( 0, $days - $elapsed );
		}
		return array(
			'trashedAt' => $trashed_at,
			'daysLeft'  => $days_left,
		);
	}

	/**
	 * `GET /trash`: the summary of the trashed attachments this user may see
	 * in the Trash, the same set as `/collection?folder=trash` (§5.2, §5.7).
	 *
	 * @return array<string, mixed>
	 */
	public static function summary(): array {
		$rev = Rev::current();
		global $wpdb;
		$visible = ( new Visibility() )->trash( 'p.post_status', 'p.post_author' );
		// $visible is SQL built by Query\Visibility from column names and an (int) user id.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT p.ID, m.meta_value FROM {$wpdb->posts} p LEFT JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = %s WHERE p.post_type = %s AND p.post_status = %s AND {$visible}", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				'_wp_attachment_metadata',
				'attachment',
				'trash'
			)
		);
		$bytes = 0;
		foreach ( (array) $rows as $row ) {
			$bytes += self::filesize_of( (int) $row->ID, maybe_unserialize( (string) $row->meta_value ) );
		}
		return array(
			'rev'     => $rev,
			'enabled' => self::enabled(),
			'days'    => self::days(),
			'count'   => count( (array) $rows ),
			'bytes'   => $bytes,
		);
	}

	/**
	 * Bytes of the attached file: the metadata's `filesize`, else the file itself.
	 */
	private static function filesize_of( int $id, mixed $meta ): int {
		if ( is_array( $meta ) && isset( $meta['filesize'] ) ) {
			return (int) $meta['filesize'];
		}
		$file = get_attached_file( $id );
		return ( $file && is_readable( $file ) ) ? (int) wp_filesize( $file ) : 0;
	}

	/**
	 * `POST /trash/restore` (§5.8).
	 *
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function restore( \WP_REST_Request $request ) {
		$ids = MediaController::ids_from( $request );
		if ( is_wp_error( $ids ) ) {
			return $ids;
		}
		$response = MediaController::each(
			$ids,
			static function ( int $id ): array {
				$attachment = Api::attachment( $id );
				if ( null === $attachment ) {
					return Api::item_error( $id, 'wpu_not_found', Api::not_found_message( $id ) );
				}
				if ( ! current_user_can( 'delete_post', $id ) ) {
					return Api::item_error( $id, 'wpu_forbidden', 'You are not allowed to restore this media item.' );
				}
				if ( 'trash' !== $attachment->post_status ) {
					return Api::item_error( $id, 'wpu_not_trashed', sprintf( 'Media item %d is not in the Trash.', $id ) );
				}
				if ( ! wp_untrash_post( $id ) ) {
					return Api::item_error( $id, 'wpu_io_error', 'WordPress could not restore the item.' );
				}
				return array(
					'id'      => $id,
					'ok'      => true,
					'changed' => true,
				);
			}
		);
		$restored = array();
		foreach ( $response['results'] as $result ) {
			if ( $result['ok'] ) {
				$restored[] = $result['id'];
			}
		}
		// The folder in the tree the user works in (the shared tree, or their own in
		// per-user mode), as the `wpu.folder` field reports it; null without FileBird.
		$folders = Adapter::is_active() ? Adapter::folders_of( $restored, Adapter::owner() ) : array();
		foreach ( $response['results'] as $index => $result ) {
			if ( $result['ok'] ) {
				$response['results'][ $index ]['folder'] = $folders[ $result['id'] ] ?? null;
			}
		}
		return $response;
	}

	/**
	 * `POST /trash/empty`: deletes trashed attachments oldest-trashed first
	 * until the budget is spent (§5.9).
	 *
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function empty_trash( \WP_REST_Request $request ) {
		$body = Api::json_body( $request, array( 'budgetMs' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$budget_ms = self::EMPTY_BUDGET_DEFAULT;
		if ( array_key_exists( 'budgetMs', $body ) ) {
			$budget_ms = Api::positive_int( $body['budgetMs'] );
			if ( null === $budget_ms || $budget_ms < self::EMPTY_BUDGET_MIN || $budget_ms > self::EMPTY_BUDGET_MAX ) {
				return Api::invalid( 'budgetMs', sprintf( '"budgetMs" must be an integer from %d to %d.', self::EMPTY_BUDGET_MIN, self::EMPTY_BUDGET_MAX ) );
			}
		}
		$budget    = Budget::start( $budget_ms );
		$deletable = array();
		$skipped   = 0;
		foreach ( self::trashed_oldest_first() as $id ) {
			if ( current_user_can( 'delete_post', $id ) ) {
				$deletable[] = $id;
			} else {
				++$skipped;
			}
		}

		$deleted = 0;
		foreach ( $deletable as $id ) {
			if ( $budget->spent() ) {
				break;
			}
			if ( wp_delete_attachment( $id, true ) ) {
				++$deleted;
			}
		}

		return array(
			'rev'       => $deleted > 0 ? Rev::bump() : Rev::current(),
			'deleted'   => $deleted,
			'remaining' => count( $deletable ) - $deleted,
			'skipped'   => $skipped,
		);
	}

	/**
	 * Every trashed attachment id, oldest trash time first (ties by id).
	 *
	 * @return list<int>
	 */
	private static function trashed_oldest_first(): array {
		global $wpdb;
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT p.ID FROM {$wpdb->posts} p LEFT JOIN {$wpdb->postmeta} m ON m.post_id = p.ID AND m.meta_key = %s WHERE p.post_type = %s AND p.post_status = %s ORDER BY CAST(m.meta_value AS UNSIGNED) ASC, p.ID ASC",
				'_wp_trash_meta_time',
				'attachment',
				'trash'
			)
		);
		$ids = array_values( array_map( 'intval', (array) $ids ) );
		if ( array() !== $ids ) {
			// One query for every post, so the capability checks below don't query per item.
			_prime_post_caches( $ids, false, false );
		}
		return $ids;
	}
}
