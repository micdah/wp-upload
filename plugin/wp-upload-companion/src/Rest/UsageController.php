<?php
/**
 * `GET /usage` and `POST /usage`: where items are used
 * (docs/media-manager/contracts/plugin-api.md §5.10).
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\Index\UsageIndex;
use WpUpload\Companion\Mutation\Api;
use WpUpload\Companion\Mutation\Rev;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Support\Params;

final class UsageController {

	public const MAX_IDS = 100;

	/** Refs returned per item; `count` is always the full number (§5.10). */
	public const MAX_REFS = 200;

	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		register_rest_route(
			Plugin::REST_NAMESPACE,
			'/usage',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => Api::guarded( array( self::class, 'get_usage' ) ),
					'permission_callback' => array( Api::class, 'can_upload' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => Api::guarded( array( self::class, 'post_usage' ) ),
					'permission_callback' => array( Api::class, 'can_upload' ),
				),
			)
		);
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function get_usage( \WP_REST_Request $request ) {
		$raw = $request->get_param( 'ids' );
		if ( ! is_string( $raw ) || '' === trim( $raw ) ) {
			return Api::invalid( 'ids', '"ids" must be a comma-separated list of ids.' );
		}
		$values = array();
		foreach ( explode( ',', $raw ) as $part ) {
			$part     = trim( $part );
			$values[] = ctype_digit( $part ) ? (int) $part : $part;
		}
		$ids = Params::ids( $values, 'ids', self::MAX_IDS );
		return is_wp_error( $ids ) ? $ids : self::usage( $ids );
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function post_usage( \WP_REST_Request $request ) {
		$body = Api::json_body( $request, array( 'ids' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$ids = Params::ids( $body['ids'] ?? null, 'ids', self::MAX_IDS );
		return is_wp_error( $ids ) ? $ids : self::usage( $ids );
	}

	/**
	 * `UsageResponse` for the ids, in request order.
	 *
	 * @param list<int> $ids
	 * @return array<string, mixed>
	 */
	public static function usage( array $ids ): array {
		$rev      = Rev::current();
		$complete = UsageIndex::complete();
		$unique   = array_values( array_unique( $ids ) );

		$contexts_by_item = array();
		$source_ids       = array();
		foreach ( UsageIndex::rows_for( $unique ) as $row ) {
			$source                                      = (int) $row->source_id;
			$key                                         = 0 === $source ? 's:' . $row->context : (string) $source;
			$contexts_by_item[ (int) $row->attachment_id ][ $key ][] = $row->context;
			if ( $source > 0 ) {
				$source_ids[ $source ] = true;
			}
		}
		if ( array() !== $source_ids ) {
			_prime_post_caches( array_keys( $source_ids ), false, false );
		}

		$items = array();
		foreach ( $ids as $id ) {
			$refs = array();
			foreach ( $contexts_by_item[ $id ] ?? array() as $key => $contexts ) {
				$ref = self::ref( (string) $key, $contexts );
				if ( null !== $ref ) {
					$refs[] = $ref;
				}
			}
			usort( $refs, array( self::class, 'compare_refs' ) );
			$items[] = array(
				'id'    => $id,
				'count' => count( $refs ),
				'refs'  => array_slice( $refs, 0, self::MAX_REFS ),
			);
		}
		return array(
			'rev'      => $rev,
			'complete' => $complete,
			'items'    => $items,
		);
	}

	/**
	 * One `UsageRef` (server-api.md §7.9). Posts the user can't read are
	 * shown as "Private post" without links.
	 *
	 * @param list<string> $contexts
	 * @return array<string, mixed>|null
	 */
	private static function ref( string $key, array $contexts ): ?array {
		$contexts = self::ordered_contexts( $contexts );
		if ( str_starts_with( $key, 's:' ) ) {
			return self::site_ref( substr( $key, 2 ) );
		}
		$post = get_post( (int) $key );
		if ( ! $post instanceof \WP_Post ) {
			return null;
		}
		$type     = get_post_type_object( $post->post_type );
		$label    = $type ? (string) $type->labels->singular_name : $post->post_type;
		$readable = current_user_can( 'read_post', $post->ID );
		$title    = Api::plain_text( $post->post_title );
		return array(
			'postId'        => $post->ID,
			'postType'      => $post->post_type,
			'postTypeLabel' => $label,
			'title'         => $readable ? $title : 'Private post',
			'status'        => $post->post_status,
			'editUrl'       => $readable && current_user_can( 'edit_post', $post->ID ) ? ( get_edit_post_link( $post->ID, 'raw' ) ?: null ) : null,
			'viewUrl'       => $readable && is_post_publicly_viewable( $post ) ? ( get_permalink( $post ) ?: null ) : null,
			'contexts'      => $contexts,
		);
	}

	/**
	 * A site-level use: the logo or the icon (§5.10), or Visual Portfolio's
	 * "no image" placeholder (D44), which links to Visual Portfolio's settings.
	 *
	 * @return array<string, mixed>
	 */
	private static function site_ref( string $context ): array {
		if ( 'visual-portfolio' === $context ) {
			return array(
				'postId'        => null,
				'postType'      => 'site',
				'postTypeLabel' => 'Site',
				'title'         => 'Visual Portfolio placeholder image',
				'status'        => 'publish',
				'editUrl'       => current_user_can( 'manage_options' ) ? admin_url( 'edit.php?post_type=portfolio&page=visual-portfolio-settings' ) : null,
				'viewUrl'       => null,
				'contexts'      => array( $context ),
			);
		}
		$edit_url = null;
		if ( current_user_can( 'edit_theme_options' ) ) {
			$edit_url = function_exists( 'wp_is_block_theme' ) && wp_is_block_theme()
				? admin_url( 'site-editor.php' )
				: admin_url( 'customize.php?autofocus[section]=title_tagline' );
		}
		return array(
			'postId'        => null,
			'postType'      => 'site',
			'postTypeLabel' => 'Site',
			'title'         => 'site-icon' === $context ? 'Site icon' : 'Site logo',
			'status'        => 'publish',
			'editUrl'       => $edit_url,
			'viewUrl'       => home_url( '/' ),
			'contexts'      => array( $context ),
		);
	}

	/**
	 * Contexts in the order of `USAGE_CONTEXTS`, without duplicates.
	 *
	 * @param list<string> $contexts
	 * @return list<string>
	 */
	private static function ordered_contexts( array $contexts ): array {
		$order = array( 'featured', 'image-block', 'gallery-block', 'file-block', 'cover-block', 'media-text', 'video-block', 'audio-block', 'content', 'shortcode-gallery', 'visual-portfolio', 'site-logo', 'site-icon' );
		return array_values( array_intersect( $order, array_unique( $contexts ) ) );
	}

	/**
	 * Site-level refs first, then refs with `featured`, then by title (§5.10).
	 *
	 * @param array<string, mixed> $a
	 * @param array<string, mixed> $b
	 */
	private static function compare_refs( array $a, array $b ): int {
		$rank = static fn ( array $ref ): int => null === $ref['postId'] ? 0 : ( in_array( 'featured', $ref['contexts'], true ) ? 1 : 2 );
		return array( $rank( $a ), strtolower( $a['title'] ), (int) $a['postId'] ) <=> array( $rank( $b ), strtolower( $b['title'] ), (int) $b['postId'] );
	}
}
