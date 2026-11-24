<?php
/**
 * The `edited`, `editedAt`, `undoable`, `restorable` and `sizesPending`
 * keys of the `wpu` field (contract §7.1).
 *
 * Implements P1's provider interface (`Field\Provider`, contract §7.2):
 * `prime()` loads every item's post meta in one query, so `value()` reads
 * only the cache.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Images;

use WpUpload\Companion\Field\Provider;

final class EditStateProvider implements Provider {

	public function keys(): array {
		return array( 'edited', 'editedAt', 'undoable', 'restorable', 'sizesPending' );
	}

	public function prime( array $ids ): void {
		$ids = array_map( 'intval', $ids );
		if ( array() !== $ids ) {
			update_meta_cache( 'post', $ids );
		}
	}

	public function value( int $id ): array {
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$state                 = Engine::state( $id );
		$state['sizesPending'] = self::sizes_pending( $id );
		return $state;
	}

	/**
	 * Whether a sub-size the attached file can have is still missing.
	 *
	 * wp_get_missing_image_subsizes() measures the unscaled `original_image`,
	 * so after an edit of a `-scaled` item (4000 px original, 2560 px
	 * `-scaled`, cropped to 2000 px) sizes such as `2048x2048` would stay
	 * "missing" forever. A size counts only if the attached file itself is
	 * large enough for it (its `width`/`height` in the metadata), as core
	 * decides when it makes sizes from that file.
	 */
	private static function sizes_pending( int $id ): bool {
		$missing = wp_get_missing_image_subsizes( $id );
		if ( array() === $missing ) {
			return false;
		}
		$meta   = wp_get_attachment_metadata( $id );
		$width  = is_array( $meta ) && isset( $meta['width'] ) ? (int) $meta['width'] : 0;
		$height = is_array( $meta ) && isset( $meta['height'] ) ? (int) $meta['height'] : 0;
		if ( $width < 1 || $height < 1 ) {
			return true;
		}
		foreach ( $missing as $size ) {
			$crop = $size['crop'] ?? false;
			if ( false !== image_resize_dimensions( $width, $height, (int) ( $size['width'] ?? 0 ), (int) ( $size['height'] ?? 0 ), $crop ) ) {
				return true;
			}
		}
		return false;
	}
}
