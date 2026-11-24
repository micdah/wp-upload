<?php
/**
 * Which attachments the current user may see in lists, as SQL (plugin-api.md
 * §5.2 "Visibility mirrors core's read check"), so every collection row
 * hydrates through `/wp/v2/media?context=view`:
 *
 * - `inherit` items, except those attached to a parent the user can't read
 *   (a draft, pending, future or private parent of another user, for users
 *   without `edit_others_posts` / `read_private_posts`);
 * - `private` items with `read_private_posts`, or the user's own;
 * - `trash` items only in the Trash, and only those the user may `edit_post`;
 * - never `auto-draft`.
 *
 * For Editors and Administrators this is every attachment, and no join is
 * needed. `/facets` and P2's `/trash` use the same rule.
 *
 * Owned by track P1; used by P2.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Query;

final class Visibility {

	/** @var int */
	private $user;

	/** @var bool */
	private $edit_others;

	/** @var bool */
	private $read_private;

	/** @var bool */
	private $edit_own;

	public function __construct() {
		$this->user         = get_current_user_id();
		$this->edit_others  = current_user_can( 'edit_others_posts' );
		$this->read_private = current_user_can( 'read_private_posts' );
		$this->edit_own     = current_user_can( 'edit_posts' );
	}

	public function user(): int {
		return $this->user;
	}

	public function can_edit_others(): bool {
		return $this->edit_others;
	}

	/**
	 * Whether the live (non-trash) condition reads the attachment's
	 * `post_parent` (so `wp_posts` must be joined).
	 */
	public function needs_parent(): bool {
		return ! ( $this->edit_others && $this->read_private );
	}

	/**
	 * Non-trashed attachments this user may see.
	 *
	 * The parent check is a correlated NOT EXISTS behind cheap tests, so
	 * unattached and own items (most of a library) never look the parent up.
	 *
	 * @param string $status      Column or expression holding post_status.
	 * @param string $author      Column or expression holding post_author.
	 * @param string $post_parent Column holding post_parent (only used when needs_parent()).
	 */
	public function live( string $status, string $author, string $post_parent = 'p.post_parent' ): string {
		if ( ! $this->needs_parent() ) {
			return "{$status} IN ('inherit','private')";
		}
		global $wpdb;
		$user = (int) $this->user;

		$parent_readable = array(
			"pp.post_status IN ('publish','inherit')",
			"pp.post_author = {$user}",
		);
		if ( $this->read_private ) {
			$parent_readable[] = "pp.post_status = 'private'";
		}
		if ( $this->edit_others ) {
			$parent_readable[] = "pp.post_status <> 'private'";
		}
		$unreadable_parent = "EXISTS (SELECT 1 FROM {$wpdb->posts} pp WHERE pp.ID = {$post_parent} AND NOT ("
			. implode( ' OR ', $parent_readable ) . '))';
		$private_readable  = $this->read_private ? '1' : "{$author} = {$user}";

		return "(({$status} = 'inherit' AND ({$post_parent} = 0 OR {$author} = {$user} OR NOT {$unreadable_parent}))"
			. " OR ({$status} = 'private' AND {$private_readable}))";
	}

	/**
	 * Trashed attachments this user may `edit_post` (core's read rule for
	 * trashed posts).
	 */
	public function trash( string $status, string $author ): string {
		if ( $this->edit_others ) {
			return "{$status} = 'trash'";
		}
		if ( $this->edit_own ) {
			return "({$status} = 'trash' AND {$author} = " . (int) $this->user . ')';
		}
		return '0';
	}
}
