<?php
/**
 * A provider of one key group of the `wpu` field (plugin-api.md §7.2).
 *
 * The field primes every provider once per REST response with all attachment
 * ids of that response, then asks each provider for each item's values. Load
 * everything in `prime()` with a fixed number of queries (not one per item).
 *
 * Register a provider from a component's register():
 *
 *     WpuField::add_provider( new MyProvider() );
 *
 * A provider registered later takes over the keys it declares from earlier
 * ones (P2's providers replace the stubs of `StubProvider`). Keys must be
 * listed in `WPU_FIELD_PROVIDERS` (shared/plugin-api.ts).
 *
 * Owned by track P1; implemented by P1 and P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Field;

interface Provider {

	/**
	 * The `wpu` keys this provider fills.
	 *
	 * @return list<string>
	 */
	public function keys(): array;

	/**
	 * Loads what `value()` needs for these attachments. Called once per
	 * response (and again for ids not seen before, e.g. a single-item GET).
	 *
	 * @param list<int> $ids Attachment ids.
	 */
	public function prime( array $ids ): void;

	/**
	 * This item's values, keyed by the provider's keys. Missing keys get null.
	 *
	 * @return array<string, mixed>
	 */
	public function value( int $id ): array;
}
