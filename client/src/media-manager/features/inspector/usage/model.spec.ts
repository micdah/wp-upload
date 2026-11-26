import { describe, expect, it } from 'vitest'
import {
  USAGE_CONTEXTS,
  type UsageRef,
} from '../../../../../../shared/library-api'
import {
  batchUsedInLine,
  CONTEXT_LABELS,
  capIds,
  contextLabel,
  featuredCount,
  featuredWarning,
  groupUsage,
  mixedNotice,
  moreLine,
  refKey,
  refMeta,
  statusLabel,
  unusedCount,
  usedInLine,
} from './model'

// The Usage panel's pure helpers: labels, the lines it says, and grouping
// several items' usage by place.

function post(
  postId: number,
  title: string,
  contexts: UsageRef['contexts'] = ['image-block'],
  extra: Partial<UsageRef> = {},
): UsageRef {
  return {
    postId,
    postType: 'post',
    postTypeLabel: 'Post',
    title,
    status: 'publish',
    editUrl: `https://example.com/wp-admin/post.php?post=${postId}&action=edit`,
    viewUrl: `https://example.com/?p=${postId}`,
    contexts,
    ...extra,
  }
}

const siteLogo: UsageRef = {
  postId: null,
  postType: 'site',
  postTypeLabel: 'Site',
  title: 'Site logo',
  status: 'publish',
  editUrl: 'https://example.com/wp-admin/site-editor.php',
  viewUrl: 'https://example.com/',
  contexts: ['site-logo'],
}

const placeholder: UsageRef = {
  postId: null,
  postType: 'site',
  postTypeLabel: 'Site',
  title: 'Visual Portfolio placeholder image',
  status: 'publish',
  editUrl: null,
  viewUrl: null,
  contexts: ['visual-portfolio'],
}

describe('labels', () => {
  it('has a human label for every usage context', () => {
    for (const context of USAGE_CONTEXTS) {
      expect(CONTEXT_LABELS[context]).toBeTruthy()
    }
    expect(contextLabel('featured')).toBe('Featured image')
    expect(contextLabel('media-text')).toBe('Media & text')
    expect(contextLabel('content')).toBe('In content')
    expect(contextLabel('shortcode-gallery')).toBe('Gallery shortcode')
    expect(contextLabel('visual-portfolio')).toBe('Visual Portfolio')
  })

  it('names post statuses, capitalising unknown ones', () => {
    expect(statusLabel('publish')).toBe('Published')
    expect(statusLabel('future')).toBe('Scheduled')
    expect(statusLabel('inherit')).toBe('Inherit')
    expect(statusLabel('')).toBe('')
  })

  it('builds the meta line parts, with a status only when not published', () => {
    expect(refMeta(post(1, 'A', ['featured', 'image-block']))).toEqual({
      type: 'Post',
      status: null,
      contexts: [
        { context: 'featured', label: 'Featured image' },
        { context: 'image-block', label: 'Image block' },
      ],
    })
    expect(refMeta(post(2, 'B', ['content'], { status: 'draft' })).status).toBe(
      'Draft',
    )
    expect(refMeta(siteLogo).status).toBeNull()
  })
})

describe('lines', () => {
  it('says where one item is used', () => {
    expect(usedInLine(0)).toBe('Not used anywhere')
    expect(usedInLine(1)).toBe('Used in 1 place')
    expect(usedInLine(2)).toBe('Used in 2 places')
  })

  it('counts featured uses and words the warning for one or several posts', () => {
    expect(
      featuredCount([post(1, 'A', ['featured']), post(2, 'B'), siteLogo]),
    ).toBe(1)
    expect(featuredWarning(1)).toBe(
      'Featured image of 1 post. Deleting this file clears it there, and that post shows no image until a new one is set.',
    )
    expect(featuredWarning(3)).toBe(
      'Featured image of 3 posts. Deleting this file clears it there, and those posts show no image until a new one is set.',
    )
  })

  it('says how many refs the 200-ref cap left out', () => {
    expect(moreLine(200, 200)).toBeNull()
    expect(moreLine(1234, 200)).toBe('and 1,034 more')
  })

  it('caps large selections', () => {
    const ids = Array.from({ length: 501 }, (_, index) => index + 1)
    expect(capIds(ids, 500)).toEqual({ ids: ids.slice(0, 500), capped: true })
    expect(capIds([1, 2], 500)).toEqual({ ids: [1, 2], capped: false })
  })

  it('words the mixed Author selection', () => {
    expect(mixedNotice(5, 7)).toBe(
      'Changes apply to the 5 items you uploaded. 7 uploaded by others stay as they are.',
    )
    expect(mixedNotice(1, 1)).toBe(
      'Changes apply to the 1 item you uploaded. 1 uploaded by others stays as it is.',
    )
  })
})

describe('several items', () => {
  it('groups refs by post, counts each item once per place, and merges contexts', () => {
    const groups = groupUsage([
      {
        id: 1,
        count: 2,
        refs: [post(205, 'Recap', ['featured']), post(206, 'Summer')],
      },
      {
        id: 2,
        count: 1,
        refs: [post(205, 'Recap', ['gallery-block'])],
      },
      { id: 3, count: 0, refs: [] },
    ])
    expect(
      groups.map((group) => [group.ref.title, group.items, group.contexts]),
    ).toEqual([
      ['Recap', 2, ['featured', 'gallery-block']],
      ['Summer', 1, ['image-block']],
    ])
  })

  it('keeps site-level places apart from posts and lists them before posts with the same count', () => {
    const groups = groupUsage([
      { id: 1, count: 3, refs: [siteLogo, placeholder, post(201, 'About')] },
    ])
    expect(groups.map((group) => group.ref.title)).toEqual([
      'Site logo',
      'Visual Portfolio placeholder image',
      'About',
    ])
    expect(refKey(siteLogo)).not.toBe(refKey(placeholder))
    expect(refKey(post(201, 'About'))).toBe('post:201')
  })

  it('summarises: posts, places and the unused count', () => {
    const usages = [
      { id: 1, count: 1, refs: [post(205, 'Recap')] },
      { id: 2, count: 1, refs: [post(206, 'Summer')] },
      { id: 3, count: 0, refs: [] },
    ]
    expect(unusedCount(usages)).toBe(1)
    expect(batchUsedInLine(groupUsage(usages), 1)).toBe(
      'Used in 2 posts · 1 not used anywhere',
    )
    expect(batchUsedInLine(groupUsage(usages.slice(0, 2)), 0)).toBe(
      'Used in 2 posts',
    )
    expect(
      batchUsedInLine(groupUsage([{ id: 4, count: 1, refs: [siteLogo] }]), 0),
    ).toBe('Used in 1 place')
    expect(batchUsedInLine([], 3)).toBe('None of them is used anywhere')
  })
})
