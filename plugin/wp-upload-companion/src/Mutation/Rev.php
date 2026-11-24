<?php
/**
 * The library revision `wpu_rev` (contract §6) for track P2's code.
 *
 * P1 owns `wpu_rev` (`WpUpload\Companion\Rev`); this forwards to it:
 * `commit()` for mutation routes (it flushes P1's pending media-index rows
 * before bumping), `touch()` for hooks (one bump at the end of the request).
 * Before the M1 integration P2 also carried its own fallback for builds
 * without P1; every build now has P1's class.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Mutation;

use WpUpload\Companion\Rev as LibraryRev;

final class Rev {

	/**
	 * The stored revision, read with a direct SELECT (§1.7: read before querying).
	 */
	public static function current(): string {
		return LibraryRev::current();
	}

	/**
	 * For mutation routes: bumps now and returns the rev after the change.
	 */
	public static function bump(): string {
		return LibraryRev::commit();
	}

	/**
	 * For hooks: something visible changed; P1 bumps once at the end of the
	 * request.
	 */
	public static function touch(): void {
		LibraryRev::touch();
	}
}
