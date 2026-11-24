<?php
/**
 * Registers `wp-upload/v1` routes with the plugin's common rules: the
 * `upload_files` permission check that answers 403 (never 401, plugin-api.md
 * §1.4), and a wrapper that turns any Throwable into 500 `wpu_internal`.
 *
 * Shared by tracks P1 and P2. Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Support;

use WpUpload\Companion\Plugin;

final class Routes {

	/**
	 * @param non-falsy-string $path Route path relative to the namespace, e.g. '/folders/(?P<id>\d+)'.
	 * @param string   $methods  'GET', 'POST', or WP_REST_Server::EDITABLE / DELETABLE.
	 * @param callable $callback Receives the WP_REST_Request; returns data, a WP_REST_Response or a WP_Error.
	 * @param callable|null $permission Optional permission callback; defaults to Permissions::upload_files.
	 */
	public static function add( string $path, string $methods, callable $callback, ?callable $permission = null ): void {
		register_rest_route(
			Plugin::REST_NAMESPACE,
			$path,
			array(
				'methods'             => $methods,
				'callback'            => static function ( \WP_REST_Request $request ) use ( $callback ) {
					return self::run( $callback, $request );
				},
				'permission_callback' => null === $permission ? array( Permissions::class, 'upload_files' ) : $permission,
			)
		);
	}

	/**
	 * @return mixed
	 */
	public static function run( callable $callback, \WP_REST_Request $request ) {
		try {
			$result = $callback( $request );
		} catch ( \Throwable $error ) {
			return Errors::internal( $error );
		}
		if ( $result instanceof \WP_Error || $result instanceof \WP_REST_Response ) {
			return $result;
		}
		return rest_ensure_response( $result );
	}

	/**
	 * A response with a status other than 200 (e.g. 201 for POST /folders).
	 *
	 * @param mixed $data
	 */
	public static function respond( $data, int $status ): \WP_REST_Response {
		$response = new \WP_REST_Response( $data );
		$response->set_status( $status );
		return $response;
	}
}
