// The sort and "+ Filter" menus' parts.
//
// MenuGroup: a labelled group of choices. A menu may only own items, groups
// and separators (axe's aria-required-children), so each heading and its
// items sit in a `group` named by the heading.
//
// MenuChoice: one choice: a check on the current one,
// an optional count, and the URL patch it writes (replace, D16). Mantine's
// items are always `menuitem`, so the current one says so with
// `aria-current` (aria-checked isn't allowed on a menuitem).

import { Menu } from '@mantine/core'
import { type ReactNode, useId } from 'react'
import { CheckIcon } from '../../core/ui/icons'
import type { UrlPatch } from '../../core/url/history'
import { urlStore } from '../../core/url/useUrlState'
import classes from './Filters.module.css'

export function MenuChoice({
  checked,
  label,
  count,
  patch,
}: {
  checked: boolean
  label: string
  count?: number
  patch: UrlPatch
}) {
  return (
    <Menu.Item
      className={classes.menuItem}
      aria-current={checked || undefined}
      data-checked={checked || undefined}
      leftSection={
        <CheckIcon
          size={16}
          aria-hidden
          className={classes.check}
          data-shown={checked || undefined}
        />
      }
      rightSection={
        count === undefined ? undefined : (
          <span className={classes.menuCount}>
            {count.toLocaleString('en')}
          </span>
        )
      }
      onClick={() => urlStore().navigate(patch)}
    >
      {label}
    </Menu.Item>
  )
}

export function MenuGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const id = useId()
  return (
    // biome-ignore lint/a11y/useSemanticElements: an ARIA menu group, not a fieldset
    <div role='group' aria-labelledby={id}>
      <Menu.Label id={id}>{label}</Menu.Label>
      {children}
    </div>
  )
}
