<?php
/**
 * File helpers for in-place image operations (spike X2). Every name is a
 * basename inside the attachment's own upload folder, built from WordPress's
 * stored metadata, never from a request (contract §11).
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Images;

final class Files {

	/**
	 * A fresh token for temporary and backup file names.
	 */
	public static function token(): string {
		return bin2hex( random_bytes( 4 ) );
	}

	/**
	 * `photo-300x200.jpg` + `wpub1a2b3c4d` → `photo-300x200-wpub1a2b3c4d.jpg`.
	 */
	public static function tagged( string $name, string $tag ): string {
		$dot = strrpos( $name, '.' );
		if ( false === $dot ) {
			return $name . '-' . $tag;
		}
		return substr( $name, 0, $dot ) . '-' . $tag . substr( $name, $dot );
	}

	/**
	 * The file name without its extension.
	 */
	public static function stem( string $name ): string {
		$dot = strrpos( $name, '.' );
		return false === $dot ? $name : substr( $name, 0, $dot );
	}

	public static function extension( string $name ): string {
		$dot = strrpos( $name, '.' );
		return false === $dot ? '' : substr( $name, $dot + 1 );
	}

	/**
	 * Keeps the current content of `$name` under `$copy_name`. A hard link
	 * costs no disk space; because the engine replaces files by rename (a new
	 * inode), the link keeps the old content. `$link = false` (or a file system
	 * without hard links) makes a real copy, for files that stay in place.
	 */
	public static function preserve( string $dir, string $name, string $copy_name, bool $link = true ): bool {
		$source = self::path( $dir, $name );
		$target = self::path( $dir, $copy_name );
		if ( ! is_file( $source ) ) {
			return false;
		}
		if ( file_exists( $target ) ) {
			wp_delete_file( $target );
		}
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- a failed link falls back to copy().
		if ( $link && @link( $source, $target ) ) {
			return true;
		}
		return copy( $source, $target );
	}

	/**
	 * Moves a file over another one in the same folder (atomic on one file system).
	 */
	public static function replace( string $dir, string $from_name, string $to_name ): bool {
		return self::move( self::path( $dir, $from_name ), self::path( $dir, $to_name ) );
	}

	/**
	 * Moves a file to a full path, across folders if needed.
	 */
	public static function move( string $from_path, string $to_path ): bool {
		// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename
		if ( @rename( $from_path, $to_path ) ) {
			return true;
		}
		if ( self::copy_replace( $from_path, $to_path ) ) {
			wp_delete_file( $from_path );
			return true;
		}
		return false;
	}

	/**
	 * Copies over a file without writing into it: copying onto the target
	 * would write through any hard link to it (an undo backup or a recorded
	 * original). The copy goes to a temporary name next to the target and is
	 * renamed over it; where even that rename fails, the target is unlinked first.
	 */
	public static function copy_replace( string $from_path, string $to_path ): bool {
		$temp = dirname( $to_path ) . '/.wpu-copy-' . self::token() . '-' . wp_basename( $to_path );
		if ( copy( $from_path, $temp ) ) {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged, WordPress.WP.AlternativeFunctions.rename_rename
			if ( @rename( $temp, $to_path ) ) {
				return true;
			}
			wp_delete_file( $temp );
		}
		if ( file_exists( $to_path ) ) {
			wp_delete_file( $to_path );
		}
		return copy( $from_path, $to_path );
	}

	public static function delete( string $dir, string $name ): void {
		if ( '' === $name || str_contains( $name, '/' ) || str_contains( $name, '\\' ) ) {
			return;
		}
		$path = self::path( $dir, $name );
		if ( is_file( $path ) ) {
			wp_delete_file( $path );
		}
	}

	public static function exists( string $dir, string $name ): bool {
		return '' !== $name && is_file( self::path( $dir, $name ) );
	}

	public static function path( string $dir, string $name ): string {
		return trailingslashit( $dir ) . $name;
	}

	/**
	 * Basenames of every file a metadata array references: the main file,
	 * the unscaled original and the sub-sizes.
	 *
	 * @param array<string, mixed> $meta
	 * @return list<string>
	 */
	public static function of_meta( array $meta ): array {
		$names = array();
		if ( ! empty( $meta['file'] ) ) {
			$names[] = wp_basename( (string) $meta['file'] );
		}
		if ( ! empty( $meta['original_image'] ) ) {
			$names[] = wp_basename( (string) $meta['original_image'] );
		}
		foreach ( (array) ( $meta['sizes'] ?? array() ) as $size ) {
			if ( is_array( $size ) && ! empty( $size['file'] ) ) {
				$names[] = wp_basename( (string) $size['file'] );
			}
		}
		return array_values( array_unique( $names ) );
	}

	/**
	 * Basenames `_wp_attachment_backup_sizes` references (wp-admin's backups
	 * and the original this plugin records there).
	 *
	 * @param mixed $backup_sizes
	 * @return list<string>
	 */
	public static function of_backup_sizes( $backup_sizes ): array {
		$names = array();
		foreach ( (array) $backup_sizes as $size ) {
			if ( is_array( $size ) && ! empty( $size['file'] ) ) {
				$names[] = wp_basename( (string) $size['file'] );
			}
		}
		return $names;
	}
}
