<?php
/**
 * Visual Portfolio content for the `small` seed (D22, spike X10). Loaded by seed/small.php after
 * everything that draws from the seed's random generator, so adding it changed none of the
 * earlier rows. It draws nothing random itself: the images are picked at fixed positions.
 * Never shipped.
 *
 * It creates every place Visual Portfolio 3.11.0 keeps attachment ids, each through the
 * plugin's own code paths where it has them:
 *
 * 1. a post with the legacy "Visual Portfolio" block (`visual-portfolio/block`): the ids are in
 *    its `images` attribute, used while `content_source` is `images`;
 * 2. a post with a Gallery Loop (`visual-portfolio/loop`) built by the plugin's own
 *    `Visual_Portfolio_Loop_Gallery::create()`: the ids are in `imagesQuery.images`, used while
 *    `queryType` is `images`;
 * 3. two saved layouts (`vp_lists` posts):
 *    - a legacy one, whose ids are in the `vp_images` post meta (with `vp_content_source` =
 *      `images`), as the plugin's own `update_layout` REST route stores them;
 *    - a block-based one (the 3.x default for new layouts), whose ids are in the Gallery Loop in
 *      its post content;
 * 4. a post that embeds both layouts with the `visual-portfolio/saved` block (`id` attribute),
 *    and another that embeds both with the `[visual_portfolio id=N]` shortcode.
 *
 * The spike note (docs/media-manager/tracks/D-m1-handoff.md, "Spike X10") records the exact
 * storage for track P2's parser.
 */

const WPU_SEED_VP_FIRST_POST_UTC = '2026-03-02 10:00:00';
const WPU_SEED_VP_LOOP_LAYOUT    = 'visual-portfolio/gallery-grid-classic';

/**
 * Images at fixed positions of the seeded image list, four per gallery, so every gallery has
 * its own ids and the parser's results are easy to check.
 *
 * @param int[] $image_ids The seeded image ids, in seed order.
 * @param int   $first     Position of the first image.
 * @return int[]
 */
function wpu_seed_vp_pick_images( array $image_ids, $first ) {
	return array_slice( $image_ids, $first, 4 );
}

/**
 * The image entries Visual Portfolio stores: `{id, imgUrl, imgThumbnailUrl}`, the same shape as
 * the plugin's own `prepare_image()` and the editor's gallery control.
 *
 * @param int[] $ids Attachment ids.
 * @return array<int, array<string, mixed>>
 */
function wpu_seed_vp_image_entries( array $ids ) {
	$entries = array();
	foreach ( $ids as $id ) {
		$url       = (string) wp_get_attachment_url( $id );
		$preview   = wp_get_attachment_image_src( $id, 'large' );
		$entries[] = array(
			'id'              => $id,
			'imgUrl'          => $url,
			'imgThumbnailUrl' => $preview ? $preview[0] : $url,
		);
	}
	return $entries;
}

/**
 * A legacy "Visual Portfolio" block that shows images.
 *
 * @param int[] $ids Attachment ids.
 * @return string Block markup.
 */
function wpu_seed_vp_legacy_block( array $ids ) {
	return serialize_block(
		array(
			'blockName'    => 'visual-portfolio/block',
			'attrs'        => array(
				'block_id'       => 'wpuseedvp1',
				'content_source' => 'images',
				'images'         => wpu_seed_vp_image_entries( $ids ),
				'layout'         => 'grid',
			),
			'innerBlocks'  => array(),
			'innerHTML'    => '',
			'innerContent' => array(),
		)
	);
}

/**
 * A Gallery Loop with an images source, built by the plugin itself from one of its layouts.
 * The plugin draws a random `block_id`; a fixed one keeps the seed deterministic.
 *
 * @param int[]  $ids      Attachment ids.
 * @param string $block_id The loop's `block_id` (8 hex characters, like the plugin's own).
 * @return string Block markup.
 */
function wpu_seed_vp_loop_block( array $ids, $block_id ) {
	$images = array();
	foreach ( $ids as $id ) {
		$images[] = array( 'id' => $id );
	}
	$loop = Visual_Portfolio_Loop_Gallery::create(
		WPU_SEED_VP_LOOP_LAYOUT,
		array(
			'source' => array(
				'type'   => 'images',
				'images' => $images,
			),
		),
		array()
	);
	if ( is_wp_error( $loop ) ) {
		WP_CLI::error( $loop );
	}
	$loop['attrs']['block_id'] = $block_id;
	return serialize_block( $loop );
}

/**
 * Creates a post (or saved layout) with a fixed date.
 *
 * @param string $post_type Post type.
 * @param string $title     Title.
 * @param string $content   Content.
 * @param int    $position  Position in the Visual Portfolio content, for the date.
 * @return int Post id.
 */
function wpu_seed_vp_insert_post( $post_type, $title, $content, $position ) {
	$date    = gmdate( 'Y-m-d H:i:s', strtotime( WPU_SEED_VP_FIRST_POST_UTC . ' UTC' ) + $position * DAY_IN_SECONDS );
	$post_id = wp_insert_post(
		array(
			'post_type'     => $post_type,
			'post_status'   => 'publish',
			'post_title'    => $title,
			'post_content'  => $content,
			'post_author'   => 1,
			'post_date'     => $date,
			'post_date_gmt' => $date,
		),
		true
	);
	if ( is_wp_error( $post_id ) ) {
		WP_CLI::error( $post_id );
	}
	return $post_id;
}

/**
 * Creates the Visual Portfolio content and returns what it created, for the spike note.
 *
 * @param int[] $image_ids The seeded image ids, in seed order.
 * @return array<string, mixed> Created ids: posts and layouts, and the images in each gallery.
 */
function wpu_seed_visual_portfolio( array $image_ids ) {
	if ( ! class_exists( 'Visual_Portfolio_Loop_Gallery' ) ) {
		WP_CLI::error( 'Visual Portfolio must be active to seed its galleries. Run `dev/run variant vp=on` or `dev/run up` first.' );
	}

	$block_images         = wpu_seed_vp_pick_images( $image_ids, 40 );
	$loop_images          = wpu_seed_vp_pick_images( $image_ids, 60 );
	$legacy_layout_images = wpu_seed_vp_pick_images( $image_ids, 80 );
	$loop_layout_images   = wpu_seed_vp_pick_images( $image_ids, 100 );

	$block_post = wpu_seed_vp_insert_post(
		'post',
		'Visual Portfolio: gallery block',
		wpu_seed_paragraph( 'A legacy Visual Portfolio block with an images source.' ) . "\n\n" . wpu_seed_vp_legacy_block( $block_images ),
		0
	);
	$loop_post  = wpu_seed_vp_insert_post(
		'post',
		'Visual Portfolio: gallery loop',
		wpu_seed_paragraph( 'A Gallery Loop block with an images source.' ) . "\n\n" . wpu_seed_vp_loop_block( $loop_images, '5eed0001' ),
		1
	);

	// The legacy layout keeps its settings in `vp_*` post meta, as the plugin's update_layout
	// REST route writes it: `vp_images` is stored as given (an array of image entries).
	$legacy_layout = wpu_seed_vp_insert_post( 'vp_lists', 'Saved layout: legacy images', '', 2 );
	update_post_meta( $legacy_layout, 'vp_content_source', 'images' );
	update_post_meta( $legacy_layout, 'vp_layout', 'tiles' );
	update_post_meta( $legacy_layout, 'vp_images', wpu_seed_vp_image_entries( $legacy_layout_images ) );

	// A block-based layout is a `vp_lists` post whose content holds a Gallery Loop.
	$loop_layout = wpu_seed_vp_insert_post(
		'vp_lists',
		'Saved layout: gallery loop',
		wpu_seed_vp_loop_block( $loop_layout_images, '5eed0002' ),
		3
	);

	$saved_block_post = wpu_seed_vp_insert_post(
		'post',
		'Visual Portfolio: saved layouts (block)',
		wpu_seed_paragraph( 'Both saved layouts, embedded with the Saved Layout block.' ) . "\n\n"
			. '<!-- wp:visual-portfolio/saved {"id":"' . $legacy_layout . '"} /-->' . "\n\n"
			. '<!-- wp:visual-portfolio/saved {"id":"' . $loop_layout . '"} /-->',
		4
	);
	$shortcode_post   = wpu_seed_vp_insert_post(
		'post',
		'Visual Portfolio: saved layouts (shortcode)',
		"<p>Both saved layouts, embedded with the shortcode.</p>\n\n[visual_portfolio id=\"$legacy_layout\"]\n\n[visual_portfolio id=$loop_layout]",
		5
	);

	return array(
		'posts'  => array(
			'block'       => array(
				'id'     => $block_post,
				'images' => $block_images,
			),
			'loop'        => array(
				'id'     => $loop_post,
				'images' => $loop_images,
			),
			'savedBlock'  => array(
				'id'      => $saved_block_post,
				'layouts' => array( $legacy_layout, $loop_layout ),
			),
			'shortcode'   => array(
				'id'      => $shortcode_post,
				'layouts' => array( $legacy_layout, $loop_layout ),
			),
		),
		'layouts' => array(
			'legacy' => array(
				'id'     => $legacy_layout,
				'images' => $legacy_layout_images,
			),
			'loop'   => array(
				'id'     => $loop_layout,
				'images' => $loop_layout_images,
			),
		),
	);
}
