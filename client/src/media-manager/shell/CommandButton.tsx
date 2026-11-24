import { ActionIcon, Tooltip } from '@mantine/core'
import type { ReactNode } from 'react'
import type { CommandArgs, CommandName } from '../core/commands/registry'
import { useCommand } from '../core/commands/useCommand'

interface CommandIconButtonProps<K extends CommandName> {
  command: K
  args?: CommandArgs<K>[0]
  icon: ReactNode
  /**
   * Overrides the command's label. A toggle keeps one fixed label (e.g.
   * "Folders") and reports its state with `pressed`, not a changing label.
   */
  label?: string
  /** aria-pressed for toggles. */
  pressed?: boolean
}

/**
 * An icon button bound to a command: its label and shortcut in the tooltip,
 * disabled (with the reason) when the command isn't available.
 *
 * Disabled is `aria-disabled` (plus Mantine's `data-disabled` look), not the
 * `disabled` attribute: a disabled button can't be focused or hovered, so
 * its tooltip with the reason would be unreachable. It stays focusable, and
 * a click or Enter/Space does nothing (runCommand() skips an unavailable
 * command).
 */
export function CommandIconButton<K extends CommandName>({
  command,
  args,
  icon,
  label,
  pressed,
}: CommandIconButtonProps<K>) {
  const state = useCommand(command, ...([args] as CommandArgs<K>))
  const name = label ?? state.label
  const tip = state.enabled
    ? state.shortcut
      ? `${name} (${state.shortcut})`
      : name
    : `${name}: ${state.reason}`
  return (
    <Tooltip
      label={tip}
      openDelay={400}
      withinPortal
      // Keyboard users reach the label and the reason too.
      events={{ hover: true, focus: true, touch: false }}
    >
      <ActionIcon
        type='button'
        variant='subtle'
        color='gray'
        size='lg'
        aria-label={name}
        aria-pressed={pressed}
        aria-disabled={!state.enabled || undefined}
        data-disabled={!state.enabled || undefined}
        // runCommand() checks availability, so an unavailable one never runs.
        onClick={state.run}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  )
}
