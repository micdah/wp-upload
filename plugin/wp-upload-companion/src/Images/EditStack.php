<?php
/**
 * The undo stack of in-place edits, post meta `_wpu_edit_backups`
 * (contract §8.3): a list, newest last, at most 10 entries.
 *
 * Each entry describes how to go back to the state before one edit:
 *
 * - `token`   unique id of the edit, also in its backup file names;
 * - `at`      Unix time of the edit;
 * - `meta`    `_wp_attachment_metadata` before the edit;
 * - `saved`   name => backup name, for every file the edit overwrote;
 * - `orig`    when this edit recorded the original in WordPress's
 *             `_wp_attachment_backup_sizes`: the previous value of every key
 *             it set (null = the key didn't exist), so undo can put them back;
 *             null otherwise;
 * - `origFiles` the copies of the original files it made for those keys;
 * - `after`   `{file, width, height}` right after the edit: if the item no
 *             longer matches (wp-admin edited or restored it, it was
 *             replaced), the stack is stale and can't be undone;
 * - `touched` names referenced by intermediate states that merged entries
 *             skipped, so undo can clean them up.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Images;

final class EditStack {

	public const META_KEY = '_wpu_edit_backups';

	/** Entries kept; older ones are merged into the oldest (§8.3). */
	public const MAX_ENTRIES = 10;

	/**
	 * @return list<array<string, mixed>>
	 */
	public static function get( int $id ): array {
		$stack = get_post_meta( $id, self::META_KEY, true );
		if ( ! is_array( $stack ) ) {
			return array();
		}
		$entries = array();
		foreach ( $stack as $entry ) {
			if ( is_array( $entry ) && isset( $entry['token'], $entry['meta'], $entry['after'] ) && is_array( $entry['meta'] ) ) {
				$entry['saved']     = is_array( $entry['saved'] ?? null ) ? $entry['saved'] : array();
				$entry['origFiles'] = is_array( $entry['origFiles'] ?? null ) ? $entry['origFiles'] : array();
				$entry['touched']   = is_array( $entry['touched'] ?? null ) ? $entry['touched'] : array();
				$entry['orig']      = is_array( $entry['orig'] ?? null ) ? $entry['orig'] : null;
				$entries[]          = $entry;
			}
		}
		return $entries;
	}

	/**
	 * @param list<array<string, mixed>> $stack
	 */
	public static function save( int $id, array $stack ): void {
		if ( array() === $stack ) {
			delete_post_meta( $id, self::META_KEY );
			return;
		}
		update_post_meta( $id, self::META_KEY, wp_slash( array_values( $stack ) ) );
	}

	/**
	 * The current main file, its size and its sub-size files, to compare with
	 * an entry's `after`. The sizes catch edits that leave the main file alone
	 * (wp-admin's thumbnail-only edits write new `-e…` thumbnail files).
	 *
	 * @param array<string, mixed> $meta
	 * @return array{file: string, width: int, height: int, sizes: string}
	 */
	public static function fingerprint( int $id, array $meta ): array {
		$sizes = array();
		foreach ( (array) ( $meta['sizes'] ?? array() ) as $name => $size ) {
			if ( is_array( $size ) ) {
				$sizes[ (string) $name ] = (string) ( $size['file'] ?? '' );
			}
		}
		ksort( $sizes );
		return array(
			'file'   => (string) get_post_meta( $id, '_wp_attached_file', true ),
			'width'  => (int) ( $meta['width'] ?? 0 ),
			'height' => (int) ( $meta['height'] ?? 0 ),
			'sizes'  => md5( (string) wp_json_encode( $sizes ) ),
		);
	}

	/**
	 * After an operation that keeps the stack (regenerate), the newest entry
	 * describes the new state.
	 *
	 * @param list<array<string, mixed>> $stack
	 * @param array<string, mixed>       $meta
	 * @return list<array<string, mixed>>
	 */
	public static function refresh_top( int $id, array $stack, array $meta ): array {
		if ( array() !== $stack ) {
			$stack[ count( $stack ) - 1 ]['after'] = self::fingerprint( $id, $meta );
		}
		return $stack;
	}

	/**
	 * Whether the newest entry still describes the item: nothing outside
	 * this plugin edited, restored or replaced it since.
	 *
	 * @param list<array<string, mixed>> $stack
	 * @param array<string, mixed>       $meta
	 */
	public static function is_current( int $id, array $stack, array $meta ): bool {
		if ( array() === $stack ) {
			return false;
		}
		$top = $stack[ count( $stack ) - 1 ];
		return self::fingerprint( $id, $meta ) == $top['after']; // phpcs:ignore Universal.Operators.StrictComparisons.LooseEqual -- same keys, int/string tolerant.
	}

	/**
	 * Adds an entry, merging the two oldest when the stack is full. The
	 * merged entry undoes both edits at once, so Restore keeps working.
	 *
	 * @param list<array<string, mixed>> $stack
	 * @param array<string, mixed>       $entry
	 * @return array{0: list<array<string, mixed>>, 1: list<string>} the stack and backup files no longer needed
	 */
	public static function push( array $stack, array $entry ): array {
		$stack[]  = $entry;
		$obsolete = array();
		while ( count( $stack ) > self::MAX_ENTRIES ) {
			$first  = array_shift( $stack );
			$second = array_shift( $stack );
			foreach ( $second['saved'] as $name => $backup ) {
				if ( isset( $first['saved'][ $name ] ) ) {
					$obsolete[] = (string) $backup;
				} else {
					$first['saved'][ $name ] = $backup;
				}
			}
			$first['touched'] = array_values(
				array_unique( array_merge( $first['touched'], $second['touched'], Files::of_meta( $second['meta'] ) ) )
			);
			if ( null === $first['orig'] && null !== $second['orig'] ) {
				$first['orig']      = $second['orig'];
				$first['origFiles'] = $second['origFiles'];
			}
			$first['after'] = $second['after'];
			array_unshift( $stack, $first );
		}
		return array( $stack, $obsolete );
	}

	/**
	 * Every file of the item that must stay: the current state, every state
	 * the stack can go back to, its backups, and WordPress's backup sizes.
	 *
	 * @param array<string, mixed>       $meta
	 * @param list<array<string, mixed>> $stack
	 * @param mixed                      $backup_sizes
	 * @return array<string, true>
	 */
	public static function protected_files( int $id, array $meta, array $stack, $backup_sizes ): array {
		$names   = Files::of_meta( $meta );
		$names[] = wp_basename( (string) get_post_meta( $id, '_wp_attached_file', true ) );
		foreach ( $stack as $entry ) {
			$names = array_merge( $names, Files::of_meta( $entry['meta'] ), array_values( $entry['saved'] ), array_values( $entry['origFiles'] ) );
		}
		$names = array_merge( $names, Files::of_backup_sizes( $backup_sizes ) );
		return array_fill_keys( array_filter( array_map( 'strval', $names ) ), true );
	}

	/**
	 * Every file the stack alone keeps alive, for clean-up when the stack is
	 * dropped or the attachment is deleted.
	 *
	 * @param list<array<string, mixed>> $stack
	 * @return list<string>
	 */
	public static function files( array $stack ): array {
		$names = array();
		foreach ( $stack as $entry ) {
			$names = array_merge( $names, Files::of_meta( $entry['meta'] ), array_values( $entry['saved'] ), array_values( $entry['origFiles'] ), $entry['touched'] );
		}
		return array_values( array_unique( array_map( 'strval', $names ) ) );
	}
}
