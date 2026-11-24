<?php
/**
 * Wire formats shared by every route (plugin-api.md §1.2): ISO 8601 UTC times
 * with whole seconds and `Z`, and plain text decoded from WordPress's stored
 * HTML entities.
 *
 * Shared by tracks P1 and P2. Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Support;

final class Format {

	/**
	 * A `*_gmt` column value ('Y-m-d H:i:s') as ISO 8601, or null for empty/zero dates.
	 */
	public static function iso_from_gmt( ?string $mysql_gmt ): ?string {
		if ( null === $mysql_gmt || '' === $mysql_gmt || 0 === strpos( $mysql_gmt, '0000-00-00' ) ) {
			return null;
		}
		$timestamp = strtotime( $mysql_gmt . ' UTC' );
		if ( false === $timestamp ) {
			return null;
		}
		return gmdate( 'Y-m-d\TH:i:s\Z', $timestamp );
	}

	public static function iso_from_unix( int $timestamp ): string {
		return gmdate( 'Y-m-d\TH:i:s\Z', $timestamp );
	}

	/**
	 * Plain text from a stored title or folder name: kses stores `Tom &amp; Jerry`,
	 * the API returns `Tom & Jerry`.
	 */
	public static function plain_text( string $stored ): string {
		return html_entity_decode( $stored, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	}

	/**
	 * Milliseconds since the epoch.
	 */
	public static function now_ms(): int {
		return (int) floor( microtime( true ) * 1000 );
	}
}
