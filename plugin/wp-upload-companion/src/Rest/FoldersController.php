<?php
/**
 * The FileBird folder routes (plugin-api.md §5.16-5.20): the tree with
 * counts, create, rename/move/reorder/recolour, delete, and assign.
 *
 * - Without active FileBird every route answers 409 `wpu_filebird_inactive`.
 * - In per-user mode (D10, D25) reads serve the current user's own tree and
 *   every mutation answers 409 `wpu_filebird_per_user`.
 * - Mutations go through `FileBird\Adapter` (FileBird's own functions only);
 *   the routes then write the index's `folder_id` themselves and bump the rev.
 *
 * Owned by track P1.
 *
 * @package WpUpload\Companion
 */

namespace WpUpload\Companion\Rest;

use WpUpload\Companion\FileBird\Adapter;
use WpUpload\Companion\Index\MediaIndex;
use WpUpload\Companion\Plugin;
use WpUpload\Companion\Query\Visibility;
use WpUpload\Companion\Rev;
use WpUpload\Companion\Support\Errors;
use WpUpload\Companion\Support\Params;
use WpUpload\Companion\Support\Routes;

final class FoldersController {

	public const MAX_NAME_LENGTH = 200;
	public const MAX_ASSIGN_IDS  = 5000;

	public static function register(): void {
		Plugin::provide_feature( 'folders' );
		Plugin::provide_feature( 'folder-colors' );
		add_action( 'rest_api_init', array( self::class, 'register_routes' ) );
	}

	public static function register_routes(): void {
		Routes::add( '/folders', 'GET', array( self::class, 'get_tree' ) );
		Routes::add( '/folders', 'POST', array( self::class, 'create' ) );
		Routes::add( '/folders/assign', 'POST', array( self::class, 'assign' ) );
		Routes::add( '/folders/(?P<id>\d+)', \WP_REST_Server::EDITABLE, array( self::class, 'update' ) );
		Routes::add( '/folders/(?P<id>\d+)', \WP_REST_Server::DELETABLE, array( self::class, 'delete' ) );
	}

	// ---- GET /folders ----------------------------------------------------------------------

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function get_tree() {
		$rev = Rev::current();
		if ( ! Adapter::is_active() ) {
			return Errors::filebird_inactive();
		}
		$tree = self::tree( $rev );
		unset( $tree['byId'] );
		return $tree;
	}

	/**
	 * The `FolderTree` for the current user, plus `byId` (every folder's count)
	 * for internal use.
	 *
	 * @return array<string, mixed>
	 */
	private static function tree( string $rev ): array {
		$per_user = Adapter::is_per_user();
		$owner    = Adapter::owner();
		$pro      = Adapter::is_pro();
		$colors   = $pro ? Adapter::colors() : array();
		$folders  = Adapter::folders( $owner );
		$counts   = self::counts( $folders, $owner, $per_user );

		$list = array();
		foreach ( $folders as $folder ) {
			$list[] = array(
				'id'     => $folder['id'],
				'name'   => $folder['name'],
				'parent' => $folder['parent'],
				'ord'    => $folder['ord'],
				'color'  => $colors[ $folder['id'] ] ?? null,
				'count'  => $counts['byId'][ $folder['id'] ] ?? 0,
			);
		}
		return array(
			'rev'     => $rev,
			'mode'    => array(
				'pro'            => $pro,
				'perUser'        => $per_user,
				'readOnly'       => $per_user,
				'colorsWritable' => $pro && in_array( 'folder-colors', Plugin::features(), true ),
			),
			'folders' => $list,
			'counts'  => array(
				'all'           => $counts['all'],
				'uncategorized' => $counts['uncategorized'],
			),
			'byId'    => $counts['byId'],
		);
	}

	/**
	 * Non-trashed attachments per folder (directly in it), in total, and in no
	 * folder of the tree, counting only the items the current user sees in the
	 * collection (§5.2's visibility rule, D41): for an Author a count matches
	 * what that folder shows. For Editors and Administrators that is every
	 * non-trashed attachment (FileBird's own count). From the index's folder
	 * column in shared mode once the index is ready, else from FileBird's
	 * relation table.
	 *
	 * @param list<array{id: int, name: string, parent: int, ord: int}> $folders
	 * @return array{byId: array<int, int>, all: int, uncategorized: int}
	 */
	private static function counts( array $folders, int $owner, bool $per_user ): array {
		$by_id = array();
		foreach ( $folders as $folder ) {
			$by_id[ $folder['id'] ] = 0;
		}
		$visibility = new Visibility();

		if ( ! $per_user && MediaIndex::is_ready() ) {
			global $wpdb;
			$table = MediaIndex::table();
			// The index has no parent column: users who need the parent check join wp_posts by primary key.
			$join  = $visibility->needs_parent() ? "INNER JOIN {$wpdb->posts} p ON p.ID = i.attachment_id" : '';
			$where = $visibility->live( 'i.status', 'i.author', 'p.post_parent' );
			$rows  = $wpdb->get_results(
				"SELECT i.folder_id, COUNT(*) AS c FROM {$table} i {$join} WHERE {$where} GROUP BY i.folder_id", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				ARRAY_A
			);
			$all         = 0;
			$categorized = 0;
			foreach ( (array) $rows as $row ) {
				$folder = (int) $row['folder_id'];
				$count  = (int) $row['c'];
				$all   += $count;
				if ( isset( $by_id[ $folder ] ) ) {
					$by_id[ $folder ] = $count;
					$categorized     += $count;
				}
			}
			return array(
				'byId'          => $by_id,
				'all'           => $all,
				'uncategorized' => $all - $categorized,
			);
		}

		$relation = Adapter::count_from_relations( $owner, $visibility->live( 'p.post_status', 'p.post_author', 'p.post_parent' ) );
		foreach ( $relation['byId'] as $folder => $count ) {
			if ( isset( $by_id[ $folder ] ) ) {
				$by_id[ $folder ] = $count;
			}
		}
		return array(
			'byId'          => $by_id,
			'all'           => $relation['all'],
			'uncategorized' => max( 0, $relation['all'] - $relation['categorized'] ),
		);
	}

	// ---- POST /folders ---------------------------------------------------------------------

	/**
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function create( \WP_REST_Request $request ) {
		$guard = self::mutation_guard();
		if ( null !== $guard ) {
			return $guard;
		}
		$body = Params::body( $request, array( 'name', 'parent' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		if ( ! array_key_exists( 'name', $body ) || ! is_string( $body['name'] ) ) {
			return Errors::invalid_param( 'name', 'name must be a string.' );
		}
		if ( ! array_key_exists( 'parent', $body ) ) {
			return Errors::invalid_param( 'parent', 'parent is required (0 = top level).' );
		}
		$parent = Params::int( $body['parent'], 'parent', 0 );
		if ( is_wp_error( $parent ) ) {
			return $parent;
		}
		$name = self::validate_name( $body['name'] );
		if ( is_wp_error( $name ) ) {
			return $name;
		}
		if ( $parent > 0 && ! Adapter::folder_exists( $parent, 0 ) ) {
			return Errors::folder_not_found( $parent );
		}

		$created = MediaIndex::own_folder_change(
			static function () use ( $name, $parent ) {
				return Adapter::create( $name['stored'], $parent );
			}
		);
		if ( is_wp_error( $created ) ) {
			return $created;
		}

		$rev    = Rev::commit();
		$tree   = self::tree( $rev );
		$folder = self::find( $tree, (int) $created );
		if ( null === $folder ) {
			return Errors::make( 'wpu_internal', 'The new folder could not be read back.', 500 );
		}
		unset( $tree['byId'] );
		return Routes::respond(
			array(
				'rev'           => $rev,
				'folder'        => $folder,
				'renamed'       => $folder['name'] !== $name['requested'],
				'requestedName' => $name['requested'],
				'tree'          => $tree,
			),
			201
		);
	}

	// ---- PATCH /folders/{id} ---------------------------------------------------------------

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function update( \WP_REST_Request $request ) {
		$guard = self::mutation_guard();
		if ( null !== $guard ) {
			return $guard;
		}
		$id   = (int) $request['id'];
		$body = Params::body( $request, array( 'name', 'parent', 'position', 'color' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		if ( array() === $body ) {
			return Errors::invalid_param( 'body', 'Send at least one of name, parent, position, color.' );
		}

		$name = null;
		if ( array_key_exists( 'name', $body ) ) {
			if ( ! is_string( $body['name'] ) ) {
				return Errors::invalid_param( 'name', 'name must be a string.' );
			}
			$name = self::validate_name( $body['name'] );
			if ( is_wp_error( $name ) ) {
				return $name;
			}
		}
		$new_parent = null;
		if ( array_key_exists( 'parent', $body ) ) {
			$new_parent = Params::int( $body['parent'], 'parent', 0 );
			if ( is_wp_error( $new_parent ) ) {
				return $new_parent;
			}
		}
		$position = null;
		if ( array_key_exists( 'position', $body ) ) {
			$position = Params::int( $body['position'], 'position', 0 );
			if ( is_wp_error( $position ) ) {
				return $position;
			}
		}
		$set_color = array_key_exists( 'color', $body );
		$color     = null;
		if ( $set_color ) {
			if ( null !== $body['color'] && ( ! is_string( $body['color'] ) || ! preg_match( '/^#[0-9a-f]{6}$/i', $body['color'] ) ) ) {
				return Errors::invalid_param( 'color', 'color must be #rrggbb or null.' );
			}
			$color = null === $body['color'] ? null : strtolower( $body['color'] );
		}

		$folders = array();
		foreach ( Adapter::folders( 0 ) as $folder ) {
			$folders[ $folder['id'] ] = $folder;
		}
		if ( ! isset( $folders[ $id ] ) ) {
			return Errors::folder_not_found( $id );
		}
		$current = $folders[ $id ];
		if ( null !== $new_parent && $new_parent > 0 && ! isset( $folders[ $new_parent ] ) ) {
			return Errors::folder_not_found( $new_parent );
		}
		if ( null !== $new_parent && self::is_self_or_descendant( $id, $new_parent, $folders ) ) {
			return Errors::make( 'wpu_folder_cycle', 'A folder cannot be moved into itself or one of its subfolders.', 409 );
		}
		if ( $set_color && ! ( Adapter::is_pro() && in_array( 'folder-colors', Plugin::features(), true ) ) ) {
			return Errors::make( 'wpu_pro_required', 'Folder colours need FileBird Pro.', 409 );
		}

		$result = MediaIndex::own_folder_change(
			static function () use ( $id, $name, $current, $new_parent, $position, $set_color, $color ) {
				if ( null !== $name && $name['requested'] !== $current['name'] ) {
					$renamed = Adapter::rename( $id, $name['stored'], $current['parent'] );
					if ( is_wp_error( $renamed ) ) {
						return $renamed;
					}
				}
				if ( null !== $new_parent || null !== $position ) {
					$target = null === $new_parent ? $current['parent'] : $new_parent;
					// Without a position the folder goes last among its new siblings.
					$moved = Adapter::move( $id, $target, null === $position ? PHP_INT_MAX : $position );
					if ( is_wp_error( $moved ) ) {
						return $moved;
					}
				}
				if ( $set_color ) {
					$colored = Adapter::set_color( $id, $color );
					if ( is_wp_error( $colored ) ) {
						return $colored;
					}
				}
				return true;
			}
		);
		if ( is_wp_error( $result ) ) {
			Rev::commit();
			return $result;
		}

		$rev    = Rev::commit();
		$tree   = self::tree( $rev );
		$folder = self::find( $tree, $id );
		if ( null === $folder ) {
			return Errors::make( 'wpu_internal', 'The folder could not be read back.', 500 );
		}
		unset( $tree['byId'] );
		return array(
			'rev'           => $rev,
			'folder'        => $folder,
			'renamed'       => null !== $name && $folder['name'] !== $name['requested'],
			'requestedName' => null === $name ? null : $name['requested'],
			'tree'          => $tree,
		);
	}

	// ---- DELETE /folders/{id} --------------------------------------------------------------

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function delete( \WP_REST_Request $request ) {
		$guard = self::mutation_guard();
		if ( null !== $guard ) {
			return $guard;
		}
		$id      = (int) $request['id'];
		$folders = Adapter::folders( 0 );
		$subtree = self::subtree( $id, $folders );
		if ( array() === $subtree ) {
			return Errors::folder_not_found( $id );
		}
		$moved_files = Adapter::count_files_in( $subtree );

		$deleted = MediaIndex::own_folder_change(
			static function () use ( $id ) {
				return Adapter::delete( $id );
			}
		);
		if ( is_wp_error( $deleted ) ) {
			return $deleted;
		}

		$remaining = array();
		foreach ( Adapter::folders( 0 ) as $folder ) {
			$remaining[ $folder['id'] ] = true;
		}
		$deleted_ids = array_values(
			array_filter(
				$subtree,
				static function ( $folder_id ) use ( $remaining ) {
					return ! isset( $remaining[ $folder_id ] );
				}
			)
		);
		MediaIndex::clear_folders( $deleted_ids );

		$rev  = Rev::commit();
		$tree = self::tree( $rev );
		unset( $tree['byId'] );
		return array(
			'rev'        => $rev,
			'deletedIds' => $deleted_ids,
			'movedFiles' => $moved_files,
			'tree'       => $tree,
		);
	}

	// ---- POST /folders/assign --------------------------------------------------------------

	/**
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function assign( \WP_REST_Request $request ) {
		$guard = self::mutation_guard();
		if ( null !== $guard ) {
			return $guard;
		}
		$body = Params::body( $request, array( 'folder', 'ids' ) );
		if ( is_wp_error( $body ) ) {
			return $body;
		}
		if ( ! array_key_exists( 'folder', $body ) ) {
			return Errors::invalid_param( 'folder', 'folder is required (0 = Uncategorized).' );
		}
		$folder = Params::int( $body['folder'], 'folder', 0 );
		if ( is_wp_error( $folder ) ) {
			return $folder;
		}
		$ids = Params::ids( $body['ids'] ?? null, 'ids', self::MAX_ASSIGN_IDS );
		if ( is_wp_error( $ids ) ) {
			return $ids;
		}
		if ( $folder > 0 && ! Adapter::folder_exists( $folder, 0 ) ) {
			return Errors::folder_not_found( $folder );
		}

		// FileBird's own assign rejects the whole set if one item fails, so filter first.
		_prime_post_caches( $ids, false, false );
		$allowed = array();
		$skipped = array();
		foreach ( $ids as $id ) {
			$post = get_post( $id );
			if ( ! $post instanceof \WP_Post || 'attachment' !== $post->post_type ) {
				$skipped[] = self::failure( $id, Errors::not_found( $id ) );
				continue;
			}
			if ( ! current_user_can( 'edit_post', $id ) ) {
				$skipped[] = self::failure( $id, Errors::forbidden( "You can't edit this media item." ) );
				continue;
			}
			$allowed[] = $id;
		}

		$previous      = Adapter::folders_of( $allowed, 0 );
		$moving        = array();
		$previous_list = array();
		foreach ( $allowed as $id ) {
			$before          = (int) ( $previous[ $id ] ?? 0 );
			$previous_list[] = array(
				'id'     => $id,
				'folder' => $before,
			);
			if ( $before !== $folder ) {
				$moving[] = $id;
			}
		}
		$moved = count( $moving );

		// Only items that change folder go to FileBird: its hooks mark the rev changed
		// even for a no-op, which would bump it after this response reported it.
		if ( array() !== $moving ) {
			$assigned = MediaIndex::own_folder_change(
				static function () use ( $moving, $folder ) {
					return Adapter::assign( $moving, $folder );
				}
			);
			if ( is_wp_error( $assigned ) ) {
				return $assigned;
			}
			MediaIndex::set_folder( $moving, $folder );
		}

		$rev  = ( $moved > 0 || Rev::is_dirty() ) ? Rev::commit() : Rev::current();
		$tree = self::tree( $rev );
		return array(
			'rev'      => $rev,
			'previous' => $previous_list,
			'skipped'  => $skipped,
			'moved'    => $moved,
			'counts'   => array(
				'all'           => $tree['counts']['all'],
				'uncategorized' => $tree['counts']['uncategorized'],
				'byId'          => (object) $tree['byId'],
			),
		);
	}

	// ---- Helpers ---------------------------------------------------------------------------

	/**
	 * FileBird must be active, and folders are read-only in per-user mode.
	 */
	private static function mutation_guard(): ?\WP_Error {
		if ( ! Adapter::is_active() ) {
			return Errors::filebird_inactive();
		}
		if ( Adapter::is_per_user() ) {
			return Errors::filebird_per_user();
		}
		return null;
	}

	/**
	 * Trims and collapses whitespace; 1-200 characters, and not empty after
	 * FileBird's sanitising.
	 *
	 * @return array{requested: string, stored: string}|\WP_Error
	 */
	private static function validate_name( string $raw ) {
		$requested = Params::collapse_whitespace( $raw );
		$length    = function_exists( 'mb_strlen' ) ? mb_strlen( $requested ) : strlen( $requested );
		if ( 0 === $length || $length > self::MAX_NAME_LENGTH ) {
			return Errors::make( 'wpu_invalid_folder_name', 'A folder name must have 1 to 200 characters.', 400 );
		}
		$stored = Adapter::sanitize_name( $requested );
		if ( '' === trim( $stored ) ) {
			return Errors::make( 'wpu_invalid_folder_name', 'This folder name is empty once sanitised.', 400 );
		}
		return array(
			'requested' => $requested,
			'stored'    => $stored,
		);
	}

	/**
	 * @param array<string, mixed> $tree
	 * @return array<string, mixed>|null
	 */
	private static function find( array $tree, int $id ): ?array {
		foreach ( $tree['folders'] as $folder ) {
			if ( $folder['id'] === $id ) {
				return $folder;
			}
		}
		return null;
	}

	/**
	 * Whether `$candidate` is `$id` or one of its descendants (mirrors FileBird's
	 * isSelfOrDescendant, for a clean 409 before FileBird is called).
	 *
	 * @param array<int, array{id: int, name: string, parent: int, ord: int}> $folders
	 */
	private static function is_self_or_descendant( int $id, int $candidate, array $folders ): bool {
		$seen    = array();
		$current = $candidate;
		while ( $current > 0 ) {
			if ( $current === $id || isset( $seen[ $current ] ) ) {
				return true;
			}
			$seen[ $current ] = true;
			$current          = isset( $folders[ $current ] ) ? $folders[ $current ]['parent'] : 0;
		}
		return false;
	}

	/**
	 * The folder and every descendant: the folder first, then depth-first in
	 * sibling order. Empty when the folder doesn't exist.
	 *
	 * @param list<array{id: int, name: string, parent: int, ord: int}> $folders
	 * @return list<int>
	 */
	private static function subtree( int $id, array $folders ): array {
		$children = array();
		$exists   = false;
		foreach ( $folders as $folder ) {
			$children[ $folder['parent'] ][] = $folder['id'];
			if ( $folder['id'] === $id ) {
				$exists = true;
			}
		}
		if ( ! $exists ) {
			return array();
		}
		$result = array();
		$stack  = array( $id );
		$seen   = array();
		while ( array() !== $stack ) {
			$current = array_shift( $stack );
			if ( isset( $seen[ $current ] ) ) {
				continue;
			}
			$seen[ $current ] = true;
			$result[]         = $current;
			$stack            = array_merge( $children[ $current ] ?? array(), $stack );
		}
		return $result;
	}

	/**
	 * @return array{id: int, ok: false, error: array{code: string, message: string}}
	 */
	private static function failure( int $id, \WP_Error $error ): array {
		return array(
			'id'    => $id,
			'ok'    => false,
			'error' => Errors::item( $error ),
		);
	}
}
