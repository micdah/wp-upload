<?php
/**
 * The `usageCount` key of the `wpu` field (contract §7.1): refs in
 * `wpu_usage`, or null while the usage index isn't complete.
 *
 * Implements P1's provider interface (`Field\Provider`, contract §7.2).
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Usage;

use WpUpload\Companion\Field\Provider;
use WpUpload\Companion\Index\UsageIndex;

final class UsageCountProvider implements Provider {

	/** @var array<int, int> */
	private array $counts = array();

	private bool $complete = false;

	public function keys(): array {
		return array( 'usageCount' );
	}

	public function prime( array $ids ): void {
		$this->complete = UsageIndex::complete();
		if ( $this->complete ) {
			$this->counts = UsageIndex::counts( array_map( 'intval', $ids ) ) + $this->counts;
		}
	}

	public function value( int $id ): array {
		if ( ! $this->complete ) {
			return array( 'usageCount' => null );
		}
		if ( ! isset( $this->counts[ $id ] ) ) {
			$this->counts += UsageIndex::counts( array( $id ) );
		}
		return array( 'usageCount' => $this->counts[ $id ] ?? 0 );
	}
}
