<?php
/**
 * `POST /media/{id}/edit`, `/edit/undo`, `/restore`, `/regenerate` and
 * `/replace` (docs/media-manager/contracts/plugin-api.md §5.11–5.15). The
 * work itself is in Images\Engine.
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\Field\WpuField;
use WpUpload\Companion\Images\EditStateProvider;
use WpUpload\Companion\Images\Engine;
use WpUpload\Companion\Images\Lock;
use WpUpload\Companion\Mutation\Api;
use WpUpload\Companion\Mutation\Rev;
use WpUpload\Companion\Plugin;

final class ImagesController {

	public const MAX_OPS = 20;

	private const ISO_PATTERN = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/';

	public static function register(): void {
		Plugin::provide_feature( 'image-edit' );
		Plugin::provide_feature( 'image-regenerate' );
		Plugin::provide_feature( 'image-replace' );
		WpuField::add_provider( new EditStateProvider() );
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
		add_action( 'delete_attachment', array( Engine::class, 'on_delete_attachment' ) );
	}

	public static function register_routes(): void {
		$routes = array(
			'/media/(?P<id>\d+)/edit'       => 'edit',
			'/media/(?P<id>\d+)/edit/undo'  => 'undo',
			'/media/(?P<id>\d+)/restore'    => 'restore',
			'/media/(?P<id>\d+)/regenerate' => 'regenerate',
			'/media/(?P<id>\d+)/replace'    => 'replace',
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
	// Routes
	// -------------------------------------------------------------------------

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function edit( \WP_REST_Request $request ) {
		$id      = (int) $request['id'];
		$checked = self::check_item( $id );
		if ( is_wp_error( $checked ) ) {
			return $checked;
		}
		$body = Api::json_body( $request, array( 'ops', 'scale', 'applyTo', 'expectedModified' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$recipe = self::parse_recipe( $body );
		if ( is_wp_error( $recipe ) ) {
			return $recipe;
		}
		$type = self::check_editable( $id );
		if ( is_wp_error( $type ) ) {
			return $type;
		}
		return self::locked_operation(
			$id,
			$recipe['expectedModified'],
			static fn () => Engine::edit( $id, $recipe['ops'], $recipe['scale'], $recipe['applyTo'] )
		);
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function undo( \WP_REST_Request $request ) {
		return self::expected_modified_operation( $request, array( Engine::class, 'undo' ) );
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function restore( \WP_REST_Request $request ) {
		return self::expected_modified_operation( $request, array( Engine::class, 'restore' ) );
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function regenerate( \WP_REST_Request $request ) {
		$id      = (int) $request['id'];
		$checked = self::check_item( $id );
		if ( is_wp_error( $checked ) ) {
			return $checked;
		}
		$body = Api::json_body( $request, array() );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$mime = (string) get_post_mime_type( $id );
		if ( 'application/pdf' === $mime && ! wp_image_editor_supports( array( 'mime_type' => $mime ) ) ) {
			// The previews are rebuilt only when the site can render PDFs (Imagick with Ghostscript).
			return Api::error( 'wpu_unsupported_type', 'This site can’t render PDF previews.', 415, array( 'mime' => $mime ) );
		}
		if ( 'application/pdf' !== $mime ) {
			$type = self::check_editable( $id );
			if ( is_wp_error( $type ) ) {
				return $type;
			}
		}
		return self::locked_operation( $id, null, static fn () => Engine::regenerate( $id ) );
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function replace( \WP_REST_Request $request ) {
		$id      = (int) $request['id'];
		$checked = self::check_item( $id );
		if ( is_wp_error( $checked ) ) {
			return $checked;
		}
		$files = $request->get_file_params();
		$file  = $files['file'] ?? null;
		if ( ! is_array( $file ) || ! isset( $file['tmp_name'], $file['name'] ) || UPLOAD_ERR_NO_FILE === (int) ( $file['error'] ?? 0 ) ) {
			return Api::invalid( 'file', 'Send the new file as the multipart field "file".' );
		}
		$unknown = Api::unknown_key( (array) $request->get_body_params(), array( 'expectedModified' ) );
		if ( null !== $unknown ) {
			return Api::invalid( $unknown, sprintf( 'Unknown field "%s".', $unknown ) );
		}
		$expected = self::expected_modified( $request->get_param( 'expectedModified' ) );
		if ( is_wp_error( $expected ) ) {
			return $expected;
		}
		return self::locked_operation(
			$id,
			$expected,
			static function () use ( $id, $file ) {
				$upload = self::accept_upload( $id, $file );
				return is_wp_error( $upload ) ? $upload : Engine::replace( $id, $upload );
			}
		);
	}

	// -------------------------------------------------------------------------
	// Checks
	// -------------------------------------------------------------------------

	/**
	 * 404 wpu_not_found, then 403 wpu_forbidden (no `edit_post`).
	 *
	 * @return true|\WP_Error
	 */
	private static function check_item( int $id ) {
		if ( null === Api::attachment( $id ) ) {
			return Api::error( 'wpu_not_found', Api::not_found_message( $id ), 404 );
		}
		if ( ! current_user_can( 'edit_post', $id ) ) {
			return Api::error( 'wpu_forbidden', 'You are not allowed to edit this media item.', 403 );
		}
		return true;
	}

	/**
	 * 415 wpu_unsupported_type: not a type WordPress's image editor handles.
	 *
	 * @return true|\WP_Error
	 */
	private static function check_editable( int $id ) {
		$mime = (string) get_post_mime_type( $id );
		if ( ! Engine::supports( $mime ) ) {
			return Api::error( 'wpu_unsupported_type', sprintf( 'Images of type %s can’t be edited on this site.', $mime ), 415, array( 'mime' => $mime ) );
		}
		return true;
	}

	/**
	 * `{ expectedModified }` routes: undo and restore.
	 *
	 * @param callable(int): (array{sizes: int, urlChanged: bool}|\WP_Error) $operation
	 * @return array<string, mixed>|\WP_Error
	 */
	private static function expected_modified_operation( \WP_REST_Request $request, callable $operation ) {
		$id      = (int) $request['id'];
		$checked = self::check_item( $id );
		if ( is_wp_error( $checked ) ) {
			return $checked;
		}
		$body = Api::json_body( $request, array( 'expectedModified' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		$expected = self::expected_modified( $body['expectedModified'] ?? null );
		if ( is_wp_error( $expected ) ) {
			return $expected;
		}
		return self::locked_operation( $id, $expected, static fn () => $operation( $id ) );
	}

	/**
	 * Runs one image operation: 409 wpu_stale when `expectedModified` is
	 * out of date, 409 wpu_locked while another one runs, then the operation
	 * under the item's lock.
	 *
	 * @param callable(): (array{sizes: int, urlChanged: bool}|\WP_Error) $operation
	 * @return array<string, mixed>|\WP_Error
	 */
	private static function locked_operation( int $id, ?string $expected, callable $operation ) {
		$stale = self::check_fresh( $id, $expected );
		if ( is_wp_error( $stale ) ) {
			return $stale;
		}
		if ( ! Lock::acquire( $id ) ) {
			return Api::error( 'wpu_locked', 'Another image operation on this item is still running.', 409 );
		}
		try {
			// Checked again under the lock: an operation may have finished in between.
			$stale  = self::check_fresh( $id, $expected );
			$result = is_wp_error( $stale ) ? $stale : $operation();
		} finally {
			Lock::release( $id );
		}
		if ( is_wp_error( $result ) ) {
			return $result;
		}
		$rev = Rev::bump();
		clean_post_cache( $id );
		$post = get_post( $id );
		if ( ! $post instanceof \WP_Post ) {
			return Api::error( 'wpu_not_found', 'The item no longer exists.', 404 );
		}
		$meta  = wp_get_attachment_metadata( $id );
		$state = Engine::state( $id );
		return array(
			'rev'              => $rev,
			'id'               => $id,
			'modifiedAt'       => Api::iso_from_gmt( $post->post_modified_gmt ),
			'width'            => (int) ( is_array( $meta ) ? ( $meta['width'] ?? 0 ) : 0 ),
			'height'           => (int) ( is_array( $meta ) ? ( $meta['height'] ?? 0 ) : 0 ),
			'mime'             => (string) $post->post_mime_type,
			'sizesRegenerated' => $result['sizes'],
			'urlChanged'       => $result['urlChanged'],
			'edited'           => $state['edited'],
			'undoable'         => $state['undoable'],
			'restorable'       => $state['restorable'],
		);
	}

	/**
	 * 409 wpu_stale when `expectedModified` isn't the item's `modifiedAt`.
	 *
	 * @return true|\WP_Error
	 */
	private static function check_fresh( int $id, ?string $expected ) {
		if ( null === $expected ) {
			return true;
		}
		clean_post_cache( $id );
		$post = get_post( $id );
		if ( ! $post instanceof \WP_Post ) {
			return Api::error( 'wpu_not_found', 'The item no longer exists.', 404 );
		}
		$current = Api::iso_from_gmt( $post->post_modified_gmt );
		if ( $current !== $expected ) {
			return Api::error( 'wpu_stale', 'The item changed since you started; reload it and try again.', 409, array( 'modifiedAt' => $current ) );
		}
		return true;
	}

	/**
	 * @return string|\WP_Error
	 */
	private static function expected_modified( mixed $value ) {
		if ( ! is_string( $value ) || ! preg_match( self::ISO_PATTERN, $value ) ) {
			return Api::invalid( 'expectedModified', '"expectedModified" must be the item\'s modifiedAt (YYYY-MM-DDTHH:MM:SSZ).' );
		}
		return $value;
	}

	/**
	 * The `EditRequest` body, with every field checked for shape (§5.11).
	 * Bounds against the image are checked later, under the lock.
	 *
	 * @param array<string, mixed> $body
	 * @return array{ops: list<array<string, mixed>>, scale: array{width: int, height: int}|null, applyTo: string, expectedModified: string}|\WP_Error
	 */
	private static function parse_recipe( array $body ) {
		$ops = $body['ops'] ?? null;
		if ( ! is_array( $ops ) || ( array() !== $ops && ! array_is_list( $ops ) ) ) {
			return Api::invalid( 'ops', '"ops" must be a list.' );
		}
		if ( count( $ops ) > self::MAX_OPS ) {
			return Api::error(
				'wpu_too_many_items',
				sprintf( 'At most %d operations per edit.', self::MAX_OPS ),
				400,
				array(
					'param' => 'ops',
					'max'   => self::MAX_OPS,
				)
			);
		}
		$parsed = array();
		foreach ( $ops as $index => $op ) {
			$one = self::parse_op( $op, "ops[{$index}]" );
			if ( is_wp_error( $one ) ) {
				return $one;
			}
			$parsed[] = $one;
		}

		$scale = null;
		if ( array_key_exists( 'scale', $body ) && null !== $body['scale'] ) {
			if ( ! Api::is_object( $body['scale'] ) || null !== Api::unknown_key( $body['scale'], array( 'width', 'height' ) ) ) {
				return Api::invalid( 'scale', '"scale" must be {width, height}.' );
			}
			$width  = Api::positive_int( $body['scale']['width'] ?? null );
			$height = Api::positive_int( $body['scale']['height'] ?? null );
			if ( null === $width || null === $height ) {
				return Api::invalid( 'scale', 'The scale needs positive integer width and height.' );
			}
			$scale = array(
				'width'  => $width,
				'height' => $height,
			);
		}

		$apply_to = $body['applyTo'] ?? null;
		if ( ! in_array( $apply_to, array( 'all', 'thumbnail', 'nothumb' ), true ) ) {
			return Api::invalid( 'applyTo', '"applyTo" must be all, thumbnail or nothumb.' );
		}
		$expected = self::expected_modified( $body['expectedModified'] ?? null );
		if ( is_wp_error( $expected ) ) {
			return $expected;
		}
		return array(
			'ops'              => $parsed,
			'scale'            => $scale,
			'applyTo'          => $apply_to,
			'expectedModified' => $expected,
		);
	}

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	private static function parse_op( mixed $op, string $param ) {
		if ( ! Api::is_object( $op ) ) {
			return Api::invalid( $param, 'Each operation must be an object.' );
		}
		$name   = $op['op'] ?? null;
		$fields = array(
			'rotate' => array( 'op', 'angle' ),
			'flipH'  => array( 'op' ),
			'flipV'  => array( 'op' ),
			'crop'   => array( 'op', 'x', 'y', 'width', 'height' ),
		);
		if ( ! is_string( $name ) || ! isset( $fields[ $name ] ) ) {
			return Api::invalid( "{$param}.op", '"op" must be rotate, flipH, flipV or crop.' );
		}
		$unknown = Api::unknown_key( $op, $fields[ $name ] );
		if ( null !== $unknown ) {
			return Api::invalid( "{$param}.{$unknown}", sprintf( 'Unknown field "%s".', $unknown ) );
		}
		if ( 'rotate' === $name ) {
			if ( ! in_array( $op['angle'] ?? null, array( 90, 180, 270 ), true ) ) {
				return Api::invalid( "{$param}.angle", '"angle" must be 90, 180 or 270.' );
			}
			return array(
				'op'    => 'rotate',
				'angle' => $op['angle'],
			);
		}
		if ( 'crop' === $name ) {
			$crop = array( 'op' => 'crop' );
			foreach ( array( 'x', 'y', 'width', 'height' ) as $key ) {
				$value = $op[ $key ] ?? null;
				// JSON integers only, as every number the API reads (plugin-api.md §1.2).
				if ( ! is_int( $value ) ) {
					return Api::invalid( "{$param}.{$key}", sprintf( '"%s" must be an integer number of pixels.', $key ) );
				}
				$crop[ $key ] = $value;
			}
			return $crop;
		}
		return array( 'op' => $name );
	}

	/**
	 * Checks the replacement and moves it into the uploads folder with
	 * wp_handle_sideload() (§5.15, §11): 413 wpu_file_too_large, 415
	 * wpu_unsupported_type, 415 wpu_mime_mismatch. Returns its path.
	 *
	 * @param array<string, mixed> $file
	 * @return string|\WP_Error
	 */
	private static function accept_upload( int $id, array $file ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		$error    = (int) ( $file['error'] ?? 0 );
		$max      = (int) wp_max_upload_size();
		$too_big  = in_array( $error, array( UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE ), true ) || (int) ( $file['size'] ?? 0 ) > $max;
		$expected = (string) get_post_mime_type( $id );
		if ( $too_big ) {
			return Api::error( 'wpu_file_too_large', 'The new file is larger than this site allows.', 413, array( 'maxBytes' => $max ) );
		}
		if ( UPLOAD_ERR_OK !== $error ) {
			return Api::invalid( 'file', 'The upload failed (PHP upload error ' . $error . ').' );
		}
		$mimes = get_allowed_mime_types();
		$check = wp_check_filetype_and_ext( (string) $file['tmp_name'], (string) $file['name'], $mimes );
		if ( empty( $check['type'] ) ) {
			return Api::error( 'wpu_unsupported_type', 'This type of file isn’t allowed for your account.', 415, array( 'mime' => '' ) );
		}
		if ( $check['type'] !== $expected ) {
			return Api::error(
				'wpu_mime_mismatch',
				sprintf( 'The new file is %s; this item needs %s.', $check['type'], $expected ),
				415,
				array(
					'mime'     => $check['type'],
					'expected' => $expected,
				)
			);
		}
		$moved = wp_handle_sideload(
			$file,
			array(
				'test_form' => false,
				'mimes'     => $mimes,
			)
		);
		if ( ! empty( $moved['error'] ) || empty( $moved['file'] ) ) {
			return Api::error( 'wpu_io_error', 'Could not store the new file.', 500 );
		}
		return (string) $moved['file'];
	}
}
