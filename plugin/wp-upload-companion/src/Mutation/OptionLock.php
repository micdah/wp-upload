<?php
/**
 * A lock stored as one row of the options table. Taken with `INSERT IGNORE`
 * (one statement: only one request can create the row) and, once expired,
 * taken over with one conditional `UPDATE`. The row holds
 * `<expiry>:<token>`, so a holder only ever releases its own lock, never one
 * that was taken over after it expired.
 *
 * add_option() isn't used: it checks with get_option() and then upserts, so
 * two requests can both believe they created the row.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Mutation;

final class OptionLock {

	/** @var array<string, string> Tokens of the locks this request holds, by key. */
	private static array $held = array();

	/**
	 * Takes the lock for `$ttl` seconds; false while someone else holds it.
	 */
	public static function acquire( string $key, int $ttl ): bool {
		global $wpdb;
		$token = bin2hex( random_bytes( 8 ) );
		$value = ( time() + $ttl ) . ':' . $token;
		$taken = (int) $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')",
				$key,
				$value
			)
		);
		if ( 1 !== $taken ) {
			// An expired lock is replaced in one statement, so only one request wins it.
			$taken = (int) $wpdb->query(
				$wpdb->prepare(
					"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND CAST(SUBSTRING_INDEX(option_value, ':', 1) AS UNSIGNED) < %d",
					$value,
					$key,
					time()
				)
			);
		}
		self::forget_cache( $key );
		if ( 1 !== $taken ) {
			return false;
		}
		self::$held[ $key ] = $value;
		return true;
	}

	/**
	 * Releases the lock if this request still holds it.
	 */
	public static function release( string $key ): void {
		if ( ! isset( self::$held[ $key ] ) ) {
			return;
		}
		global $wpdb;
		$wpdb->query(
			$wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", $key, self::$held[ $key ] )
		);
		unset( self::$held[ $key ] );
		self::forget_cache( $key );
	}

	/**
	 * Whether anyone holds an unexpired lock.
	 */
	public static function held( string $key ): bool {
		global $wpdb;
		$value = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $key ) );
		return null !== $value && (int) strtok( (string) $value, ':' ) >= time();
	}

	private static function forget_cache( string $key ): void {
		wp_cache_delete( $key, 'options' );
		wp_cache_delete( 'notoptions', 'options' );
		wp_cache_delete( 'alloptions', 'options' );
	}
}
