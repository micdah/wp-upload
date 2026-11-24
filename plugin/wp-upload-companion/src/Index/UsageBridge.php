<?php
/**
 * How P1's code reaches P2's usage index (`UsageIndex`, owned by track P2)
 * without either track editing the other's files. Every call is optional:
 * while a method doesn't exist yet, the bridge answers like the M0 stub
 * (the usage index is `building`, every item counts as unused, §7.2).
 *
 * P2 implements any of these public static methods on
 * `WpUpload\Companion\Index\UsageIndex`:
 *
 * - `status(): array{state: 'ready'|'building'|'stale', done: int, total: int}`
 *   Cheap (options only): used by GET /rev and /info.
 * - `check_consistency(bool $use_cache): void`
 *   The /info consistency check for usage (§9.3); may mark the index stale.
 * - `ensure_schema(): void`
 *   Maintenance step 2 (§5.21).
 * - `step(float $deadline): array{did: int, changed: bool}`
 *   Maintenance step 5: scan until microtime(true) reaches $deadline.
 * - `mark_stale(): void`
 *   Called by the deactivation hook (§9.3).
 * - `unused_condition(string $attachment_id_sql): string`
 *   A SQL boolean expression, true when that attachment has no usage row
 *   (e.g. `NOT EXISTS (SELECT 1 FROM wp_wpu_usage u WHERE u.attachment_id = <expr>)`).
 *   Used by the `unused` facet.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Index;

final class UsageBridge {

	private const USAGE_INDEX = 'WpUpload\\Companion\\Index\\UsageIndex';

	/**
	 * @return array{state: string, done: int, total: int}
	 */
	public static function status(): array {
		if ( self::has( 'status' ) ) {
			$status = call_user_func( array( self::USAGE_INDEX, 'status' ) );
			if ( is_array( $status ) && isset( $status['state'], $status['done'], $status['total'] ) ) {
				return array(
					'state' => in_array( $status['state'], array( 'ready', 'building', 'stale' ), true ) ? (string) $status['state'] : 'building',
					'done'  => max( 0, (int) $status['done'] ),
					'total' => max( 0, (int) $status['total'] ),
				);
			}
		}
		return array(
			'state' => 'building',
			'done'  => 0,
			'total' => 0,
		);
	}

	public static function is_ready(): bool {
		return 'ready' === self::status()['state'];
	}

	public static function check_consistency( bool $use_cache ): void {
		if ( self::has( 'check_consistency' ) ) {
			call_user_func( array( self::USAGE_INDEX, 'check_consistency' ), $use_cache );
		}
	}

	public static function ensure_schema(): void {
		if ( self::has( 'ensure_schema' ) ) {
			call_user_func( array( self::USAGE_INDEX, 'ensure_schema' ) );
		}
	}

	/**
	 * @return array{did: int, changed: bool}
	 */
	public static function step( float $deadline ): array {
		if ( self::has( 'step' ) ) {
			$result = call_user_func( array( self::USAGE_INDEX, 'step' ), $deadline );
			if ( is_array( $result ) ) {
				return array(
					'did'     => max( 0, (int) ( $result['did'] ?? 0 ) ),
					'changed' => ! empty( $result['changed'] ),
				);
			}
		}
		return array(
			'did'     => 0,
			'changed' => false,
		);
	}

	public static function mark_stale(): void {
		if ( self::has( 'mark_stale' ) ) {
			call_user_func( array( self::USAGE_INDEX, 'mark_stale' ) );
		}
	}

	/**
	 * SQL that is true when the attachment is unused. While P2's provider is a
	 * stub, every item counts as unused.
	 */
	public static function unused_condition( string $attachment_id_sql ): string {
		if ( self::has( 'unused_condition' ) ) {
			$condition = call_user_func( array( self::USAGE_INDEX, 'unused_condition' ), $attachment_id_sql );
			if ( is_string( $condition ) && '' !== $condition ) {
				return '(' . $condition . ')';
			}
		}
		return '1';
	}

	private static function has( string $method ): bool {
		return class_exists( self::USAGE_INDEX ) && method_exists( self::USAGE_INDEX, $method );
	}
}
