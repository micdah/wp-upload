<?php
/**
 * GET /info (plugin-api.md §3): identifies the plugin and describes the site.
 * Its shape is frozen across every version; fields are only ever added, and
 * the identity (plugin, version, api, features) always comes first.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\FileBird\Adapter;
use WpUpload\Companion\Index\IndexStatus;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Rev;
use WpUpload\Companion\Support\Permissions;
use WpUpload\Companion\Support\Routes;

final class InfoController {

	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		Routes::add( '/info', 'GET', array( self::class, 'info' ), array( Permissions::class, 'info' ) );
	}

	/**
	 * @return array<string, mixed>
	 */
	public static function info(): array {
		$rev   = Rev::current();
		$index = IndexStatus::get( true );
		return array(
			'plugin'      => 'wp-upload-companion',
			'version'     => WPU_VERSION,
			'api'         => WPU_API,
			'features'    => Plugin::features(),
			'install'     => Plugin::install_mode(),
			'wpVersion'   => (string) get_bloginfo( 'version' ),
			'user'        => self::user(),
			'filebird'    => Adapter::info(),
			'trash'       => self::trash(),
			'upload'      => self::upload(),
			'imageSizes'  => self::image_sizes(),
			'imageEditor' => self::image_editor(),
			'index'       => $index,
			'rev'         => $rev,
		);
	}

	/**
	 * @return array<string, mixed>
	 */
	private static function user(): array {
		$user = wp_get_current_user();
		return array(
			'id'    => (int) $user->ID,
			'name'  => (string) $user->display_name,
			'roles' => array_values( array_map( 'strval', (array) $user->roles ) ),
			'caps'  => array(
				'uploadFiles'       => current_user_can( 'upload_files' ),
				'editPosts'         => current_user_can( 'edit_posts' ),
				'editOthersPosts'   => current_user_can( 'edit_others_posts' ),
				'deletePosts'       => current_user_can( 'delete_posts' ),
				'deleteOthersPosts' => current_user_can( 'delete_others_posts' ),
				'manageOptions'     => current_user_can( 'manage_options' ),
			),
		);
	}

	/**
	 * @return array{enabled: bool, days: int}
	 */
	private static function trash(): array {
		$days = defined( 'EMPTY_TRASH_DAYS' ) ? max( 0, (int) EMPTY_TRASH_DAYS ) : 30;
		return array(
			'enabled' => defined( 'MEDIA_TRASH' ) && MEDIA_TRASH && $days > 0,
			'days'    => $days,
		);
	}

	/**
	 * @return array{maxBytes: int, mimes: list<array{extensions: list<string>, mime: string}>}
	 */
	private static function upload(): array {
		$mimes = array();
		foreach ( get_allowed_mime_types( wp_get_current_user() ) as $extensions => $mime ) {
			// Only plain extensions: core's audio/wav pattern also lists `x-wav`,
			// which is no file extension and breaks the `[a-z0-9]+` contract.
			$plain = array_values(
				array_filter(
					explode( '|', strtolower( (string) $extensions ) ),
					static function ( $extension ) {
						return (bool) preg_match( '/^[a-z0-9]+$/', $extension );
					}
				)
			);
			if ( array() !== $plain ) {
				$mimes[] = array(
					'extensions' => $plain,
					'mime'       => (string) $mime,
				);
			}
		}
		return array(
			'maxBytes' => (int) wp_max_upload_size(),
			'mimes'    => $mimes,
		);
	}

	/**
	 * @return list<array{name: string, width: int, height: int, crop: bool}>
	 */
	private static function image_sizes(): array {
		$sizes = array();
		foreach ( wp_get_registered_image_subsizes() as $name => $size ) {
			$sizes[] = array(
				'name'   => (string) $name,
				'width'  => (int) ( $size['width'] ?? 0 ),
				'height' => (int) ( $size['height'] ?? 0 ),
				'crop'   => ! empty( $size['crop'] ),
			);
		}
		return $sizes;
	}

	/**
	 * @return array{mimes: list<string>, bigImageThreshold: int|null}
	 */
	private static function image_editor(): array {
		$candidates = array();
		foreach ( get_allowed_mime_types() as $mime ) {
			if ( 0 === strpos( (string) $mime, 'image/' ) && 'image/svg+xml' !== $mime ) {
				$candidates[ (string) $mime ] = true;
			}
		}
		foreach ( array( 'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/heic' ) as $mime ) {
			$candidates[ $mime ] = true;
		}
		$supported = array();
		foreach ( array_keys( $candidates ) as $mime ) {
			if ( wp_image_editor_supports( array( 'mime_type' => $mime ) ) ) {
				$supported[] = $mime;
			}
		}
		$threshold = apply_filters( 'big_image_size_threshold', 2560, array( 0, 0 ), '', 0 );
		return array(
			'mimes'             => $supported,
			'bigImageThreshold' => ( is_numeric( $threshold ) && (int) $threshold > 0 ) ? (int) $threshold : null,
		);
	}
}
