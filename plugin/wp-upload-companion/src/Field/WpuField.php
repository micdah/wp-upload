<?php
/**
 * The read-only `wpu` REST field on `/wp/v2/media` (plugin-api.md §7),
 * assembled from providers (`Provider`), one per key group.
 *
 * - Every provider is primed once per REST response, with all attachment ids
 *   of that response (collected from `the_posts` during the request), so a
 *   100-item page costs a fixed number of queries.
 * - WordPress skips the field when `_fields` doesn't ask for it.
 * - `null` for users without `upload_files`.
 *
 * Owned by track P1. P2 registers its providers with `add_provider()`.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Field;

use WpUpload\Companion\Index\MediaIndex;

final class WpuField {

	public const NAME = 'wpu';

	/** `WpuField` in shared/plugin-api.ts, in that order. */
	public const KEYS = array(
		'kind',
		'width',
		'height',
		'filesize',
		'folder',
		'perms',
		'trashedAt',
		'duration',
		'pages',
		'poster',
		'original',
		'raw',
		'author',
		'edited',
		'editedAt',
		'undoable',
		'restorable',
		'sizesPending',
		'usageCount',
	);

	/** @var array<string, Provider> key => the provider that fills it */
	private static $providers = array();

	/** @var array<int, true> Attachment ids seen in this request's queries, not primed yet. */
	private static $pending = array();

	/** @var array<int, true> Attachment ids every provider has been primed for. */
	private static $primed = array();

	public static function register(): void {
		self::add_provider( new CoreProvider() );
		self::add_provider( new StubProvider() );
		add_action( 'rest_api_init', array( self::class, 'register_field' ) );
		add_filter( 'the_posts', array( self::class, 'collect_ids' ), 10, 1 );
	}

	/**
	 * Registers (or replaces) the provider of the keys it declares.
	 */
	public static function add_provider( Provider $provider ): void {
		foreach ( $provider->keys() as $key ) {
			if ( in_array( $key, self::KEYS, true ) ) {
				self::$providers[ $key ] = $provider;
			}
		}
		// Ids primed before this provider existed must be primed again.
		self::$primed = array();
	}

	public static function register_field(): void {
		register_rest_field(
			'attachment',
			self::NAME,
			array(
				'get_callback' => array( self::class, 'get_value' ),
				'schema'       => array(
					'description' => 'Media-manager data from the wp-upload companion plugin.',
					'type'        => array( 'object', 'null' ),
					'context'     => array( 'view', 'edit' ),
					'readonly'    => true,
				),
			)
		);
	}

	/**
	 * Remembers the attachment ids of the REST request's queries for priming.
	 *
	 * @param mixed $posts
	 * @return mixed
	 */
	public static function collect_ids( $posts ) {
		if ( ! defined( 'REST_REQUEST' ) || ! REST_REQUEST || ! is_array( $posts ) ) {
			return $posts;
		}
		foreach ( $posts as $post ) {
			if ( $post instanceof \WP_Post && 'attachment' === $post->post_type ) {
				self::$pending[ (int) $post->ID ] = true;
			}
		}
		return $posts;
	}

	/**
	 * @param array<string, mixed> $prepared The item as prepared so far.
	 * @return array<string, mixed>|null
	 */
	public static function get_value( $prepared ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return null;
		}
		$id = isset( $prepared['id'] ) ? (int) $prepared['id'] : 0;
		if ( $id <= 0 ) {
			return null;
		}
		return self::value( $id );
	}

	/**
	 * The field for one attachment (also usable outside REST, e.g. in tests).
	 *
	 * @return array<string, mixed>
	 */
	public static function value( int $id ): array {
		if ( ! isset( self::$primed[ $id ] ) ) {
			self::prime( array_keys( self::$pending + array( $id => true ) ) );
		}
		$values = array();
		$cache  = array();
		foreach ( self::KEYS as $key ) {
			$provider = self::$providers[ $key ] ?? null;
			if ( null === $provider ) {
				$values[ $key ] = null;
				continue;
			}
			$hash = spl_object_hash( $provider );
			if ( ! isset( $cache[ $hash ] ) ) {
				$cache[ $hash ] = $provider->value( $id );
			}
			$values[ $key ] = array_key_exists( $key, $cache[ $hash ] ) ? $cache[ $hash ][ $key ] : null;
		}
		return $values;
	}

	/**
	 * @param list<int> $ids
	 */
	private static function prime( array $ids ): void {
		$ids = array_values( array_diff( array_map( 'intval', $ids ), array_keys( self::$primed ) ) );
		if ( array() === $ids ) {
			return;
		}
		// Rows changed earlier in this request (e.g. an upload) are written first.
		MediaIndex::flush();
		$seen = array();
		foreach ( self::$providers as $provider ) {
			$hash = spl_object_hash( $provider );
			if ( isset( $seen[ $hash ] ) ) {
				continue;
			}
			$seen[ $hash ] = true;
			$provider->prime( $ids );
		}
		foreach ( $ids as $id ) {
			self::$primed[ $id ] = true;
			unset( self::$pending[ $id ] );
		}
	}
}
