<?php
/**
 * `POST /media/batch`, `POST /media/trash` and `POST /media/delete`
 * (docs/media-manager/contracts/plugin-api.md §5.4–5.6).
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\Mutation\Api;
use WpUpload\Companion\Mutation\Budget;
use WpUpload\Companion\Mutation\Rev;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Support\Params;

final class MediaController {

	public const MAX_ITEMS = 100;

	/** Length limits of `set` (characters), §5.4. */
	private const LIMITS = array(
		'title'       => 1000,
		'alt'         => 1000,
		'caption'     => 5000,
		'description' => 65535,
	);

	/** Post types that can never own media (§5.4 `wpu_invalid_parent`). */
	private const UNATTACHABLE_TYPES = array(
		'attachment',
		'revision',
		'nav_menu_item',
		'custom_css',
		'customize_changeset',
		'oembed_cache',
		'user_request',
		'wp_block',
		'wp_template',
		'wp_template_part',
		'wp_global_styles',
		'wp_navigation',
		'wp_font_family',
		'wp_font_face',
	);

	public static function register(): void {
		Plugin::provide_feature( 'media-batch' );
		Plugin::provide_feature( 'trash' );
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		$routes = array(
			'/media/batch'  => 'batch',
			'/media/trash'  => 'trash',
			'/media/delete' => 'delete',
		);
		foreach ( $routes as $route => $method ) {
			register_rest_route(
				Plugin::REST_NAMESPACE,
				$route,
				array(
					'methods'             => 'POST',
					'callback'            => Api::guarded( array( self::class, $method ) ),
					'permission_callback' => array( Api::class, 'can_upload' ),
				)
			);
		}
	}

	// -------------------------------------------------------------------------
	// POST /media/batch
	// -------------------------------------------------------------------------

	/**
	 * Metadata for up to 100 items, attach and detach (§5.4).
	 *
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function batch( \WP_REST_Request $request ) {
		$body = Api::json_body( $request, array( 'items' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$items = self::validate_batch_items( $body['items'] ?? null );
		if ( is_wp_error( $items ) ) {
			return $items;
		}

		$budget    = Budget::for_batch();
		$results   = array();
		$remaining = array();
		$changed   = false;
		foreach ( $items as $item ) {
			if ( $budget->spent() ) {
				$remaining[] = $item['id'];
				continue;
			}
			$result    = self::apply_change( $item );
			$changed   = $changed || ( $result['changed'] ?? false );
			unset( $result['changed'] );
			$results[] = $result;
		}

		return array(
			'rev'       => $changed ? Rev::bump() : Rev::current(),
			'results'   => $results,
			'remaining' => $remaining,
		);
	}

	/**
	 * Checks the whole body before any item runs (§11: validate first).
	 *
	 * @return list<array{id: int, set: array<string, mixed>, appendDescription: ?string}>|\WP_Error
	 */
	private static function validate_batch_items( mixed $items ) {
		if ( ! is_array( $items ) || ! array_is_list( $items ) || array() === $items ) {
			return Api::invalid( 'items', '"items" must be a non-empty list.' );
		}
		if ( count( $items ) > self::MAX_ITEMS ) {
			return Api::error(
				'wpu_too_many_items',
				sprintf( 'At most %d items per request.', self::MAX_ITEMS ),
				400,
				array(
					'param' => 'items',
					'max'   => self::MAX_ITEMS,
				)
			);
		}
		$valid = array();
		foreach ( $items as $index => $item ) {
			$checked = self::validate_batch_item( $item, "items[{$index}]" );
			if ( is_wp_error( $checked ) ) {
				return $checked;
			}
			$valid[] = $checked;
		}
		return $valid;
	}

	/**
	 * @return array{id: int, set: array<string, mixed>, appendDescription: ?string}|\WP_Error
	 */
	private static function validate_batch_item( mixed $item, string $param ) {
		if ( ! Api::is_object( $item ) ) {
			return Api::invalid( $param, 'Each item must be an object.' );
		}
		$unknown = Api::unknown_key( $item, array( 'id', 'set', 'appendDescription' ) );
		if ( null !== $unknown ) {
			return Api::invalid( "{$param}.{$unknown}", sprintf( 'Unknown field "%s".', $unknown ) );
		}
		$id = Api::positive_int( $item['id'] ?? null );
		if ( null === $id ) {
			return Api::invalid( "{$param}.id", 'The id must be a positive integer.' );
		}
		$set = $item['set'] ?? null;
		if ( ! Api::is_object( $set ) ) {
			return Api::invalid( "{$param}.set", '"set" must be an object.' );
		}
		$unknown = Api::unknown_key( $set, array( 'title', 'alt', 'caption', 'description', 'post' ) );
		if ( null !== $unknown ) {
			return Api::invalid( "{$param}.set.{$unknown}", sprintf( 'Unknown field "%s".', $unknown ) );
		}
		foreach ( self::LIMITS as $key => $max ) {
			if ( ! array_key_exists( $key, $set ) ) {
				continue;
			}
			if ( ! is_string( $set[ $key ] ) ) {
				return Api::invalid( "{$param}.set.{$key}", sprintf( '"%s" must be a string.', $key ) );
			}
			if ( mb_strlen( $set[ $key ], 'UTF-8' ) > $max ) {
				return Api::invalid( "{$param}.set.{$key}", sprintf( '"%s" is longer than %d characters.', $key, $max ) );
			}
		}
		if ( array_key_exists( 'post', $set ) && null !== $set['post'] ) {
			$post = Api::positive_int( $set['post'] );
			if ( null === $post ) {
				return Api::invalid( "{$param}.set.post", '"post" must be a post id (1 or more) or null.' );
			}
			$set['post'] = $post;
		}

		$append = null;
		if ( array_key_exists( 'appendDescription', $item ) ) {
			$append = $item['appendDescription'];
			if ( ! is_string( $append ) || '' === $append ) {
				return Api::invalid( "{$param}.appendDescription", '"appendDescription" must be a non-empty string.' );
			}
			if ( mb_strlen( $append, 'UTF-8' ) > self::LIMITS['description'] ) {
				return Api::invalid( "{$param}.appendDescription", sprintf( '"appendDescription" is longer than %d characters.', self::LIMITS['description'] ) );
			}
			if ( array_key_exists( 'description', $set ) ) {
				return Api::invalid( "{$param}.appendDescription", 'Send either set.description or appendDescription, not both.' );
			}
		}
		if ( array() === $set && null === $append ) {
			return Api::invalid( "{$param}.set", 'Nothing to change: "set" is empty.' );
		}
		return array(
			'id'                => $id,
			'set'               => $set,
			'appendDescription' => $append,
		);
	}

	/**
	 * Applies one item's change (§5.4 "Per item").
	 *
	 * @param array{id: int, set: array<string, mixed>, appendDescription: ?string} $item
	 * @return array<string, mixed>
	 */
	private static function apply_change( array $item ): array {
		$id         = $item['id'];
		$set        = $item['set'];
		$attachment = Api::attachment( $id );
		if ( null === $attachment ) {
			return Api::item_error( $id, 'wpu_not_found', Api::not_found_message( $id ) );
		}
		if ( ! current_user_can( 'edit_post', $id ) ) {
			return Api::item_error( $id, 'wpu_forbidden', 'You are not allowed to edit this media item.' );
		}
		if ( array_key_exists( 'post', $set ) && null !== $set['post'] ) {
			$parent_error = self::check_parent( (int) $set['post'] );
			if ( null !== $parent_error ) {
				return Api::item_error( $id, $parent_error[0], $parent_error[1] );
			}
		}

		$before   = self::snapshot( $attachment );
		$previous = array();
		foreach ( array_keys( $set ) as $key ) {
			$previous[ $key ] = $before[ $key ];
		}
		if ( null !== $item['appendDescription'] ) {
			$previous['description'] = $before['description'];
			$set['description']      = self::appended( $before['description'], $item['appendDescription'] );
		}

		$post_fields = self::post_fields_to_write( $set, $attachment );
		if ( array() !== $post_fields ) {
			$post_fields['ID'] = $id;
			$updated           = wp_update_post( wp_slash( $post_fields ), true );
			if ( is_wp_error( $updated ) ) {
				return Api::item_error( $id, 'wpu_internal', $updated->get_error_message() );
			}
		}
		if ( array_key_exists( 'alt', $set ) && $set['alt'] !== $before['alt'] ) {
			update_post_meta( $id, '_wp_attachment_image_alt', wp_slash( sanitize_text_field( $set['alt'] ) ) );
		}

		clean_post_cache( $id );
		$stored = get_post( $id );
		if ( ! $stored instanceof \WP_Post ) {
			return Api::item_error( $id, 'wpu_not_found', 'The item no longer exists.' );
		}
		$after = self::snapshot( $stored );
		return array(
			'id'       => $id,
			'ok'       => true,
			'previous' => (object) $previous,
			'item'     => $after,
			'changed'  => $after !== $before,
		);
	}

	/**
	 * The wp_posts fields that differ from what is stored. When nothing
	 * differs, wp_update_post() is skipped so `post_modified` stays put.
	 *
	 * @param array<string, mixed> $set
	 * @return array<string, mixed>
	 */
	private static function post_fields_to_write( array $set, \WP_Post $attachment ): array {
		$columns = array(
			'title'       => 'post_title',
			'caption'     => 'post_excerpt',
			'description' => 'post_content',
		);
		$fields  = array();
		foreach ( $columns as $key => $column ) {
			if ( array_key_exists( $key, $set ) && $set[ $key ] !== $attachment->$column ) {
				$fields[ $column ] = $set[ $key ];
			}
		}
		if ( array_key_exists( 'post', $set ) ) {
			$parent = null === $set['post'] ? 0 : (int) $set['post'];
			if ( $parent !== (int) $attachment->post_parent ) {
				$fields['post_parent'] = $parent;
			}
		}
		return $fields;
	}

	/**
	 * §5.4 step 4: trailing whitespace removed, a blank line, then the text.
	 */
	private static function appended( string $old, string $text ): string {
		$trimmed = rtrim( $old );
		return '' === $trimmed ? $text : $trimmed . "\n\n" . $text;
	}

	/**
	 * Why `set.post` can't own this attachment, or null when it can.
	 *
	 * @return array{0: string, 1: string}|null
	 */
	private static function check_parent( int $post_id ): ?array {
		$parent = get_post( $post_id );
		if ( ! $parent instanceof \WP_Post || 'auto-draft' === $parent->post_status ) {
			return array( 'wpu_post_not_found', sprintf( 'Post %d does not exist.', $post_id ) );
		}
		$type = get_post_type_object( $parent->post_type );
		if ( null === $type || in_array( $parent->post_type, self::UNATTACHABLE_TYPES, true ) || ! $type->show_ui ) {
			return array( 'wpu_invalid_parent', sprintf( 'Media can’t be attached to post %d (%s).', $post_id, $parent->post_type ) );
		}
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return array( 'wpu_forbidden', sprintf( 'You are not allowed to edit post %d.', $post_id ) );
		}
		return null;
	}

	/**
	 * `ItemMetaSnapshot`: the values as stored (§5.4).
	 *
	 * @return array{title: string, alt: string, caption: string, description: string, post: int|null, modifiedAt: string|null}
	 */
	private static function snapshot( \WP_Post $post ): array {
		$parent = (int) $post->post_parent;
		return array(
			'title'       => Api::plain_text( $post->post_title ),
			'alt'         => (string) get_post_meta( $post->ID, '_wp_attachment_image_alt', true ),
			'caption'     => $post->post_excerpt,
			'description' => $post->post_content,
			'post'        => $parent > 0 ? $parent : null,
			'modifiedAt'  => Api::iso_from_gmt( $post->post_modified_gmt ),
		);
	}

	// -------------------------------------------------------------------------
	// POST /media/trash and /media/delete
	// -------------------------------------------------------------------------

	/**
	 * Moves items to the Trash (§5.5).
	 *
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function trash( \WP_REST_Request $request ) {
		$ids = self::ids_from( $request );
		if ( is_wp_error( $ids ) ) {
			return $ids;
		}
		if ( ! TrashController::enabled() ) {
			return Api::error( 'wpu_trash_disabled', 'The media Trash is disabled on this site (MEDIA_TRASH).', 409 );
		}
		return self::each(
			$ids,
			static function ( int $id ): array {
				$attachment = Api::attachment( $id );
				if ( null === $attachment ) {
					return Api::item_error( $id, 'wpu_not_found', Api::not_found_message( $id ) );
				}
				if ( ! current_user_can( 'delete_post', $id ) ) {
					return Api::item_error( $id, 'wpu_forbidden', 'You are not allowed to delete this media item.' );
				}
				$changed = false;
				if ( 'trash' !== $attachment->post_status ) {
					if ( ! wp_trash_post( $id ) ) {
						return Api::item_error( $id, 'wpu_io_error', 'WordPress could not move the item to the Trash.' );
					}
					$changed = true;
				}
				return array(
					'id'      => $id,
					'ok'      => true,
					'trash'   => TrashController::trash_state( $id ),
					'changed' => $changed,
				);
			}
		);
	}

	/**
	 * Deletes items permanently, trashed or not (§5.6).
	 *
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function delete( \WP_REST_Request $request ) {
		$ids = self::ids_from( $request );
		if ( is_wp_error( $ids ) ) {
			return $ids;
		}
		return self::each(
			$ids,
			static function ( int $id ): array {
				if ( null === Api::attachment( $id ) ) {
					return Api::item_error( $id, 'wpu_not_found', Api::not_found_message( $id ) );
				}
				if ( ! current_user_can( 'delete_post', $id ) ) {
					return Api::item_error( $id, 'wpu_forbidden', 'You are not allowed to delete this media item.' );
				}
				if ( ! wp_delete_attachment( $id, true ) ) {
					return Api::item_error( $id, 'wpu_io_error', 'WordPress could not delete the item.' );
				}
				return array(
					'id'      => $id,
					'ok'      => true,
					'trash'   => null,
					'changed' => true,
				);
			}
		);
	}

	/**
	 * The `{ ids }` body shared by the trash, delete and restore routes.
	 *
	 * @return list<int>|\WP_Error
	 */
	public static function ids_from( \WP_REST_Request $request ) {
		$body = Api::json_body( $request, array( 'ids' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		return Params::ids( $body['ids'] ?? null, 'ids', self::MAX_ITEMS );
	}

	/**
	 * Runs one callback per id within the batch budget (§1.6) and builds the
	 * `PluginBatchEnvelope`. A result's `changed` flag decides the rev bump.
	 *
	 * @param list<int>                      $ids
	 * @param callable(int): array<string, mixed> $callback
	 * @return array<string, mixed>
	 */
	public static function each( array $ids, callable $callback ): array {
		$budget    = Budget::for_batch();
		$results   = array();
		$remaining = array();
		$changed   = false;
		foreach ( $ids as $id ) {
			if ( $budget->spent() ) {
				$remaining[] = $id;
				continue;
			}
			$result  = $callback( $id );
			$changed = $changed || ( $result['changed'] ?? false );
			unset( $result['changed'] );
			$results[] = $result;
		}
		return array(
			'rev'       => $changed ? Rev::bump() : Rev::current(),
			'results'   => $results,
			'remaining' => $remaining,
		);
	}
}
