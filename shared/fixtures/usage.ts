// Fixture data for tests and mocks, consistent with the prototype's sample
// data (docs/media-manager/design/prototype/data/*.json): a 20-item subset,
// the same folder tree, users and posts. Imported only by tests and mocks.
// Keep fixtures mutually consistent (ids, counts, folders) when editing.

import type { PostsResponse, UsageResponse } from '../library-api.ts'

/** `usage?ids=…` for a few items, including one used nowhere (1000). */
export const usageSample = {
  rev: '1795867200000',
  complete: true,
  items: [
    {
      id: 1003,
      count: 2,
      refs: [
        {
          postId: 205,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Conference 2025 recap',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=205&action=edit',
          viewUrl: 'https://example.com/?p=205',
          contexts: ['gallery-block'],
        },
        {
          postId: 206,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Five ideas for summer',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=206&action=edit',
          viewUrl: 'https://example.com/?p=206',
          contexts: ['image-block'],
        },
      ],
    },
    {
      id: 1004,
      count: 1,
      refs: [
        {
          postId: 206,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Five ideas for summer',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=206&action=edit',
          viewUrl: 'https://example.com/?p=206',
          contexts: ['image-block'],
        },
      ],
    },
    {
      id: 1009,
      count: 3,
      refs: [
        {
          postId: 202,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Behind the scenes at our studio',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=202&action=edit',
          viewUrl: 'https://example.com/?p=202',
          contexts: ['featured'],
        },
        {
          postId: 203,
          postType: 'page',
          postTypeLabel: 'Page',
          title: 'About us',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=203&action=edit',
          viewUrl: 'https://example.com/?p=203',
          contexts: ['gallery-block'],
        },
        {
          postId: 206,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Five ideas for summer',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=206&action=edit',
          viewUrl: 'https://example.com/?p=206',
          contexts: ['image-block'],
        },
      ],
    },
    {
      id: 1016,
      count: 2,
      refs: [
        {
          postId: 203,
          postType: 'page',
          postTypeLabel: 'Page',
          title: 'About us',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=203&action=edit',
          viewUrl: 'https://example.com/?p=203',
          contexts: ['featured'],
        },
        {
          postId: 208,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Product launch: Outdoor line',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=208&action=edit',
          viewUrl: 'https://example.com/?p=208',
          contexts: ['featured'],
        },
      ],
    },
    {
      id: 1000,
      count: 0,
      refs: [],
    },
  ],
} satisfies UsageResponse

/** Item 1091 is also the site logo: site-level uses have no post id and come first. */
export const usageSiteLogo = {
  rev: '1795867200000',
  complete: false,
  items: [
    {
      id: 1091,
      count: 4,
      refs: [
        {
          postId: null,
          postType: 'site',
          postTypeLabel: 'Site',
          title: 'Site logo',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/site-editor.php',
          viewUrl: 'https://example.com/',
          contexts: ['site-logo'],
        },
        {
          postId: 206,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Five ideas for summer',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=206&action=edit',
          viewUrl: 'https://example.com/?p=206',
          contexts: ['image-block'],
        },
        {
          postId: 207,
          postType: 'page',
          postTypeLabel: 'Page',
          title: 'Press',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=207&action=edit',
          viewUrl: 'https://example.com/?p=207',
          contexts: ['image-block'],
        },
        {
          postId: 201,
          postType: 'post',
          postTypeLabel: 'Post',
          title: 'Spring newsletter',
          status: 'publish',
          editUrl: 'https://example.com/wp-admin/post.php?post=201&action=edit',
          viewUrl: 'https://example.com/?p=201',
          contexts: ['image-block'],
        },
      ],
    },
  ],
} satisfies UsageResponse

/** `posts?search=` (empty search: most recent first). */
export const postsRecent = {
  posts: [
    {
      postId: 208,
      postType: 'post',
      postTypeLabel: 'Post',
      title: 'Product launch: Outdoor line',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=208&action=edit',
      viewUrl: 'https://example.com/?p=208',
    },
    {
      postId: 207,
      postType: 'page',
      postTypeLabel: 'Page',
      title: 'Press',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=207&action=edit',
      viewUrl: 'https://example.com/?p=207',
    },
    {
      postId: 206,
      postType: 'post',
      postTypeLabel: 'Post',
      title: 'Five ideas for summer',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=206&action=edit',
      viewUrl: 'https://example.com/?p=206',
    },
    {
      postId: 205,
      postType: 'post',
      postTypeLabel: 'Post',
      title: 'Conference 2025 recap',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=205&action=edit',
      viewUrl: 'https://example.com/?p=205',
    },
    {
      postId: 204,
      postType: 'page',
      postTypeLabel: 'Page',
      title: 'Home',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=204&action=edit',
      viewUrl: 'https://example.com/?p=204',
    },
    {
      postId: 203,
      postType: 'page',
      postTypeLabel: 'Page',
      title: 'About us',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=203&action=edit',
      viewUrl: 'https://example.com/?p=203',
    },
    {
      postId: 202,
      postType: 'post',
      postTypeLabel: 'Post',
      title: 'Behind the scenes at our studio',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=202&action=edit',
      viewUrl: 'https://example.com/?p=202',
    },
    {
      postId: 201,
      postType: 'post',
      postTypeLabel: 'Post',
      title: 'Spring newsletter',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=201&action=edit',
      viewUrl: 'https://example.com/?p=201',
    },
  ],
} satisfies PostsResponse
