<?php
/**
 * The `wpu` keys track P1 owns (plugin-api.md §7.1): kind, size and duration
 * from the media index, the FileBird folder, permissions, trash time, poster,
 * original file, raw text and author.
 *
 * Width and height are exactly the collection row's numbers: an item without
 * an index row reports 0 × 0 and a kind derived from its MIME type, as
 * /collection does.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Field;

use WpUpload\Companion\FileBird\Adapter;
use WpUpload\Companion\Index\MediaIndex;
use WpUpload\Companion\Index\MediaKinds;
use WpUpload\Companion\Support\Format;

final class CoreProvider implements Provider {

	/** @var array<int, array<string, string|null>> */
	private $rows = array();

	/** @var array<int, int>|null attachment id => folder; null without active FileBird */
	private $folders = array();

	public function keys(): array {
		return array(
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
		);
	}

	public function prime( array $ids ): void {
		_prime_post_caches( $ids, false, true );
		$this->rows = MediaIndex::rows( $ids ) + $this->rows;

		if ( Adapter::is_active() ) {
			$this->folders = Adapter::folders_of( $ids, Adapter::owner() ) + (array) $this->folders;
		} else {
			$this->folders = null;
		}

		$authors = array();
		$posters = array();
		foreach ( $ids as $id ) {
			$post = get_post( $id );
			if ( ! $post instanceof \WP_Post ) {
				continue;
			}
			$authors[] = (int) $post->post_author;
			$kind      = MediaKinds::from_mime( (string) $post->post_mime_type );
			if ( MediaKinds::VIDEO === $kind || MediaKinds::AUDIO === $kind ) {
				$thumbnail = (int) get_post_meta( $id, '_thumbnail_id', true );
				if ( $thumbnail > 0 ) {
					$posters[] = $thumbnail;
				}
			}
		}
		if ( array() !== $authors ) {
			cache_users( array_values( array_unique( $authors ) ) );
		}
		if ( array() !== $posters ) {
			_prime_post_caches( array_values( array_unique( $posters ) ), false, true );
		}
	}

	public function value( int $id ): array {
		$post = get_post( $id );
		if ( ! $post instanceof \WP_Post ) {
			return array();
		}
		$row  = $this->rows[ $id ] ?? null;
		$kind = null === $row ? MediaKinds::from_mime( (string) $post->post_mime_type ) : (int) $row['kind'];

		return array(
			'kind'      => MediaKinds::name( $kind ),
			'width'     => null === $row ? 0 : (int) $row['width'],
			'height'    => null === $row ? 0 : (int) $row['height'],
			'filesize'  => null === $row || null === $row['filesize'] ? null : (int) $row['filesize'],
			'folder'    => null === $this->folders ? null : (int) ( $this->folders[ $id ] ?? 0 ),
			'perms'     => array(
				'edit'   => current_user_can( 'edit_post', $id ),
				'delete' => current_user_can( 'delete_post', $id ),
			),
			'trashedAt' => $this->trashed_at( $post ),
			'duration'  => null === $row || null === $row['duration'] ? null : (int) $row['duration'],
			'pages'     => null === $row || null === $row['pages'] ? null : (int) $row['pages'],
			'poster'    => $this->poster( $post, $kind ),
			'original'  => $this->original( $id ),
			'raw'       => array(
				'title'       => Format::plain_text( (string) $post->post_title ),
				'caption'     => (string) $post->post_excerpt,
				'description' => (string) $post->post_content,
			),
			'author'    => $this->author( (int) $post->post_author ),
		);
	}

	private function trashed_at( \WP_Post $post ): ?string {
		if ( 'trash' !== $post->post_status ) {
			return null;
		}
		$time = get_post_meta( $post->ID, '_wp_trash_meta_time', true );
		return is_numeric( $time ) ? Format::iso_from_unix( (int) $time ) : null;
	}

	/**
	 * The featured image of a video or audio item, `medium_large` (else full).
	 *
	 * @return array{url: string, width: int, height: int}|null
	 */
	private function poster( \WP_Post $post, int $kind ): ?array {
		if ( MediaKinds::VIDEO !== $kind && MediaKinds::AUDIO !== $kind ) {
			return null;
		}
		$thumbnail = (int) get_post_meta( $post->ID, '_thumbnail_id', true );
		if ( $thumbnail <= 0 ) {
			return null;
		}
		$image = wp_get_attachment_image_src( $thumbnail, 'medium_large' );
		if ( ! is_array( $image ) || ! is_string( $image[0] ) || '' === $image[0] ) {
			return null;
		}
		return array(
			'url'    => $image[0],
			'width'  => (int) $image[1],
			'height' => (int) $image[2],
		);
	}

	/**
	 * The original upload when the attached file is a scaled or rotated copy.
	 *
	 * @return array{url: string, width: int, height: int, filename: string}|null
	 */
	private function original( int $id ): ?array {
		$meta = wp_get_attachment_metadata( $id, true );
		if ( ! is_array( $meta ) || empty( $meta['original_image'] ) ) {
			return null;
		}
		$url  = wp_get_original_image_url( $id );
		$path = wp_get_original_image_path( $id );
		if ( ! is_string( $url ) || '' === $url ) {
			return null;
		}
		$width  = 0;
		$height = 0;
		if ( is_string( $path ) && is_readable( $path ) ) {
			$size = wp_getimagesize( $path );
			if ( is_array( $size ) ) {
				$width  = (int) $size[0];
				$height = (int) $size[1];
			}
		}
		return array(
			'url'      => $url,
			'width'    => $width,
			'height'   => $height,
			'filename' => wp_basename( (string) $meta['original_image'] ),
		);
	}

	/**
	 * @return array{id: int, name: string}
	 */
	private function author( int $user_id ): array {
		$user = $user_id > 0 ? get_userdata( $user_id ) : false;
		return array(
			'id'   => $user_id,
			'name' => $user instanceof \WP_User ? (string) $user->display_name : '',
		);
	}
}
