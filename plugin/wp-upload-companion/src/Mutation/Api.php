<?php
/**
 * Small helpers shared by track P2's REST controllers: errors, permission
 * callbacks, request-body validation, time formatting and the catch-all
 * wrapper (docs/media-manager/contracts/plugin-api.md §1 and §4).
 *
 * Owned by track P2. P1 may publish equivalents; the orchestrator can fold
 * these into them when the two tracks are integrated.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Mutation;

final class Api {

	/**
	 * A contract error (§4) as WordPress serialises it.
	 *
	 * @param array<string, mixed> $extra Extra `data` keys.
	 */
	public static function error( string $code, string $message, int $status, array $extra = array() ): \WP_Error {
		return new \WP_Error( $code, $message, array_merge( array( 'status' => $status ), $extra ) );
	}

	/**
	 * 400 wpu_invalid_param naming the offending parameter.
	 */
	public static function invalid( string $param, string $message ): \WP_Error {
		return self::error( 'wpu_invalid_param', $message, 400, array( 'param' => $param ) );
	}

	/**
	 * One failed entry of a per-item result list (§1.5).
	 *
	 * @return array{id: int, ok: false, error: array{code: string, message: string}}
	 */
	public static function item_error( int $id, string $code, string $message ): array {
		return array(
			'id'    => $id,
			'ok'    => false,
			'error' => array(
				'code'    => $code,
				'message' => $message,
			),
		);
	}

	/**
	 * The per-item failure for a WP_Error raised while processing one item.
	 *
	 * @return array{id: int, ok: false, error: array{code: string, message: string}}
	 */
	public static function item_error_from( int $id, \WP_Error $error ): array {
		return self::item_error( $id, (string) $error->get_error_code(), $error->get_error_message() );
	}

	/**
	 * The baseline permission of every route (§1.3). Never returns false, so
	 * WordPress never answers 401 on the plugin's behalf (§1.4).
	 *
	 * @return true|\WP_Error
	 */
	public static function can_upload() {
		if ( current_user_can( 'upload_files' ) ) {
			return true;
		}
		return self::error( 'wpu_forbidden', 'You need the upload_files capability (Author role or higher).', 403 );
	}

	/**
	 * Wraps a route callback so any Throwable becomes a generic 500
	 * wpu_internal, with the detail only in the PHP error log (§11).
	 */
	public static function guarded( callable $callback ): callable {
		return static function ( \WP_REST_Request $request ) use ( $callback ) {
			try {
				return $callback( $request );
			} catch ( \Throwable $throwable ) {
				// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
				error_log( 'wp-upload-companion: ' . $throwable->getMessage() . ' in ' . $throwable->getFile() . ':' . $throwable->getLine() );
				return self::error( 'wpu_internal', 'The plugin hit an unexpected error. Details are in the PHP error log.', 500 );
			}
		};
	}

	/**
	 * The JSON body as an associative array, with unknown keys rejected
	 * (§1.2). An absent or empty body is an empty array.
	 *
	 * @param list<string> $allowed_keys
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function json_body( \WP_REST_Request $request, array $allowed_keys ) {
		$body = $request->get_json_params();
		if ( null === $body ) {
			$raw = trim( (string) $request->get_body() );
			if ( '' !== $raw ) {
				return self::invalid( 'body', 'The request body must be a JSON object.' );
			}
			$body = array();
		}
		if ( ! is_array( $body ) || ( array() !== $body && array_is_list( $body ) ) ) {
			return self::invalid( 'body', 'The request body must be a JSON object.' );
		}
		$unknown = self::unknown_key( $body, $allowed_keys );
		if ( null !== $unknown ) {
			return self::invalid( $unknown, sprintf( 'Unknown field "%s".', $unknown ) );
		}
		return $body;
	}

	/**
	 * The first key of an object that isn't allowed, or null.
	 *
	 * @param array<mixed>  $value
	 * @param list<string>  $allowed_keys
	 */
	public static function unknown_key( array $value, array $allowed_keys ): ?string {
		foreach ( array_keys( $value ) as $key ) {
			if ( ! in_array( (string) $key, $allowed_keys, true ) ) {
				return (string) $key;
			}
		}
		return null;
	}

	/**
	 * True for a JSON object decoded as an array (an empty `{}` decodes to
	 * an empty array, which is accepted too).
	 */
	public static function is_object( mixed $value ): bool {
		return is_array( $value ) && ( array() === $value || ! array_is_list( $value ) );
	}

	/**
	 * A positive integer, as `Support\Params` reads numbers: a JSON integer
	 * only (a float such as `1.0` and a numeric string are rejected), so
	 * every route parses ids and counts the same way.
	 */
	public static function positive_int( mixed $value ): ?int {
		return is_int( $value ) && $value >= 1 ? $value : null;
	}

	/**
	 * A `*_gmt` column (`Y-m-d H:i:s`) as ISO 8601 UTC with a `Z` (§1.2).
	 * The zero date is null.
	 */
	public static function iso_from_gmt( ?string $mysql_gmt ): ?string {
		if ( null === $mysql_gmt || '' === $mysql_gmt || str_starts_with( $mysql_gmt, '0000-00-00' ) ) {
			return null;
		}
		return str_replace( ' ', 'T', substr( $mysql_gmt, 0, 19 ) ) . 'Z';
	}

	/**
	 * A Unix timestamp as ISO 8601 UTC with a `Z`.
	 */
	public static function iso_from_unix( int $timestamp ): string {
		return gmdate( 'Y-m-d\TH:i:s\Z', $timestamp );
	}

	/**
	 * Plain-text title: WordPress's kses stores `&amp;`, the API returns `&` (§1.2).
	 */
	public static function plain_text( string $value ): string {
		return html_entity_decode( $value, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
	}

	/**
	 * The attachment with this id, or null (any status, never auto-draft).
	 */
	public static function attachment( int $id ): ?\WP_Post {
		$post = get_post( $id );
		if ( ! $post instanceof \WP_Post || 'attachment' !== $post->post_type || 'auto-draft' === $post->post_status ) {
			return null;
		}
		return $post;
	}

	/**
	 * The per-item 404 message the contract's examples use.
	 */
	public static function not_found_message( int $id ): string {
		return sprintf( 'Media item %d does not exist.', $id );
	}
}
