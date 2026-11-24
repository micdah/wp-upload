<?php
/**
 * A request's time budget (contract §1.6): batch routes stop *starting*
 * items once it is spent and report the rest in `remaining`.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Mutation;

final class Budget {

	/** `WPU_BATCH_BUDGET_MS`: the budget of the per-item mutation routes. */
	public const BATCH_MS = 20000;

	private float $deadline;

	private function __construct( int $milliseconds ) {
		$this->deadline = self::now() + $milliseconds / 1000;
	}

	public static function start( int $milliseconds ): self {
		return new self( $milliseconds );
	}

	/**
	 * The budget for batch routes; a filter lets tests shrink it.
	 */
	public static function for_batch(): self {
		return new self( (int) apply_filters( 'wpu_batch_budget_ms', self::BATCH_MS ) );
	}

	public function spent(): bool {
		return self::now() >= $this->deadline;
	}

	private static function now(): float {
		return hrtime( true ) / 1e9;
	}
}
