import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { postsRecent } from '../../../../shared/fixtures/index.ts'
import { PostsResponseSchema } from '../../../../shared/library-api.schema.ts'
import { env } from '../../config/env.ts'
import {
  callsTo,
  type FakeHandler,
  fakeLibrary,
  libraryApp,
  resetLibrary,
} from '../../lib/library/specSupport.ts'

const originalWpUrl = env.wpUrl
beforeEach(() => {
  env.wpUrl = 'https://example.com'
})
afterEach(async () => {
  env.wpUrl = originalWpUrl
  await resetLibrary()
})

const SEARCH = 'GET /wp-json/wp/v2/search'

/** Core's search results for the fixture posts. */
const search: FakeHandler = () =>
  postsRecent.posts.map((post) => ({
    id: post.postId,
    title: post.title.replace('&', '&amp;'),
    url: post.viewUrl,
    type: 'post',
    subtype: post.postType,
  }))

/** `/wp/v2/types`: context=edit carries the singular labels. */
const types: FakeHandler = (call) =>
  call.params.context === 'edit'
    ? {
        post: {
          slug: 'post',
          name: 'Posts',
          labels: { singular_name: 'Post' },
        },
        page: {
          slug: 'page',
          name: 'Pages',
          labels: { singular_name: 'Page' },
        },
      }
    : {
        post: { slug: 'post', name: 'Posts', rest_base: 'posts' },
        page: { slug: 'page', name: 'Pages', rest_base: 'pages' },
      }

describe('GET posts', () => {
  it('answers published posts as PostRefs, most recent first', async () => {
    const spy = fakeLibrary({
      [SEARCH]: search,
      'GET /wp-json/wp/v2/types': types,
    })
    const res = await request(libraryApp()).get('/posts')
    expect(res.status).toBe(200)
    expect(PostsResponseSchema.parse(res.body)).toEqual(postsRecent)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(callsTo(spy, SEARCH)[0]?.params).toEqual({
      type: 'post',
      subtype: 'any',
      search: undefined,
      per_page: 10,
      _fields: 'id,title,url,type,subtype',
    })
  })

  it('passes the search (trimmed, whitespace collapsed) and limit', async () => {
    const spy = fakeLibrary({
      [SEARCH]: () => [],
      'GET /wp-json/wp/v2/types': types,
    })
    const res = await request(libraryApp()).get(
      '/posts?search=%20summer%20%20party%20&limit=20',
    )
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ posts: [] })
    expect(callsTo(spy, SEARCH)[0]?.params).toMatchObject({
      search: 'summer party',
      per_page: 20,
    })
  })

  it('names untitled posts and unknown types', async () => {
    fakeLibrary({
      [SEARCH]: () => [
        {
          id: 9,
          title: '',
          url: 'https://example.com/?p=9',
          subtype: 'event_item',
        },
      ],
      'GET /wp-json/wp/v2/types': types,
    })
    const res = await request(libraryApp()).get('/posts')
    expect(res.body.posts[0]).toMatchObject({
      title: '(no title)',
      postType: 'event_item',
      postTypeLabel: 'Event item',
    })
  })

  it.each([
    ['/posts?limit=0', 'limit'],
    ['/posts?limit=21', 'limit'],
    ['/posts?limit=abc', 'limit'],
    [`/posts?search=${'a'.repeat(201)}`, 'search'],
    ['/posts?type=page', 'type'],
  ])('%s → 400 (param %s)', async (path, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).get(path)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })
})
