<?php
/**
 * GET /rev, GET /collection and GET /facets (plugin-api.md §5.1-5.3).
 * Every read takes the rev before it queries (§1.7), so a response is never
 * tagged with a newer rev than its data.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\Index\IndexStatus;
use WpUpload\Companion\Index\UsageBridge;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Query\CollectionQuery;
use WpUpload\Companion\Rev;
use WpUpload\Companion\Support\Routes;

final class CollectionController {

	public static function register(): void {
		Plugin::provide_feature( 'collection' );
		Plugin::provide_feature( 'facets' );
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		Routes::add( '/rev', 'GET', array( self::class, 'rev' ) );
		Routes::add( '/collection', 'GET', array( self::class, 'collection' ) );
		Routes::add( '/facets', 'GET', array( self::class, 'facets' ) );
	}

	/**
	 * Cheap change detection: options only (§5.1).
	 *
	 * @return array<string, mixed>
	 */
	public static function rev(): array {
		return array(
			'rev'   => Rev::current(),
			'index' => IndexStatus::get(),
		);
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function collection( \WP_REST_Request $request ) {
		$rev   = Rev::current();
		$query = CollectionQuery::from_request( $request );
		if ( is_wp_error( $query ) ) {
			return $query;
		}
		wp_raise_memory_limit( 'wpu_collection' );
		$result = $query->rows();
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		return array(
			'rev'           => $rev,
			'query'         => $query->to_array(),
			'total'         => $result['total'],
			'rows'          => $result['rows'],
			'indexComplete' => $query->index_complete(),
		);
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function facets( \WP_REST_Request $request ) {
		$rev   = Rev::current();
		$query = CollectionQuery::from_request( $request );
		if ( is_wp_error( $query ) ) {
			return $query;
		}
		$facets = $query->facets();
		return array(
			'rev'           => $rev,
			'query'         => $query->to_array(),
			'view'          => $facets['view'],
			'folder'        => $facets['folder'],
			'months'        => $facets['months'],
			'indexComplete' => $query->index_complete(),
			'usageComplete' => UsageBridge::is_ready(),
		);
	}
}
