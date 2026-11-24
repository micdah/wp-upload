<?php
/**
 * POST /maintenance/step (plugin-api.md §5.21): one time-budgeted unit of
 * index work, driven by the server instead of WP-Cron.
 *
 * Order: lock → schemas → media index → folder column → usage index (P2,
 * through UsageBridge) → unlock. Bumps the rev only when something visible
 * changed.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\FileBird\Adapter;
use WpUpload\Companion\Index\IndexStatus;
use WpUpload\Companion\Index\MediaIndex;
use WpUpload\Companion\Index\UsageBridge;
use WpUpload\Companion\Mutation\OptionLock;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Rev;
use WpUpload\Companion\Support\Params;
use WpUpload\Companion\Support\Routes;

final class MaintenanceController {

	public const LOCK = 'wpu_maintenance_lock';

	/** A lock older than this many seconds is stale and taken over. */
	private const LOCK_LIFETIME = 120;

	private const DEFAULT_BUDGET_MS = 5000;

	public static function register(): void {
		Plugin::provide_feature( 'maintenance' );
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		Routes::add( '/maintenance/step', 'POST', array( self::class, 'step' ) );
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function step( \WP_REST_Request $request ) {
		$started = microtime( true );
		$body    = Params::body( $request, array( 'budgetMs' ), true );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$budget_ms = self::DEFAULT_BUDGET_MS;
		if ( array_key_exists( 'budgetMs', $body ) ) {
			$budget_ms = Params::int( $body['budgetMs'], 'budgetMs', 100, 20000 );
			if ( is_wp_error( $budget_ms ) ) {
				return $budget_ms;
			}
		}
		$deadline = $started + $budget_ms / 1000;

		$did = array(
			'media'   => 0,
			'usage'   => 0,
			'folders' => 0,
		);
		if ( ! OptionLock::acquire( self::LOCK, self::LOCK_LIFETIME ) ) {
			return self::response( Rev::current(), true, $did );
		}

		$changed = false;
		try {
			MediaIndex::ensure_schema();
			UsageBridge::ensure_schema();

			$media        = MediaIndex::step( $deadline );
			$did['media'] = $media['did'];
			$changed      = $media['changed'];

			if ( MediaIndex::is_ready() && Adapter::tables_exist() ) {
				$did['folders'] = MediaIndex::reconcile_folders();
				$changed        = $changed || $did['folders'] > 0;
			}

			if ( microtime( true ) < $deadline ) {
				$usage        = UsageBridge::step( $deadline );
				$did['usage'] = $usage['did'];
				$changed      = $changed || $usage['changed'];
			}
		} finally {
			OptionLock::release( self::LOCK );
		}

		$rev = ( $changed || Rev::is_dirty() ) ? Rev::commit() : Rev::current();
		return self::response( $rev, false, $did );
	}

	/**
	 * @param array{media: int, usage: int, folders: int} $did
	 * @return array<string, mixed>
	 */
	private static function response( string $rev, bool $locked, array $did ): array {
		$index = IndexStatus::get();
		return array(
			'rev'    => $rev,
			'locked' => $locked,
			'did'    => $did,
			'more'   => 'ready' !== $index['media']['state'] || 'ready' !== $index['usage']['state'],
			'index'  => $index,
		);
	}
}
