<?php
/**
 * The plugin's `wpu_*` errors (plugin-api.md §4), built in one place so codes,
 * statuses and extra `data` keys stay consistent across controllers.
 *
 * Shared by tracks P1 and P2. Owned by track P1.
 *
 * Syntax rule for every shipped file: it must parse on PHP 7.4, because the
 * single-file build is also dropped into mu-plugins, where WordPress doesn't
 * check `Requires PHP` and the entry file's own version check can only run if
 * the file parses (plugin-api.md §2.1).
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Support;

final class Errors {

	/**
	 * @param array<string, mixed> $data Extra `data` keys, passed on by the server as `details`.
	 */
	public static function make( string $code, string $message, int $status, array $data = array() ): \WP_Error {
		return new \WP_Error( $code, $message, array_merge( array( 'status' => $status ), $data ) );
	}

	public static function forbidden( string $message = '' ): \WP_Error {
		if ( '' === $message ) {
			$message = 'You need the upload_files capability (Author role or higher).';
		}
		return self::make( 'wpu_forbidden', $message, 403 );
	}

	public static function invalid_param( string $param, string $message = '' ): \WP_Error {
		if ( '' === $message ) {
			$message = sprintf( 'Invalid parameter: %s.', $param );
		}
		return self::make( 'wpu_invalid_param', $message, 400, array( 'param' => $param ) );
	}

	public static function too_many_items( string $param, int $max ): \WP_Error {
		return self::make(
			'wpu_too_many_items',
			sprintf( 'At most %d entries are allowed in %s.', $max, $param ),
			400,
			array(
				'param' => $param,
				'max'   => $max,
			)
		);
	}

	public static function not_found( int $id ): \WP_Error {
		return self::make( 'wpu_not_found', sprintf( 'Media item %d does not exist.', $id ), 404 );
	}

	public static function folder_not_found( int $folder ): \WP_Error {
		return self::make(
			'wpu_folder_not_found',
			sprintf( 'Folder %d does not exist.', $folder ),
			404,
			array( 'folder' => $folder )
		);
	}

	public static function filebird_inactive(): \WP_Error {
		return self::make( 'wpu_filebird_inactive', 'FileBird is not active, so folders are unavailable.', 409 );
	}

	public static function filebird_per_user(): \WP_Error {
		return self::make(
			'wpu_filebird_per_user',
			'FileBird is in per-user folder mode, so folders are read-only here.',
			409
		);
	}

	public static function not_implemented( string $what = '' ): \WP_Error {
		$message = '' === $what ? 'Not implemented yet.' : sprintf( 'Not available: %s.', $what );
		return self::make( 'wpu_not_implemented', $message, 501 );
	}

	/**
	 * A caught Throwable: a generic message for the client, the details only in
	 * the PHP error log (plugin-api.md §11).
	 */
	public static function internal( \Throwable $error ): \WP_Error {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log(
			sprintf(
				'wp-upload-companion: %s: %s in %s:%d',
				get_class( $error ),
				$error->getMessage(),
				$error->getFile(),
				$error->getLine()
			)
		);
		return self::make( 'wpu_internal', 'Internal error in the wp-upload companion plugin.', 500 );
	}

	/**
	 * `{code, message}` of a per-item failure (plugin-api.md §1.5).
	 *
	 * @return array{code: string, message: string}
	 */
	public static function item( \WP_Error $error ): array {
		return array(
			'code'    => (string) $error->get_error_code(),
			'message' => $error->get_error_message(),
		);
	}
}
