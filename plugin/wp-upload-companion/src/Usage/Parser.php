<?php
/**
 * Finds the attachments a post uses, with the context of each use
 * (docs/media-manager/contracts/plugin-api.md §8.2, spikes X7 and X10).
 *
 * Owned by track P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Usage;

final class Parser {

	/** Core blocks whose attachment attribute names a single item, and its context. */
	private const SINGLE_MEDIA_BLOCKS = array(
		'core/image'      => array( 'id', 'image-block' ),
		'core/file'       => array( 'id', 'file-block' ),
		'core/cover'      => array( 'id', 'cover-block' ),
		'core/media-text' => array( 'mediaId', 'media-text' ),
		'core/video'      => array( 'id', 'video-block' ),
		'core/audio'      => array( 'id', 'audio-block' ),
	);

	private bool $visual_portfolio;

	/** @var array<int, list<int>> Images of Visual Portfolio saved layouts, per layout id, for the post being parsed. */
	private array $layout_images = array();

	/** @var array<int, array<string, true>> attachment id => contexts, for the post being parsed. */
	private array $found = array();

	/** @var list<string> Upload-relative paths seen in content, resolved in one query. */
	private array $paths = array();

	private ?string $uploads_path = null;

	/** The post being parsed: a `[gallery]` without ids shows its attached images. */
	private int $post_id = 0;

	public function __construct( bool $visual_portfolio ) {
		$this->visual_portfolio = $visual_portfolio;
	}

	/**
	 * Every attachment the post uses, with its contexts. Only ids of
	 * existing attachments are returned.
	 *
	 * @return array<int, list<string>> attachment id => contexts
	 */
	public function parse_post( \WP_Post $post ): array {
		$this->found   = array();
		$this->paths   = array();
		$this->post_id = $post->ID;
		// Layout images are cached for one post only: a layout's `vp_images` may change
		// later in the same request (e.g. meta written after save_post).
		$this->layout_images = array();

		$thumbnail = (int) get_post_meta( $post->ID, '_thumbnail_id', true );
		if ( $thumbnail > 0 ) {
			$this->add( $thumbnail, 'featured' );
		}

		if ( '' !== $post->post_content ) {
			$this->walk( array_values( parse_blocks( $post->post_content ) ), false );
		}

		if ( $this->visual_portfolio && 'vp_lists' === $post->post_type ) {
			foreach ( $this->layout_images( $post->ID ) as $id ) {
				$this->add( $id, 'visual-portfolio' );
			}
		}

		$this->resolve_paths();
		return $this->existing_only( $this->found );
	}

	/**
	 * The site-level uses (source 0): the site logo, the site icon and, with
	 * Visual Portfolio, its "no image" placeholder attachment (D44).
	 *
	 * @return array<int, list<string>>
	 */
	public function parse_site(): array {
		$this->found   = array();
		$this->post_id = 0;
		$logo        = (int) get_option( 'site_logo' );
		if ( $logo <= 0 ) {
			$logo = (int) get_theme_mod( 'custom_logo' );
		}
		if ( $logo > 0 ) {
			$this->add( $logo, 'site-logo' );
		}
		$icon = (int) get_option( 'site_icon' );
		if ( $icon > 0 ) {
			$this->add( $icon, 'site-icon' );
		}
		if ( $this->visual_portfolio ) {
			// Visual Portfolio shows this attachment wherever an item has no image (D44).
			$general     = get_option( 'vp_general' );
			$placeholder = is_array( $general ) ? self::int_value( $general['no_image'] ?? null ) : null;
			if ( null !== $placeholder ) {
				$this->add( $placeholder, 'visual-portfolio' );
			}
		}
		return $this->existing_only( $this->found );
	}

	/**
	 * Walks parsed blocks. Media blocks are read from their attributes and
	 * their own markup is skipped, so it never counts again as `content`.
	 *
	 * @param array<int, array<string, mixed>> $blocks
	 */
	private function walk( array $blocks, bool $in_gallery ): void {
		foreach ( $blocks as $block ) {
			$name  = (string) ( $block['blockName'] ?? '' );
			$attrs = is_array( $block['attrs'] ?? null ) ? $block['attrs'] : array();
			$inner = is_array( $block['innerBlocks'] ?? null ) ? $block['innerBlocks'] : array();

			if ( 'core/gallery' === $name ) {
				foreach ( self::int_list( $attrs['ids'] ?? array() ) as $id ) {
					$this->add( $id, 'gallery-block' );
				}
				$this->walk( $inner, true );
				continue;
			}

			if ( isset( self::SINGLE_MEDIA_BLOCKS[ $name ] ) ) {
				[ $attribute, $context ] = self::SINGLE_MEDIA_BLOCKS[ $name ];
				if ( $in_gallery && 'core/image' === $name ) {
					$context = 'gallery-block';
				}
				$id = self::int_value( $attrs[ $attribute ] ?? null );
				if ( null !== $id && ! ( 'core/cover' === $name && ! empty( $attrs['useFeaturedImage'] ) ) ) {
					$this->add( $id, $context );
				}
				$this->walk( $inner, false );
				continue;
			}

			if ( $this->visual_portfolio && $this->walk_visual_portfolio( $name, $attrs ) ) {
				$this->walk( $inner, false );
				continue;
			}

			$this->scan_html( (string) ( $block['innerHTML'] ?? '' ) );
			$this->walk( $inner, false );
		}
	}

	/**
	 * Visual Portfolio blocks (D22, X10). Returns true when the block was one
	 * of them, so its markup isn't scanned as content.
	 *
	 * @param array<string, mixed> $attrs
	 */
	private function walk_visual_portfolio( string $name, array $attrs ): bool {
		switch ( $name ) {
			case 'visual-portfolio/block':
				foreach ( self::image_ids( $attrs['images'] ?? array() ) as $id ) {
					$this->add( $id, 'visual-portfolio' );
				}
				return true;
			case 'visual-portfolio/loop':
				$query = is_array( $attrs['imagesQuery'] ?? null ) ? $attrs['imagesQuery'] : array();
				foreach ( self::image_ids( $query['images'] ?? array() ) as $id ) {
					$this->add( $id, 'visual-portfolio' );
				}
				return true;
			case 'visual-portfolio/saved':
			case 'nk/visual-portfolio':
				$layout = self::int_value( $attrs['id'] ?? null );
				if ( null !== $layout ) {
					foreach ( $this->layout_images( $layout ) as $id ) {
						$this->add( $id, 'visual-portfolio' );
					}
				}
				return true;
		}
		return false;
	}

	/**
	 * Markup outside the media blocks: `wp-image-<id>` classes, upload URLs,
	 * `[gallery]` and (with Visual Portfolio) `[visual_portfolio]` shortcodes.
	 */
	private function scan_html( string $html ): void {
		if ( '' === trim( $html ) ) {
			return;
		}
		if ( preg_match_all( '/\bwp-image-(\d+)\b/', $html, $matches ) ) {
			foreach ( $matches[1] as $id ) {
				$this->add( (int) $id, 'content' );
			}
		}
		$this->collect_upload_paths( $html );
		$this->scan_shortcodes( $html );
	}

	private function scan_shortcodes( string $html ): void {
		if ( ! str_contains( $html, '[' ) ) {
			return;
		}
		$tags = array( 'gallery' );
		if ( $this->visual_portfolio ) {
			$tags[] = 'visual_portfolio';
		}
		if ( ! preg_match_all( '/' . get_shortcode_regex( $tags ) . '/', $html, $matches, PREG_SET_ORDER ) ) {
			return;
		}
		foreach ( $matches as $match ) {
			if ( '[' === $match[1] && ']' === $match[6] ) {
				continue; // Escaped: [[gallery]].
			}
			$atts = shortcode_parse_atts( $match[3] );
			$atts = is_array( $atts ) ? $atts : array();
			if ( 'gallery' === $match[2] ) {
				$list = (string) ( $atts['ids'] ?? $atts['include'] ?? '' );
				$ids  = '' === trim( $list ) ? $this->attached_images( $atts ) : self::int_list( explode( ',', $list ) );
				foreach ( $ids as $id ) {
					$this->add( $id, 'shortcode-gallery' );
				}
				continue;
			}
			$layout = self::int_value( $atts['id'] ?? null );
			if ( null !== $layout ) {
				foreach ( $this->layout_images( $layout ) as $id ) {
					$this->add( $id, 'visual-portfolio' );
				}
			}
		}
	}

	/**
	 * A `[gallery]` without `ids`/`include` shows the images attached to a
	 * post (D40): its `id` attribute, else the post that contains it, minus
	 * `exclude`. The same query as core's gallery_shortcode(): image
	 * attachments with status `inherit` whose `post_parent` is that post.
	 *
	 * @param array<string, mixed> $atts
	 * @return list<int>
	 */
	private function attached_images( array $atts ): array {
		$parent = self::int_value( $atts['id'] ?? null ) ?? $this->post_id;
		if ( $parent <= 0 ) {
			return array();
		}
		$exclude = self::int_list( (string) ( $atts['exclude'] ?? '' ) );
		$ids     = get_children(
			array(
				'post_parent'    => $parent,
				'post_status'    => 'inherit',
				'post_type'      => 'attachment',
				'post_mime_type' => 'image',
				'fields'         => 'ids',
				// Fresh from the database: core's wp_media_attach_action() writes post_parent
				// with SQL, so a persistent object cache may still hold the old children.
				'cache_results'  => false,
			)
		);
		return array_values( array_diff( array_map( 'intval', (array) $ids ), $exclude ) );
	}

	/**
	 * Images of a Visual Portfolio saved layout: its Gallery Loop blocks'
	 * `imagesQuery.images` and, for legacy layouts, the `vp_images` meta.
	 *
	 * @return list<int>
	 */
	private function layout_images( int $layout_id ): array {
		if ( isset( $this->layout_images[ $layout_id ] ) ) {
			return $this->layout_images[ $layout_id ];
		}
		$this->layout_images[ $layout_id ] = array();
		$layout                            = get_post( $layout_id );
		if ( ! $layout instanceof \WP_Post || 'vp_lists' !== $layout->post_type ) {
			return array();
		}
		$ids = self::image_ids( get_post_meta( $layout_id, 'vp_images', true ) );
		if ( str_contains( $layout->post_content, 'visual-portfolio/' ) ) {
			$ids = array_merge( $ids, $this->loop_images( array_values( parse_blocks( $layout->post_content ) ) ) );
		}
		$this->layout_images[ $layout_id ] = array_values( array_unique( $ids ) );
		return $this->layout_images[ $layout_id ];
	}

	/**
	 * @param array<int, array<string, mixed>> $blocks
	 * @return list<int>
	 */
	private function loop_images( array $blocks ): array {
		$ids = array();
		foreach ( $blocks as $block ) {
			$attrs = is_array( $block['attrs'] ?? null ) ? $block['attrs'] : array();
			$name  = (string) ( $block['blockName'] ?? '' );
			if ( 'visual-portfolio/loop' === $name && is_array( $attrs['imagesQuery'] ?? null ) ) {
				$ids = array_merge( $ids, self::image_ids( $attrs['imagesQuery']['images'] ?? array() ) );
			}
			if ( 'visual-portfolio/block' === $name ) {
				$ids = array_merge( $ids, self::image_ids( $attrs['images'] ?? array() ) );
			}
			$ids = array_merge( $ids, $this->loop_images( is_array( $block['innerBlocks'] ?? null ) ? $block['innerBlocks'] : array() ) );
		}
		return $ids;
	}

	/**
	 * Upload-relative paths of every URL under the uploads folder, matched by
	 * path whatever the host (a site moved between hosts keeps its usage).
	 */
	private function collect_upload_paths( string $html ): void {
		$base = $this->uploads_path();
		if ( '' === $base || ! str_contains( $html, $base ) ) {
			return;
		}
		$pattern = '~' . preg_quote( $base, '~' ) . '/([^"\'\s<>?#()\[\]\\\\]+)~';
		if ( preg_match_all( $pattern, $html, $matches ) ) {
			foreach ( $matches[1] as $path ) {
				$this->paths[] = rawurldecode( html_entity_decode( $path, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) );
			}
		}
	}

	/**
	 * The path part of the uploads base URL, e.g. `/wp-content/uploads`.
	 */
	private function uploads_path(): string {
		if ( null === $this->uploads_path ) {
			$uploads            = wp_get_upload_dir();
			$this->uploads_path = rtrim( (string) wp_parse_url( (string) $uploads['baseurl'], PHP_URL_PATH ), '/' );
		}
		return $this->uploads_path;
	}

	/**
	 * Resolves the collected paths to attachments in one query: the path
	 * itself, a sub-size (`-300x200`), the unscaled or unrotated original of
	 * a `-scaled`/`-rotated` file, and a PDF's preview image.
	 */
	private function resolve_paths(): void {
		if ( array() === $this->paths ) {
			return;
		}
		$candidates = array();
		foreach ( array_unique( $this->paths ) as $path ) {
			foreach ( self::path_candidates( $path ) as $candidate ) {
				$candidates[ $candidate ] = true;
			}
		}
		$candidates = array_keys( $candidates );
		global $wpdb;
		foreach ( array_chunk( $candidates, 500 ) as $chunk ) {
			$placeholders = implode( ',', array_fill( 0, count( $chunk ), '%s' ) );
			$rows         = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_wp_attached_file' AND meta_value IN ({$placeholders})", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
					...$chunk
				)
			);
			foreach ( (array) $rows as $id ) {
				$this->add( (int) $id, 'content' );
			}
		}
	}

	/**
	 * @return list<string>
	 */
	public static function path_candidates( string $path ): array {
		$path       = ltrim( $path, '/' );
		$candidates = array( $path );
		if ( ! preg_match( '/^(.*?)(\.[a-z0-9]+)$/i', $path, $parts ) ) {
			return $candidates;
		}
		[ , $stem, $ext ] = $parts;
		$base_stem        = (string) preg_replace( '/-\d+x\d+$/', '', $stem );
		$candidates[]     = $base_stem . $ext;
		$candidates[]     = $base_stem . '-scaled' . $ext;
		$candidates[]     = $base_stem . '-rotated' . $ext;
		if ( str_ends_with( $base_stem, '-pdf' ) ) {
			$candidates[] = substr( $base_stem, 0, -4 ) . '.pdf';
		}
		return array_values( array_unique( $candidates ) );
	}

	private function add( int $id, string $context ): void {
		if ( $id > 0 ) {
			$this->found[ $id ][ $context ] = true;
		}
	}

	/**
	 * Drops ids that aren't attachments (deleted media, typos in markup).
	 *
	 * @param array<int, array<string, true>> $found
	 * @return array<int, list<string>>
	 */
	private function existing_only( array $found ): array {
		if ( array() === $found ) {
			return array();
		}
		global $wpdb;
		$ids          = array_keys( $found );
		$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
		$existing     = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT ID FROM {$wpdb->posts} WHERE post_type = 'attachment' AND ID IN ({$placeholders})", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				...$ids
			)
		);
		$result = array();
		foreach ( array_map( 'intval', (array) $existing ) as $id ) {
			$result[ $id ] = array_keys( $found[ $id ] );
		}
		ksort( $result );
		return $result;
	}

	/**
	 * Ids of Visual Portfolio image entries (`{id, imgUrl, …}`); entries
	 * without an id (external `imgUrl`) are ignored.
	 *
	 * @return list<int>
	 */
	private static function image_ids( mixed $images ): array {
		if ( ! is_array( $images ) ) {
			return array();
		}
		$ids = array();
		foreach ( $images as $image ) {
			$id = is_array( $image ) ? self::int_value( $image['id'] ?? null ) : self::int_value( $image );
			if ( null !== $id ) {
				$ids[] = $id;
			}
		}
		return $ids;
	}

	/**
	 * @return list<int>
	 */
	private static function int_list( mixed $values ): array {
		if ( is_string( $values ) ) {
			$values = explode( ',', $values );
		}
		if ( ! is_array( $values ) ) {
			return array();
		}
		$ids = array();
		foreach ( $values as $value ) {
			$id = self::int_value( $value );
			if ( null !== $id ) {
				$ids[] = $id;
			}
		}
		return $ids;
	}

	private static function int_value( mixed $value ): ?int {
		if ( is_int( $value ) ) {
			return $value > 0 ? $value : null;
		}
		if ( is_string( $value ) && preg_match( '/^\s*(\d+)\s*$/', $value, $match ) ) {
			$id = (int) $match[1];
			return $id > 0 ? $id : null;
		}
		if ( is_float( $value ) && $value >= 1 && floor( $value ) === $value ) {
			return (int) $value;
		}
		return null;
	}
}
