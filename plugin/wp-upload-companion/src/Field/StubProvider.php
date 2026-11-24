<?php
/**
 * Stub values for the `wpu` keys track P2 owns, until P2's providers are
 * registered (plugin-api.md §7.2: false, null, false, false, false, null).
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Field;

final class StubProvider implements Provider {

	private const VALUES = array(
		'edited'       => false,
		'editedAt'     => null,
		'undoable'     => false,
		'restorable'   => false,
		'sizesPending' => false,
		'usageCount'   => null,
	);

	public function keys(): array {
		return array_keys( self::VALUES );
	}

	public function prime( array $ids ): void {
	}

	public function value( int $id ): array {
		return self::VALUES;
	}
}
