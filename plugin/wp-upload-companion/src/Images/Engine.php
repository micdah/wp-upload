<?php
/**
 * In-place image operations: edit, undo, restore, regenerate and replace
 * (docs/media-manager/contracts/plugin-api.md §5.11–5.15, §8.3; spikes X2 and
 * X3, decisions D19 and D20).
 *
 * The rule behind all of them: a file is never written in place. New content
 * is saved under a temporary name in the same folder and then renamed over
 * the target, so the URL stays the same while a hard link (or copy) made
 * before the rename keeps the old content for Undo and Restore.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Images;

use WpUpload\Companion\Index\MediaIndex;
use WpUpload\Companion\Mutation\Api;

final class Engine {

	/** File name tags: new content before the rename, undo backups, recorded originals. */
	private const NEW_TAG    = 'wpun';
	private const BACKUP_TAG = 'wpub';
	private const ORIG_TAG   = 'wpuo';

	/**
	 * Loads the admin includes, raises limits (§1.6) and pins the output
	 * format so a configured conversion (e.g. JPEG → WebP) never changes a
	 * file's type or name.
	 */
	public static function prepare(): void {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image-edit.php';
		wp_raise_memory_limit( 'image' );
		if ( function_exists( 'set_time_limit' ) ) {
			// phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged -- not allowed on every host.
			@set_time_limit( 0 );
		}
		add_filter( 'image_editor_output_format', '__return_empty_array', 999 );
	}

	/**
	 * Whether WordPress's image editor can edit this MIME type (`/info.imageEditor.mimes`).
	 */
	public static function supports( string $mime ): bool {
		return str_starts_with( $mime, 'image/' ) && 'image/svg+xml' !== $mime && wp_image_editor_supports( array( 'mime_type' => $mime ) );
	}

	// -------------------------------------------------------------------------
	// Edit (§5.11)
	// -------------------------------------------------------------------------

	/**
	 * Applies the recipe and overwrites the files in place.
	 *
	 * @param list<array<string, mixed>>          $ops
	 * @param array{width: int, height: int}|null $scale
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	public static function edit( int $id, array $ops, ?array $scale, string $apply_to ) {
		$item = self::load( $id );
		if ( is_wp_error( $item ) ) {
			return $item;
		}
		[ $file, $dir, $main, $meta ] = $item;
		$mime                         = (string) get_post_mime_type( $id );

		$editor = self::editor( $file, true );
		if ( is_wp_error( $editor ) ) {
			return $editor;
		}
		$size  = $editor->get_size();
		$check = self::check_recipe( (int) $size['width'], (int) $size['height'], $ops, $scale );
		if ( is_wp_error( $check ) ) {
			return $check;
		}
		$applied = self::apply_recipe( $editor, $ops, $scale );
		if ( is_wp_error( $applied ) ) {
			return $applied;
		}

		$token    = Files::token();
		$temp     = Files::tagged( $main, self::NEW_TAG . $token );
		$saved    = self::save_editor( $editor, $dir, $temp, $mime );
		$new_meta = $meta;
		$staged   = array();
		$cleanup  = array();
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}
		if ( 'thumbnail' === $apply_to ) {
			// Only the thumbnail shows the edit, uncropped as in wp-admin.
			$cleanup[] = $temp;
			$defs      = array_intersect_key( self::size_definitions( $id, $meta ), array( 'thumbnail' => true ) );
			foreach ( $defs as $name => $def ) {
				$defs[ $name ]['crop'] = false;
			}
		} else {
			$staged[ $temp ]      = $main;
			$new_meta['width']    = $saved['width'];
			$new_meta['height']   = $saved['height'];
			$new_meta['filesize'] = $saved['filesize'];
			$defs                 = self::size_definitions( $id, $meta );
			if ( 'nothumb' === $apply_to ) {
				unset( $defs['thumbnail'] );
			}
			foreach ( array_keys( $defs ) as $name ) {
				unset( $new_meta['sizes'][ $name ] ); // Sizes the edited image is too small for go away.
			}
		}
		if ( isset( $new_meta['image_meta']['orientation'] ) ) {
			$new_meta['image_meta']['orientation'] = 1;
		}

		$sizes = self::make_sizes( Files::path( $dir, $temp ), $defs, self::size_stem( $meta, $main ), false );
		if ( is_wp_error( $sizes ) ) {
			self::discard( $dir, array( $temp ) );
			return $sizes;
		}
		foreach ( $sizes as $name => $size_result ) {
			if ( '' !== $size_result['temp'] ) {
				$staged[ $size_result['temp'] ] = $size_result['meta']['file'];
			}
			$new_meta['sizes'][ $name ] = $size_result['meta'];
		}

		$stack        = self::current_stack( $id, $meta, $dir );
		$backup_sizes = self::backup_sizes( $id );
		$entry        = array(
			'token'     => $token,
			'at'        => time(),
			'meta'      => $meta,
			'saved'     => array(),
			'orig'      => null,
			'origFiles' => array(),
			'after'     => null,
			'touched'   => array(),
		);
		if ( self::needs_original( $backup_sizes, $main ) ) {
			$replaced = array_fill_keys( array_values( $staged ), true );
			$recorded = self::record_original( $dir, $main, $meta, $backup_sizes, $token, $entry, $replaced );
			if ( is_wp_error( $recorded ) ) {
				self::discard( $dir, array_merge( array_keys( $staged ), $cleanup, array_values( $entry['origFiles'] ) ) );
				return $recorded;
			}
			$backup_sizes = $recorded;
		}

		$committed = self::commit( $dir, $staged, $token, $entry['saved'] );
		self::discard( $dir, $cleanup );
		if ( is_wp_error( $committed ) ) {
			self::discard( $dir, array_values( $entry['origFiles'] ) );
			return $committed;
		}
		$entry['saved'] = $committed;
		$entry['after'] = EditStack::fingerprint( $id, $new_meta );
		[ $stack, $obsolete ] = EditStack::push( $stack, $entry );

		self::save_state( $id, $new_meta, $stack, $backup_sizes );
		self::delete_unprotected( $id, $dir, $obsolete, $new_meta, $stack, $backup_sizes );
		return array(
			'sizes'      => count( $sizes ),
			'urlChanged' => false,
		);
	}

	/**
	 * Validates the recipe against the image's size as it changes (§5.11
	 * `wpu_invalid_edit`), before any pixel is touched.
	 *
	 * @param list<array<string, mixed>>          $ops
	 * @param array{width: int, height: int}|null $scale
	 * @return true|\WP_Error
	 */
	public static function check_recipe( int $width, int $height, array $ops, ?array $scale ) {
		if ( array() === $ops && null === $scale ) {
			return self::invalid_edit( 'Nothing to do: send at least one operation or a scale.' );
		}
		foreach ( $ops as $index => $op ) {
			if ( 'rotate' === $op['op'] && 180 !== $op['angle'] ) {
				[ $width, $height ] = array( $height, $width );
			}
			if ( 'crop' === $op['op'] ) {
				if ( $op['width'] < 1 || $op['height'] < 1 || $op['x'] < 0 || $op['y'] < 0 || $op['x'] + $op['width'] > $width || $op['y'] + $op['height'] > $height ) {
					return self::invalid_edit( sprintf( 'Operation %d crops outside the %dx%d image.', $index, $width, $height ) );
				}
				$width  = $op['width'];
				$height = $op['height'];
			}
		}
		if ( null !== $scale ) {
			if ( $scale['width'] > $width || $scale['height'] > $height ) {
				return self::invalid_edit( sprintf( 'The scale %dx%d is larger than the %dx%d image.', $scale['width'], $scale['height'], $width, $height ) );
			}
			if ( abs( $scale['width'] * $height - $scale['height'] * $width ) > max( $width, $height ) ) {
				return self::invalid_edit( sprintf( 'The scale %dx%d is not proportional to %dx%d.', $scale['width'], $scale['height'], $width, $height ) );
			}
			if ( array() === $ops && $scale['width'] === $width && $scale['height'] === $height ) {
				return self::invalid_edit( 'Nothing to do: the scale equals the current size.' );
			}
		}
		return true;
	}

	/**
	 * Clockwise angles and on-screen flips, mapped to WP_Image_Editor's
	 * counter-clockwise rotate() and axis-named flip() (spike X2).
	 *
	 * @param list<array<string, mixed>>          $ops
	 * @param array{width: int, height: int}|null $scale
	 * @return true|\WP_Error
	 */
	private static function apply_recipe( \WP_Image_Editor $editor, array $ops, ?array $scale ) {
		foreach ( $ops as $op ) {
			switch ( $op['op'] ) {
				case 'rotate':
					$result = $editor->rotate( 360 - (int) $op['angle'] );
					break;
				case 'flipH':
					$result = $editor->flip( false, true );
					break;
				case 'flipV':
					$result = $editor->flip( true, false );
					break;
				default:
					$result = $editor->crop( $op['x'], $op['y'], $op['width'], $op['height'] );
			}
			if ( is_wp_error( $result ) ) {
				return self::image_error( $result );
			}
		}
		if ( null !== $scale ) {
			$current = $editor->get_size();
			if ( (int) $current['width'] !== $scale['width'] || (int) $current['height'] !== $scale['height'] ) {
				$result = $editor->resize( $scale['width'], $scale['height'], false );
				if ( is_wp_error( $result ) ) {
					return self::image_error( $result );
				}
			}
		}
		return true;
	}

	/**
	 * Records the item's current files as the original in WordPress's
	 * `_wp_attachment_backup_sizes` (`full-orig`, `<size>-orig`), so
	 * wp-admin's "Restore image" keeps working (§8.3).
	 *
	 * Files this edit replaces by rename get a hard link (the rename gives the
	 * live name a new inode, so the link keeps the original bytes); files that
	 * stay in place get a real copy, so nothing written to them later can
	 * change the recorded original.
	 *
	 * @param array<string, mixed> $meta
	 * @param array<string, mixed> $backup_sizes
	 * @param array<string, mixed> $entry
	 * @param array<string, true>  $replaced names this edit renames new files over
	 * @return array<string, mixed>|\WP_Error the new backup sizes
	 */
	private static function record_original( string $dir, string $main, array $meta, array $backup_sizes, string $token, array &$entry, array $replaced ) {
		$entry['orig'] = array();
		$copies        = array( 'full-orig' => array( $main, (int) ( $meta['width'] ?? 0 ), (int) ( $meta['height'] ?? 0 ), null ) );
		foreach ( (array) ( $meta['sizes'] ?? array() ) as $size_name => $size ) {
			if ( is_array( $size ) && ! empty( $size['file'] ) ) {
				$copies[ "{$size_name}-orig" ] = array( (string) $size['file'], 0, 0, $size );
			}
		}
		foreach ( $copies as $key => [ $name, $width, $height, $size ] ) {
			if ( ! Files::exists( $dir, $name ) ) {
				continue;
			}
			$copy = Files::tagged( $name, self::ORIG_TAG . $token );
			if ( ! Files::preserve( $dir, $name, $copy, isset( $replaced[ $name ] ) ) ) {
				return Api::error( 'wpu_io_error', 'Could not keep a copy of the original image.', 500 );
			}
			$entry['origFiles'][ $key ] = $copy;
			$entry['orig'][ $key ]      = $backup_sizes[ $key ] ?? null;
			if ( null === $size ) {
				$backup_sizes[ $key ] = array(
					'width'    => $width,
					'height'   => $height,
					'filesize' => (int) wp_filesize( Files::path( $dir, $copy ) ),
					'file'     => $copy,
				);
			} else {
				$size['file']         = $copy;
				$backup_sizes[ $key ] = $size;
			}
		}
		return $backup_sizes;
	}

	/**
	 * No meaningful original is recorded: none at all, or wp-admin's after a
	 * restore (where `full-orig` is the current file).
	 *
	 * @param array<string, mixed> $backup_sizes
	 */
	private static function needs_original( array $backup_sizes, string $main ): bool {
		$file = $backup_sizes['full-orig']['file'] ?? '';
		return '' === $file || wp_basename( (string) $file ) === $main;
	}

	// -------------------------------------------------------------------------
	// Undo and restore (§5.12, §5.13)
	// -------------------------------------------------------------------------

	/**
	 * Reverts the newest edit.
	 *
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	public static function undo( int $id ) {
		$item = self::load( $id );
		if ( is_wp_error( $item ) ) {
			return $item;
		}
		[ , $dir, , $meta ] = $item;
		$stack              = EditStack::get( $id );
		if ( ! EditStack::is_current( $id, $stack, $meta ) ) {
			return Api::error( 'wpu_nothing_to_undo', 'There is no edit to undo.', 409 );
		}
		$entry = array_pop( $stack );
		if ( null === $entry ) {
			return Api::error( 'wpu_nothing_to_undo', 'There is no edit to undo.', 409 );
		}
		$meta = self::revert( $id, $dir, $meta, $entry, $stack );
		if ( is_wp_error( $meta ) ) {
			return $meta;
		}
		return array(
			'sizes'      => count( (array) ( $meta['sizes'] ?? array() ) ),
			'urlChanged' => false,
		);
	}

	/**
	 * Brings back the original: every plugin edit is reverted, then an edit
	 * made in wp-admin is restored the way wp-admin does it.
	 *
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	public static function restore( int $id ) {
		$item = self::load( $id );
		if ( is_wp_error( $item ) ) {
			return $item;
		}
		[ $file, $dir, $main, $meta ] = $item;
		$stack                        = EditStack::get( $id );
		$ours                         = EditStack::is_current( $id, $stack, $meta );
		if ( ! $ours && ! self::has_admin_original( $id, $main ) ) {
			return Api::error( 'wpu_not_edited', 'There is no original image to restore.', 409 );
		}
		if ( $ours ) {
			while ( array() !== $stack ) {
				$entry = array_pop( $stack );
				$meta  = self::revert( $id, $dir, $meta, $entry, $stack );
				if ( is_wp_error( $meta ) ) {
					return $meta;
				}
			}
		} elseif ( array() !== $stack ) {
			self::drop_stack( $id, $dir, $meta, $stack );
		}

		$url_changed = false;
		if ( self::has_admin_original( $id, $main ) ) {
			$message = wp_restore_image( $id );
			if ( ! empty( $message->error ) ) {
				return Api::error( 'wpu_image_error', 'WordPress could not restore the original image.', 500, array( 'reason' => (string) $message->error ) );
			}
			$url_changed = get_attached_file( $id ) !== $file;
			self::touch_modified( $id );
			$meta = wp_get_attachment_metadata( $id );
		}
		return array(
			'sizes'      => count( (array) ( $meta['sizes'] ?? array() ) ),
			'urlChanged' => $url_changed,
		);
	}

	/**
	 * Puts one entry's files and metadata back and deletes what only the
	 * reverted state used.
	 *
	 * @param array<string, mixed>       $meta  the current metadata
	 * @param array<string, mixed>       $entry the entry being reverted (already popped)
	 * @param list<array<string, mixed>> $stack the entries left below it
	 * Every backup must exist before anything moves, and every move must
	 * succeed before the state is saved; otherwise 500 `wpu_io_error` and the
	 * stack stays as it was.
	 *
	 * @return array<string, mixed>|\WP_Error the restored metadata
	 */
	private static function revert( int $id, string $dir, array $meta, array $entry, array $stack ) {
		foreach ( $entry['saved'] as $backup ) {
			if ( ! Files::exists( $dir, (string) $backup ) ) {
				return Api::error( 'wpu_io_error', 'A backup of this edit is missing on the server; it can’t be undone.', 500 );
			}
		}
		foreach ( $entry['saved'] as $name => $backup ) {
			if ( ! Files::replace( $dir, (string) $backup, (string) $name ) ) {
				return Api::error( 'wpu_io_error', 'Could not put a backed-up file back.', 500 );
			}
		}
		$backup_sizes = self::backup_sizes( $id );
		if ( null !== $entry['orig'] ) {
			foreach ( $entry['orig'] as $key => $previous ) {
				if ( null === $previous ) {
					unset( $backup_sizes[ $key ] );
				} else {
					$backup_sizes[ $key ] = $previous;
				}
			}
		}
		$restored   = $entry['meta'];
		$candidates = array_values( array_map( 'strval', array_merge( Files::of_meta( $meta ), $entry['touched'], array_values( $entry['origFiles'] ) ) ) );
		self::save_state( $id, $restored, $stack, $backup_sizes );
		self::delete_unprotected( $id, $dir, $candidates, $restored, $stack, $backup_sizes );
		return $restored;
	}

	/**
	 * Forgets a stale stack (the item was edited, restored or replaced
	 * outside the plugin): its files are deleted unless something else
	 * still uses them.
	 *
	 * @param array<string, mixed>       $meta
	 * @param list<array<string, mixed>> $stack
	 */
	private static function drop_stack( int $id, string $dir, array $meta, array $stack ): void {
		// A recorded original that wp-admin's backup sizes still point at stays (it is protected).
		$backup_sizes = self::backup_sizes( $id );
		EditStack::save( $id, array() );
		self::delete_unprotected( $id, $dir, EditStack::files( $stack ), $meta, array(), $backup_sizes );
	}

	/**
	 * The stack, dropped first when it no longer describes the item.
	 *
	 * @param array<string, mixed> $meta
	 * @return list<array<string, mixed>>
	 */
	private static function current_stack( int $id, array $meta, string $dir ): array {
		$stack = EditStack::get( $id );
		if ( array() !== $stack && ! EditStack::is_current( $id, $stack, $meta ) ) {
			self::drop_stack( $id, $dir, $meta, $stack );
			return array();
		}
		return $stack;
	}

	/**
	 * wp-admin's editor recorded an original that differs from the current file.
	 */
	private static function has_admin_original( int $id, string $main ): bool {
		$file = self::backup_sizes( $id )['full-orig']['file'] ?? '';
		return '' !== $file && wp_basename( (string) $file ) !== $main;
	}

	// -------------------------------------------------------------------------
	// Regenerate (§5.14)
	// -------------------------------------------------------------------------

	/**
	 * Rebuilds every registered sub-size from the current full image. New
	 * sizes are made under temporary names and swapped in only when all of
	 * them were made; the old ones are deleted after that.
	 *
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	public static function regenerate( int $id ) {
		$item = self::load( $id );
		if ( is_wp_error( $item ) ) {
			return $item;
		}
		[ $file, $dir, $main, $meta ] = $item;
		if ( 'application/pdf' === get_post_mime_type( $id ) ) {
			return self::regenerate_pdf( $id, $file, $dir, $meta );
		}
		$stack        = EditStack::get( $id );
		$backup_sizes = self::backup_sizes( $id );
		$staged       = self::stage_sizes( $id, $file, $dir, $main, $meta, $meta, true, $stack, $backup_sizes );
		if ( is_wp_error( $staged ) ) {
			return $staged;
		}
		[ $renames, $new_sizes ] = $staged;
		$current_stack           = EditStack::is_current( $id, $stack, $meta );
		if ( $current_stack ) {
			$stack = self::back_up_for_stack( $dir, $stack, $renames );
			if ( is_wp_error( $stack ) ) {
				self::discard( $dir, array_map( 'strval', array_keys( $renames ) ) );
				return $stack;
			}
		}
		$swapped = self::swap_in( $dir, $renames );
		if ( is_wp_error( $swapped ) ) {
			return $swapped;
		}
		$new_meta          = $meta;
		$new_meta['sizes'] = $new_sizes;
		// The newest edit stays undoable: its entry now describes the regenerated sizes.
		if ( $current_stack ) {
			$stack = EditStack::refresh_top( $id, $stack, $new_meta );
		}
		self::save_state( $id, $new_meta, $stack, $backup_sizes );
		self::delete_unprotected( $id, $dir, Files::of_meta( $meta ), $new_meta, $stack, $backup_sizes );
		return array(
			'sizes'      => count( $new_sizes ),
			'urlChanged' => false,
		);
	}

	/**
	 * Regenerate replaces sub-size files an earlier state still needs (a
	 * thumbnail a `nothumb` edit left alone is the original thumbnail). Each
	 * such file is kept under a backup name in the newest entry, unless that
	 * entry already holds its earlier content, so undoing the entry brings
	 * the file back as it was before that edit.
	 *
	 * @param list<array<string, mixed>> $stack   a current, non-empty stack
	 * @param array<string, string>      $renames temp => target
	 * @return list<array<string, mixed>>|\WP_Error
	 */
	private static function back_up_for_stack( string $dir, array $stack, array $renames ) {
		$needed = array();
		foreach ( $stack as $entry ) {
			$needed += array_fill_keys( Files::of_meta( $entry['meta'] ), true );
		}
		$top = count( $stack ) - 1;
		foreach ( $renames as $target ) {
			if ( ! isset( $needed[ $target ] ) || isset( $stack[ $top ]['saved'][ $target ] ) || ! Files::exists( $dir, $target ) ) {
				continue;
			}
			$backup = Files::tagged( $target, self::BACKUP_TAG . $stack[ $top ]['token'] . 'r' );
			if ( ! Files::preserve( $dir, $target, $backup ) ) {
				return Api::error( 'wpu_io_error', 'Could not back up a file before overwriting it.', 500 );
			}
			$stack[ $top ]['saved'][ $target ] = $backup;
		}
		return $stack;
	}

	/**
	 * Makes every registered sub-size of `$source` under temporary names.
	 * Nothing live changes here. A target that only the undo stack or
	 * wp-admin's backups use (not the current sizes) is never overwritten.
	 *
	 * @param array<string, mixed>       $meta         the stored metadata (names, current files)
	 * @param array<string, mixed>       $new_meta     the metadata the sizes are for
	 * @param list<array<string, mixed>> $stack        the undo stack whose files must survive
	 * @param array<string, mixed>       $backup_sizes
	 * @return array{0: array<string, string>, 1: array<string, array<string, mixed>>}|\WP_Error renames (temp => target) and the new sizes
	 */
	private static function stage_sizes( int $id, string $source, string $dir, string $main, array $meta, array $new_meta, bool $exif_rotate, array $stack, array $backup_sizes ) {
		$sizes = self::make_sizes( $source, self::size_definitions( $id, $new_meta ), self::size_stem( $meta, $main ), $exif_rotate );
		if ( is_wp_error( $sizes ) ) {
			return $sizes;
		}
		$keep      = EditStack::protected_files( $id, array(), $stack, $backup_sizes );
		$current   = array_fill_keys( Files::of_meta( $meta ), true );
		$renames   = array();
		$new_sizes = array();
		$skipped   = array();
		foreach ( $sizes as $name => $size_result ) {
			$target = $size_result['meta']['file'];
			if ( isset( $skipped[ $target ] ) || ( Files::exists( $dir, $target ) && isset( $keep[ $target ] ) && ! isset( $current[ $target ] ) ) ) {
				Files::delete( $dir, $size_result['temp'] );
				$skipped[ $target ] = true;
				continue;
			}
			if ( '' !== $size_result['temp'] ) {
				$renames[ $size_result['temp'] ] = $target;
			}
			$new_sizes[ $name ] = $size_result['meta'];
		}
		return array( $renames, $new_sizes );
	}

	/**
	 * Renames staged files over their targets. On a failure the remaining
	 * temporaries are discarded and 500 `wpu_io_error` is returned.
	 *
	 * @param array<string, string> $renames temp => target
	 * @return true|\WP_Error
	 */
	private static function swap_in( string $dir, array $renames ) {
		foreach ( $renames as $temp => $target ) {
			if ( ! Files::replace( $dir, (string) $temp, $target ) ) {
				self::discard( $dir, array_map( 'strval', array_keys( $renames ) ) );
				return Api::error( 'wpu_io_error', 'Could not write a file into place.', 500 );
			}
		}
		return true;
	}

	/**
	 * PDFs: renders the first page as the preview (`<name>-pdf.jpg`, as core
	 * names it) and its sizes, under temporary names, then swaps them in. The
	 * old previews stay until the new ones are in place.
	 *
	 * @param array<string, mixed> $meta
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	private static function regenerate_pdf( int $id, string $file, string $dir, array $meta ) {
		if ( ! wp_image_editor_supports( array( 'mime_type' => 'application/pdf' ) ) ) {
			return Api::error( 'wpu_unsupported_type', 'This site can’t render PDF previews.', 415, array( 'mime' => 'application/pdf' ) );
		}
		$editor = self::editor( $file, false );
		if ( is_wp_error( $editor ) ) {
			return $editor;
		}
		$preview = isset( $meta['sizes']['full']['file'] )
			? wp_basename( (string) $meta['sizes']['full']['file'] )
			: wp_unique_filename( $dir, Files::stem( wp_basename( $file ) ) . '-pdf.jpg' );
		$temp    = Files::tagged( $preview, self::NEW_TAG . Files::token() );
		$saved   = self::save_editor( $editor, $dir, $temp, 'image/jpeg' );
		if ( is_wp_error( $saved ) ) {
			return $saved;
		}
		$defs = array_intersect_key(
			wp_get_registered_image_subsizes(),
			array_flip( (array) apply_filters( 'fallback_intermediate_image_sizes', array( 'thumbnail', 'medium', 'large' ), $meta ) )
		);
		if ( isset( $defs['thumbnail'] ) ) {
			$defs['thumbnail']['crop'] = false; // Soft crop, as core does for PDFs.
		}
		$sizes = self::make_sizes( Files::path( $dir, $temp ), $defs, Files::stem( $preview ), false );
		if ( is_wp_error( $sizes ) ) {
			self::discard( $dir, array( $temp ) );
			return $sizes;
		}
		$renames   = array( $temp => $preview );
		$new_sizes = array(
			'full' => array(
				'file'      => $preview,
				'width'     => $saved['width'],
				'height'    => $saved['height'],
				'mime-type' => 'image/jpeg',
				'filesize'  => $saved['filesize'],
			),
		);
		foreach ( $sizes as $name => $size_result ) {
			if ( '' !== $size_result['temp'] ) {
				$renames[ $size_result['temp'] ] = $size_result['meta']['file'];
			}
			$new_sizes[ $name ] = $size_result['meta'];
		}
		$swapped = self::swap_in( $dir, $renames );
		if ( is_wp_error( $swapped ) ) {
			return $swapped;
		}
		$new_meta             = $meta;
		$new_meta['sizes']    = $new_sizes;
		$new_meta['filesize'] = (int) wp_filesize( $file );
		self::touch_modified( $id );
		wp_update_attachment_metadata( $id, $new_meta );
		self::delete_dropped( $dir, $file, $meta, $new_meta );
		return array(
			'sizes'      => count( $new_sizes ),
			'urlChanged' => false,
		);
	}

	/**
	 * Deletes the files the old metadata used and the new one doesn't (never
	 * the attached file itself). For types without an undo stack.
	 *
	 * @param array<string, mixed> $meta
	 * @param array<string, mixed> $new_meta
	 */
	private static function delete_dropped( string $dir, string $file, array $meta, array $new_meta ): void {
		$keep = array_fill_keys( Files::of_meta( $new_meta ), true );
		foreach ( Files::of_meta( $meta ) as $name ) {
			if ( ! isset( $keep[ $name ] ) && wp_basename( $file ) !== $name ) {
				Files::delete( $dir, $name );
			}
		}
	}

	// -------------------------------------------------------------------------
	// Replace (§5.15, spike X3)
	// -------------------------------------------------------------------------

	/**
	 * Swaps in a new file under the item's existing name and rebuilds its
	 * metadata. `$upload` is the already validated file in the uploads folder.
	 * The undo stack and the original this plugin recorded describe the old
	 * image, so they go (§5.15), but only once the new file is in place: a
	 * failure before that leaves the item, its undo stack and its original as
	 * they were.
	 *
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	public static function replace( int $id, string $upload ) {
		$item = self::load( $id );
		if ( is_wp_error( $item ) ) {
			wp_delete_file( $upload );
			return $item;
		}
		[ $file, $dir, $main, $meta ] = $item;
		$mime                         = (string) get_post_mime_type( $id );
		$stack                        = EditStack::get( $id );

		$result = self::supports( $mime )
			? self::replace_image( $id, $file, $dir, $main, $meta, $upload, $mime, $stack )
			: self::replace_other( $id, $file, $dir, $meta, $upload, $mime );
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		if ( array() !== $stack ) {
			self::drop_recorded_original( $id, $stack );
			$current = wp_get_attachment_metadata( $id );
			self::drop_stack( $id, $dir, is_array( $current ) ? $current : array(), $stack );
		}
		return $result;
	}

	/**
	 * Raster images. The attached file keeps its name whatever the new size:
	 *
	 * - when the upload needs scaling (over `big_image_size_threshold`) or
	 *   rotating (EXIF), the attached file gets the processed version and the
	 *   upload is kept as the original: under the item's existing original name
	 *   for a `-scaled`/`-rotated` item, else as `<name>-original.<ext>`;
	 * - otherwise the attached file is the upload itself, and an old
	 *   original is deleted, since the item is no longer a scaled copy.
	 *
	 * Everything (main file, original, sizes) is made under temporary names
	 * first; nothing live changes unless all of it was made.
	 *
	 * @param array<string, mixed>       $meta
	 * @param list<array<string, mixed>> $stack
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	private static function replace_image( int $id, string $file, string $dir, string $main, array $meta, string $upload, string $mime, array $stack ) {
		$imagesize = wp_getimagesize( $upload );
		if ( empty( $imagesize ) ) {
			wp_delete_file( $upload );
			return Api::error( 'wpu_image_error', 'The new file is not a readable image.', 500, array( 'reason' => 'wp_getimagesize failed' ) );
		}
		$exif      = wp_read_image_metadata( $upload );
		$threshold = (int) apply_filters( 'big_image_size_threshold', 2560, $imagesize, $file, $id );
		$too_big   = $threshold > 0 && ( $imagesize[0] > $threshold || $imagesize[1] > $threshold );
		$rotated   = is_array( $exif ) && ! empty( $exif['orientation'] ) && 1 !== (int) $exif['orientation'];

		$token         = Files::token();
		$renames       = array();
		$original_name = null;
		if ( $too_big || $rotated ) {
			$original_name = ! empty( $meta['original_image'] )
				? wp_basename( (string) $meta['original_image'] )
				: wp_unique_filename( $dir, Files::stem( $main ) . '-original.' . Files::extension( $main ) );
		}

		$upload_temp = Files::tagged( $main, self::NEW_TAG . $token . 'u' );
		if ( ! Files::move( $upload, Files::path( $dir, $upload_temp ) ) ) {
			wp_delete_file( $upload );
			return Api::error( 'wpu_io_error', 'Could not move the new file into place.', 500 );
		}
		$main_temp = Files::tagged( $main, self::NEW_TAG . $token );
		$new_main  = $upload_temp;
		if ( $too_big || $rotated ) {
			$editor = self::editor( Files::path( $dir, $upload_temp ), false );
			if ( ! is_wp_error( $editor ) && $too_big ) {
				$editor = self::or_error( $editor, $editor->resize( $threshold, $threshold ) );
			}
			if ( ! is_wp_error( $editor ) && $rotated ) {
				$editor = self::or_error( $editor, $editor->maybe_exif_rotate() );
			}
			$saved = is_wp_error( $editor ) ? $editor : self::save_editor( $editor, $dir, $main_temp, $mime );
			if ( is_wp_error( $saved ) ) {
				self::discard( $dir, array( $upload_temp, $main_temp ) );
				return $saved;
			}
			$new_main                = $main_temp;
			$renames[ $main_temp ]   = $main;
			$renames[ $upload_temp ] = (string) $original_name;
		} else {
			$renames[ $upload_temp ] = $main;
		}

		$main_size = wp_getimagesize( Files::path( $dir, $new_main ) );
		$new_meta  = array(
			'width'    => (int) ( $main_size[0] ?? 0 ),
			'height'   => (int) ( $main_size[1] ?? 0 ),
			'file'     => (string) get_post_meta( $id, '_wp_attached_file', true ),
			'filesize' => (int) wp_filesize( Files::path( $dir, $new_main ) ),
			'sizes'    => array(),
		);
		$image_meta = wp_read_image_metadata( Files::path( $dir, $upload_temp ) );
		if ( is_array( $image_meta ) ) {
			if ( $rotated ) {
				$image_meta['orientation'] = 1;
			}
			$new_meta['image_meta'] = $image_meta;
		}
		if ( null !== $original_name ) {
			$new_meta['original_image'] = $original_name;
		}

		// The old image's undo stack still protects its files until replace() drops it.
		$backup_sizes = self::backup_sizes( $id );
		$staged       = self::stage_sizes( $id, Files::path( $dir, $new_main ), $dir, $main, $meta, $new_meta, false, $stack, $backup_sizes );
		if ( is_wp_error( $staged ) ) {
			self::discard( $dir, array_map( 'strval', array_keys( $renames ) ) );
			return $staged;
		}
		[ $size_renames, $new_sizes ] = $staged;
		$swapped                      = self::swap_in( $dir, $renames + $size_renames );
		if ( is_wp_error( $swapped ) ) {
			return $swapped;
		}
		$new_meta['sizes'] = $new_sizes;
		self::save_state( $id, $new_meta, $stack, $backup_sizes );
		self::delete_unprotected( $id, $dir, Files::of_meta( $meta ), $new_meta, $stack, $backup_sizes );
		return array(
			'sizes'      => count( $new_sizes ),
			'urlChanged' => false,
		);
	}

	/**
	 * Every other type (video, audio, documents, SVG): the file is swapped
	 * and WordPress rebuilds the metadata. A PDF gets a new preview when the
	 * site can render one; otherwise the previews of the old document go.
	 *
	 * @param array<string, mixed> $meta
	 * @return array{sizes: int, urlChanged: bool}|\WP_Error
	 */
	private static function replace_other( int $id, string $file, string $dir, array $meta, string $upload, string $mime ) {
		$token = Files::token();
		$temp  = Files::tagged( wp_basename( $file ), self::NEW_TAG . $token );
		if ( ! Files::move( $upload, Files::path( $dir, $temp ) ) || ! Files::replace( $dir, $temp, wp_basename( $file ) ) ) {
			wp_delete_file( $upload );
			self::discard( $dir, array( $temp ) );
			return Api::error( 'wpu_io_error', 'Could not write the new file.', 500 );
		}
		if ( 'application/pdf' === $mime && wp_image_editor_supports( array( 'mime_type' => 'application/pdf' ) ) ) {
			return self::regenerate_pdf( $id, $file, $dir, $meta );
		}
		$new_meta = 'application/pdf' === $mime ? array() : wp_generate_attachment_metadata( $id, $file );
		if ( ! is_array( $new_meta ) || array() === $new_meta ) {
			$new_meta = $meta;
			unset( $new_meta['sizes'] );
		}
		$new_meta['filesize'] = (int) wp_filesize( $file );
		self::touch_modified( $id );
		wp_update_attachment_metadata( $id, $new_meta );
		self::delete_dropped( $dir, $file, $meta, $new_meta );
		return array(
			'sizes'      => count( (array) ( $new_meta['sizes'] ?? array() ) ),
			'urlChanged' => false,
		);
	}

	/**
	 * Removes the original this plugin recorded in WordPress's backup sizes
	 * (it belongs to the old image), putting back what was there before.
	 *
	 * @param list<array<string, mixed>> $stack
	 */
	private static function drop_recorded_original( int $id, array $stack ): void {
		$backup_sizes = self::backup_sizes( $id );
		$changed      = false;
		foreach ( $stack as $entry ) {
			foreach ( (array) $entry['orig'] as $key => $previous ) {
				if ( ( $backup_sizes[ $key ]['file'] ?? null ) !== ( $entry['origFiles'][ $key ] ?? false ) ) {
					continue;
				}
				if ( null === $previous ) {
					unset( $backup_sizes[ $key ] );
				} else {
					$backup_sizes[ $key ] = $previous;
				}
				$changed = true;
			}
		}
		if ( $changed ) {
			self::put_backup_sizes( $id, $backup_sizes );
		}
	}

	// -------------------------------------------------------------------------
	// State for responses and the `wpu` field
	// -------------------------------------------------------------------------

	/**
	 * `edited`, `editedAt`, `undoable` and `restorable` (§7.1). Reads only
	 * post meta, so a primed meta cache answers it without queries.
	 *
	 * @return array{edited: bool, editedAt: string|null, undoable: bool, restorable: bool}
	 */
	public static function state( int $id ): array {
		$meta  = wp_get_attachment_metadata( $id );
		$meta  = is_array( $meta ) ? $meta : array();
		$stack = EditStack::get( $id );
		$ours  = EditStack::is_current( $id, $stack, $meta );
		$main  = wp_basename( (string) get_post_meta( $id, '_wp_attached_file', true ) );
		$admin = '' !== $main && self::has_admin_original( $id, $main );

		$edited_at = null;
		if ( $ours ) {
			$edited_at = Api::iso_from_unix( (int) $stack[ count( $stack ) - 1 ]['at'] );
		} elseif ( $admin && preg_match( '/-e(\d{10})\d{3}(?:\.|-)/', $main . '.', $match ) ) {
			// wp-admin names edits `-e<time><3 random digits>`.
			$edited_at = Api::iso_from_unix( (int) $match[1] );
		}
		return array(
			'edited'     => $ours || $admin,
			'editedAt'   => $edited_at,
			'undoable'   => $ours,
			'restorable' => $ours || $admin,
		);
	}

	/**
	 * Deleting an attachment deletes the files only the undo stack kept
	 * (§8.3). WordPress deletes the rest, including the backup sizes.
	 */
	public static function on_delete_attachment( int $id ): void {
		$stack = EditStack::get( $id );
		if ( array() === $stack ) {
			return;
		}
		$file = get_attached_file( $id, true );
		if ( ! $file ) {
			return;
		}
		foreach ( EditStack::files( $stack ) as $name ) {
			Files::delete( dirname( $file ), $name );
		}
	}

	// -------------------------------------------------------------------------
	// Shared internals
	// -------------------------------------------------------------------------

	/**
	 * The attached file, its folder and name, and the metadata.
	 *
	 * @return array{0: string, 1: string, 2: string, 3: array<string, mixed>}|\WP_Error
	 */
	private static function load( int $id ) {
		self::prepare();
		$file = get_attached_file( $id, true );
		if ( ! $file || ! is_file( $file ) ) {
			return Api::error( 'wpu_io_error', 'The item’s file is missing on the server.', 500 );
		}
		$meta = wp_get_attachment_metadata( $id, true );
		return array( $file, dirname( $file ), wp_basename( $file ), is_array( $meta ) ? $meta : array() );
	}

	/**
	 * @return \WP_Image_Editor|\WP_Error
	 */
	private static function editor( string $path, bool $exif_rotate ) {
		$editor = wp_get_image_editor( $path );
		if ( is_wp_error( $editor ) ) {
			return self::image_error( $editor );
		}
		if ( $exif_rotate ) {
			$rotated = $editor->maybe_exif_rotate();
			if ( is_wp_error( $rotated ) ) {
				return self::image_error( $rotated );
			}
		}
		return $editor;
	}

	/**
	 * @param mixed $result
	 * @return \WP_Image_Editor|\WP_Error
	 */
	private static function or_error( \WP_Image_Editor $editor, $result ) {
		return is_wp_error( $result ) ? self::image_error( $result ) : $editor;
	}

	/**
	 * @return array{width: int, height: int, filesize: int}|\WP_Error
	 */
	private static function save_editor( \WP_Image_Editor $editor, string $dir, string $name, string $mime ) {
		$saved = $editor->save( Files::path( $dir, $name ), $mime );
		if ( is_wp_error( $saved ) ) {
			return self::image_error( $saved );
		}
		if ( wp_basename( (string) $saved['path'] ) !== $name ) {
			// A filter changed the name or format: never let that change the URL.
			Files::delete( $dir, wp_basename( (string) $saved['path'] ) );
			return Api::error( 'wpu_image_error', 'The image editor saved the image under another name or format.', 500, array( 'reason' => 'unexpected output file' ) );
		}
		return array(
			'width'    => (int) $saved['width'],
			'height'   => (int) $saved['height'],
			'filesize' => (int) ( $saved['filesize'] ?? wp_filesize( Files::path( $dir, $name ) ) ),
		);
	}

	/**
	 * The registered sizes WordPress would make for this item.
	 *
	 * @param array<string, mixed> $meta
	 * @return array<string, array{width: int, height: int, crop: mixed}>
	 */
	private static function size_definitions( int $id, array $meta ): array {
		$sizes = wp_get_registered_image_subsizes();
		$sizes = apply_filters( 'intermediate_image_sizes_advanced', $sizes, $meta, $id );
		return is_array( $sizes ) ? $sizes : array();
	}

	/**
	 * Sub-size files are named `<stem>-<w>x<h>.<ext>`, with the stem the
	 * current sizes use (core names them after the unscaled original, wp-admin
	 * after its `-e…` file), so a size with unchanged dimensions keeps its URL.
	 *
	 * @param array<string, mixed> $meta
	 */
	private static function size_stem( array $meta, string $main ): string {
		foreach ( (array) ( $meta['sizes'] ?? array() ) as $size ) {
			if ( is_array( $size ) && preg_match( '/^(.+)-\d+x\d+\.[^.]+$/', (string) ( $size['file'] ?? '' ), $match ) ) {
				return $match[1];
			}
		}
		if ( ! empty( $meta['original_image'] ) ) {
			return Files::stem( wp_basename( (string) $meta['original_image'] ) );
		}
		return Files::stem( $main );
	}

	/**
	 * Makes each sub-size of `$source` under a temporary name next to it.
	 *
	 * The editor works on a temporary link (or copy) of the source:
	 * make_subsize() saves next to its source and names the output after it,
	 * so working on a live file would write the outputs straight over the live
	 * sub-size files, in place. Sizes the image is too small for are skipped,
	 * as core skips them; any other failure discards everything made so far
	 * and returns 500 `wpu_image_error` (or `wpu_io_error`).
	 *
	 * @param array<string, array<string, mixed>> $defs
	 * @return array<string, array{temp: string, meta: array<string, mixed>}>|\WP_Error
	 */
	private static function make_sizes( string $source, array $defs, string $stem, bool $exif_rotate ) {
		if ( array() === $defs ) {
			return array();
		}
		$dir  = dirname( $source );
		$work = Files::tagged( wp_basename( $source ), self::NEW_TAG . Files::token() . 's' );
		if ( ! Files::preserve( $dir, wp_basename( $source ), $work ) ) {
			return Api::error( 'wpu_io_error', 'Could not prepare the image for its sub-sizes.', 500 );
		}
		$editor = self::editor( Files::path( $dir, $work ), $exif_rotate );
		if ( is_wp_error( $editor ) ) {
			Files::delete( $dir, $work );
			return $editor;
		}
		$size    = $editor->get_size();
		$made    = array();
		$targets = array();
		$failure = null;
		foreach ( $defs as $name => $def ) {
			if ( ! image_resize_dimensions( (int) $size['width'], (int) $size['height'], (int) ( $def['width'] ?? 0 ), (int) ( $def['height'] ?? 0 ), $def['crop'] ?? false ) ) {
				continue; // Too small for this size (or nothing to resize), as core skips it.
			}
			// Both core editors (GD, Imagick) have it since WordPress 5.3; the base class doesn't declare it.
			$result = method_exists( $editor, 'make_subsize' ) ? $editor->make_subsize( $def ) : new \WP_Error( 'image_subsize_unsupported', 'The image editor cannot make sub-sizes.' );
			if ( is_wp_error( $result ) ) {
				$failure = self::image_error( $result );
				break;
			}
			$target = sprintf( '%s-%dx%d.%s', $stem, $result['width'], $result['height'], Files::extension( (string) $result['file'] ) );
			if ( isset( $targets[ $target ] ) ) {
				// Another size already made this file: share it (an empty temp is staged once).
				Files::delete( $dir, (string) $result['file'] );
				$made[ $name ] = array(
					'temp' => '',
					'meta' => array_merge( $result, array( 'file' => $target ) ),
				);
				continue;
			}
			// Each size gets its own temporary name, so two sizes never share one.
			$temp = Files::tagged( $target, self::NEW_TAG . Files::token() );
			if ( ! Files::replace( $dir, (string) $result['file'], $temp ) ) {
				Files::delete( $dir, (string) $result['file'] );
				$failure = Api::error( 'wpu_io_error', 'Could not write a sub-size file.', 500 );
				break;
			}
			$targets[ $target ] = $temp;
			$made[ $name ]      = array(
				'temp' => $temp,
				'meta' => array_merge( $result, array( 'file' => $target ) ),
			);
		}
		Files::delete( $dir, $work );
		if ( null !== $failure ) {
			self::discard( $dir, array_values( $targets ) );
			return $failure;
		}
		return $made;
	}

	/**
	 * Swaps staged files in. Every existing target is preserved first
	 * (`$saved` collects name => backup); on failure everything is put back.
	 *
	 * @param array<string, string> $staged temp name => target name
	 * @param array<string, string> $saved  backups made so far
	 * @return array<string, string>|\WP_Error the backups
	 */
	private static function commit( string $dir, array $staged, string $token, array $saved ) {
		$staged = array_filter( $staged, static fn ( $target, $temp ) => '' !== $temp, ARRAY_FILTER_USE_BOTH );
		foreach ( $staged as $target ) {
			if ( Files::exists( $dir, $target ) && ! isset( $saved[ $target ] ) ) {
				$backup = Files::tagged( $target, self::BACKUP_TAG . $token );
				if ( ! Files::preserve( $dir, $target, $backup ) ) {
					self::discard( $dir, array_merge( array_keys( $staged ), array_values( $saved ) ) );
					return Api::error( 'wpu_io_error', 'Could not back up a file before overwriting it.', 500 );
				}
				$saved[ $target ] = $backup;
			}
		}
		$done = array();
		foreach ( $staged as $temp => $target ) {
			if ( ! Files::replace( $dir, $temp, $target ) ) {
				foreach ( $done as $written ) {
					if ( isset( $saved[ $written ] ) ) {
						Files::replace( $dir, $saved[ $written ], $written );
					}
				}
				self::discard( $dir, array_merge( array_keys( $staged ), array_values( $saved ) ) );
				return Api::error( 'wpu_io_error', 'Could not write the edited image.', 500 );
			}
			$done[] = $target;
		}
		return $saved;
	}

	/**
	 * Saves the metadata, the undo stack, the backup sizes and `post_modified`
	 * (so `expectedModified` detects concurrent edits, §5.11).
	 *
	 * @param array<string, mixed>       $meta
	 * @param list<array<string, mixed>> $stack
	 * @param array<string, mixed>       $backup_sizes
	 */
	private static function save_state( int $id, array $meta, array $stack, array $backup_sizes ): void {
		self::touch_modified( $id );
		self::put_backup_sizes( $id, $backup_sizes );
		EditStack::save( $id, $stack );
		wp_update_attachment_metadata( $id, $meta );
	}

	/**
	 * @param array<string, mixed> $backup_sizes
	 */
	private static function put_backup_sizes( int $id, array $backup_sizes ): void {
		if ( array() === $backup_sizes ) {
			delete_post_meta( $id, '_wp_attachment_backup_sizes' );
			return;
		}
		update_post_meta( $id, '_wp_attachment_backup_sizes', wp_slash( $backup_sizes ) );
	}

	/**
	 * Sets `post_modified` to now without wp_update_post(), which would run
	 * the content filters over the item's text as the current user. No core
	 * hook fires for this write (and none for metadata saved unchanged), so
	 * the media index row is re-read here: it records `post_modified_gmt`,
	 * and a row behind it would make the index look stale (§9.3).
	 */
	public static function touch_modified( int $id ): void {
		global $wpdb;
		$wpdb->update(
			$wpdb->posts,
			array(
				'post_modified'     => current_time( 'mysql' ),
				'post_modified_gmt' => current_time( 'mysql', true ),
			),
			array( 'ID' => $id ),
			array( '%s', '%s' ),
			array( '%d' )
		);
		clean_post_cache( $id );
		MediaIndex::mark( $id );
	}

	/**
	 * @return array<string, mixed>
	 */
	private static function backup_sizes( int $id ): array {
		$sizes = get_post_meta( $id, '_wp_attachment_backup_sizes', true );
		return is_array( $sizes ) ? $sizes : array();
	}

	/**
	 * Deletes candidate files unless the current state, the stack or the
	 * backup sizes still reference them.
	 *
	 * @param list<string>               $candidates
	 * @param array<string, mixed>       $meta
	 * @param list<array<string, mixed>> $stack
	 * @param array<string, mixed>       $backup_sizes
	 */
	private static function delete_unprotected( int $id, string $dir, array $candidates, array $meta, array $stack, array $backup_sizes ): void {
		$keep = EditStack::protected_files( $id, $meta, $stack, $backup_sizes );
		foreach ( array_unique( $candidates ) as $name ) {
			if ( ! isset( $keep[ $name ] ) ) {
				Files::delete( $dir, (string) $name );
			}
		}
	}

	/**
	 * @param list<string> $names
	 */
	private static function discard( string $dir, array $names ): void {
		foreach ( $names as $name ) {
			Files::delete( $dir, (string) $name );
		}
	}

	private static function invalid_edit( string $reason ): \WP_Error {
		return Api::error( 'wpu_invalid_edit', $reason, 400, array( 'reason' => $reason ) );
	}

	private static function image_error( \WP_Error $error ): \WP_Error {
		return Api::error( 'wpu_image_error', 'The image editor failed.', 500, array( 'reason' => $error->get_error_message() ) );
	}
}
