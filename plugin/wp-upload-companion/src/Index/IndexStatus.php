<?php
/**
 * The `index` object of /info, /rev and /maintenance/step:
 * `{media: {state, done, total}, usage: {state, done, total}}`.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Index;

final class IndexStatus {

	/**
	 * @param bool $check Run the cached consistency checks first (/info only, §9.3).
	 * @return array{media: array{state: string, done: int, total: int}, usage: array{state: string, done: int, total: int}}
	 */
	public static function get( bool $check = false ): array {
		if ( $check ) {
			MediaIndex::check_consistency( true );
			UsageBridge::check_consistency( true );
		}
		return array(
			'media' => MediaIndex::status(),
			'usage' => UsageBridge::status(),
		);
	}
}
