<?php
/**
 * The per-item lock of image operations (contract §5.11: held for the whole
 * operation, 10 minutes at most). An atomic option row (Mutation\OptionLock):
 * two requests can never both take it, an expired lock is taken over, and a
 * holder never releases a lock that was taken over after it expired.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Images;

use WpUpload\Companion\Mutation\OptionLock;

final class Lock {

	public const TTL = 10 * MINUTE_IN_SECONDS;

	public static function key( int $id ): string {
		return 'wpu_image_lock_' . $id;
	}

	/**
	 * Takes the lock; false when another operation holds it.
	 */
	public static function acquire( int $id ): bool {
		return OptionLock::acquire( self::key( $id ), self::TTL );
	}

	public static function release( int $id ): void {
		OptionLock::release( self::key( $id ) );
	}

	public static function held( int $id ): bool {
		return OptionLock::held( self::key( $id ) );
	}
}
