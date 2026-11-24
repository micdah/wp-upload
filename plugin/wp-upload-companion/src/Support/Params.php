<?php
/**
 * Validation helpers for request bodies and query strings (plugin-api.md §1.2,
 * §11): JSON bodies are objects with known keys only, numbers are real JSON
 * integers, id lists are bounded.
 *
 * Each helper returns the value or a WP_Error (400 `wpu_invalid_param` /
 * `wpu_too_many_items`); callers return the error as is.
 *
 * Shared by tracks P1 and P2. Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Support;

final class Params {

	/**
	 * The JSON body as an associative array, rejecting unknown keys.
	 *
	 * @param list<string> $allowed_keys
	 * @param bool         $optional     An empty body counts as `{}`.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function body( \WP_REST_Request $request, array $allowed_keys, bool $optional = false ) {
		$raw = trim( (string) $request->get_body() );
		if ( '' === $raw ) {
			return $optional ? array() : Errors::invalid_param( 'body', 'The request body must be a JSON object.' );
		}
		$body = json_decode( $raw, true );
		if ( ! is_array( $body ) || ( array() !== $body && self::is_list( $body ) ) ) {
			return Errors::invalid_param( 'body', 'The request body must be a JSON object.' );
		}
		foreach ( array_keys( $body ) as $key ) {
			if ( ! in_array( $key, $allowed_keys, true ) ) {
				return Errors::invalid_param( (string) $key, sprintf( 'Unknown field: %s.', $key ) );
			}
		}
		return $body;
	}

	/**
	 * A JSON integer within bounds (floats like 1.0 and numeric strings are rejected).
	 *
	 * @param mixed $value
	 * @return int|\WP_Error
	 */
	public static function int( $value, string $param, int $min, int $max = PHP_INT_MAX ) {
		if ( ! is_int( $value ) || $value < $min || $value > $max ) {
			return Errors::invalid_param(
				$param,
				sprintf( '%s must be an integer from %d to %d.', $param, $min, $max )
			);
		}
		return $value;
	}

	/**
	 * A list of positive integer ids, 1..$max entries, duplicates removed (first one kept).
	 *
	 * @param mixed $value
	 * @return list<int>|\WP_Error
	 */
	public static function ids( $value, string $param, int $max ) {
		if ( ! is_array( $value ) || array() === $value || ! self::is_list( $value ) ) {
			return Errors::invalid_param( $param, sprintf( '%s must be a non-empty list of ids.', $param ) );
		}
		if ( count( $value ) > $max ) {
			return Errors::too_many_items( $param, $max );
		}
		$ids = array();
		foreach ( $value as $id ) {
			if ( ! is_int( $id ) || $id < 1 ) {
				return Errors::invalid_param( $param, sprintf( '%s must hold positive integer ids.', $param ) );
			}
			$ids[ $id ] = $id;
		}
		return array_values( $ids );
	}

	/**
	 * A query-string parameter as a string, or null when absent or empty.
	 *
	 * @return string|null|\WP_Error
	 */
	public static function query_string( \WP_REST_Request $request, string $param ) {
		$value = $request->get_query_params()[ $param ] ?? null;
		if ( null === $value ) {
			return null;
		}
		if ( ! is_string( $value ) ) {
			return Errors::invalid_param( $param );
		}
		return '' === $value ? null : $value;
	}

	/**
	 * Trims and collapses inner whitespace (folder names, search text).
	 */
	public static function collapse_whitespace( string $value ): string {
		return trim( (string) preg_replace( '/\s+/u', ' ', $value ) );
	}

	/**
	 * `array_is_list()` is PHP 8.1+, and the file must still load on older PHP
	 * (see Errors.php).
	 *
	 * @param array<mixed> $value
	 */
	public static function is_list( array $value ): bool {
		$expected = 0;
		foreach ( array_keys( $value ) as $key ) {
			if ( $key !== $expected ) {
				return false;
			}
			++$expected;
		}
		return true;
	}
}
