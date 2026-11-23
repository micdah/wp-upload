<?php
/**
 * M0 scaffold stub, owned by track P1. Implement the routes below as
 * specified in docs/media-manager/contracts/plugin-api.md; until then each
 * answers 501 wpu_not_implemented.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\Plugin;

final class CollectionController {

	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		register_rest_route(
			Plugin::REST_NAMESPACE,
			'/rev',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'not_implemented' ),
				'permission_callback' => static fn () => current_user_can( 'upload_files' ),
			)
		);
		register_rest_route(
			Plugin::REST_NAMESPACE,
			'/collection',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'not_implemented' ),
				'permission_callback' => static fn () => current_user_can( 'upload_files' ),
			)
		);
		register_rest_route(
			Plugin::REST_NAMESPACE,
			'/facets',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'not_implemented' ),
				'permission_callback' => static fn () => current_user_can( 'upload_files' ),
			)
		);
	}

	public static function not_implemented(): \WP_Error {
		return new \WP_Error( 'wpu_not_implemented', 'Not implemented yet.', array( 'status' => 501 ) );
	}
}
