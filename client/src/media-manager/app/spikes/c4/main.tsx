// Spike C4 harness: the real keymap (installKeymap + DEFAULT_BINDINGS +
// implementCommand) next to Mantine Menu, Modal (confirm()), Select,
// Autocomplete, Popover and Drawer, plus our own Esc layer, a text field and
// a [data-mm-local-keys] region. Everything that happens is appended to
// window.__log for run-c4.mjs. Not part of the build; nothing imports it.
//
// `?patched=1` installs the proposed dispatcher (installKeymapPatched.ts)
// instead of core's.

import '@mantine/core/styles.css'
import {
  Autocomplete,
  Button,
  Drawer,
  Group,
  MantineProvider,
  Menu,
  Paper,
  Popover,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { StrictMode, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import {
  commandAvailability,
  implementCommand,
} from '../../../core/commands/registry'
import {
  DEFAULT_BINDINGS,
  decideKey,
  type InstallOptions,
  installKeymap,
  keyLayerNames,
  listBindings,
  readFocusContext,
  registerBindings,
  topKeyLayer,
  useKeyLayer,
} from '../../../core/keymap'
import {
  ConfirmHost as CoreConfirmHost,
  confirm as coreConfirm,
} from '../../../core/ui/confirm'
import {
  ConfirmHost as PatchedConfirmHost,
  confirm as patchedConfirm,
} from './confirmPatched'
import {
  decideKeyPatched,
  installKeymapPatched,
  readFocusContextPatched,
} from './installKeymapPatched'
import {
  currentListener,
  describeContext,
  describeDecision,
  describeNode,
  log,
  overlayCounts,
  traceClose,
  watchOverlays,
} from './trace'

// ---------------------------------------------------------------------------
// Mode (grid/detail) and the test commands
// ---------------------------------------------------------------------------

type Mode = 'grid' | 'detail'
let mode: Mode = 'detail'
let foldersShown = true
const modeListeners = new Set<() => void>()

function setMode(next: Mode): void {
  mode = next
  for (const listener of modeListeners) {
    listener()
  }
}

function useMode(): Mode {
  return useSyncExternalStore(
    (listener) => {
      modeListeners.add(listener)
      return () => {
        modeListeners.delete(listener)
      }
    },
    () => mode,
  )
}

registerBindings('core', DEFAULT_BINDINGS)
implementCommand('detail.close', {
  run: () => {
    log('cmd', 'detail.close')
    setMode('grid')
  },
})
implementCommand('selection.clear', {
  run: () => log('cmd', 'selection.clear'),
})
implementCommand('panels.toggle-folders', {
  run: () => {
    foldersShown = !foldersShown
    log('cmd', `panels.toggle-folders -> ${foldersShown}`)
  },
})
implementCommand('detail.step', {
  run: (args) => log('cmd', `detail.step ${args.direction}`),
})
implementCommand('detail.open', {
  run: () => {
    log('cmd', 'detail.open')
    setMode('detail')
  },
})
implementCommand('peek.toggle', { run: () => log('cmd', 'peek.toggle') })
implementCommand('grid.move-focus', {
  run: (args) => log('cmd', `grid.move-focus ${args.to}`),
})

// ---------------------------------------------------------------------------
// The dispatcher under test, plus diagnostics around it
// ---------------------------------------------------------------------------

const patched = new URLSearchParams(location.search).has('patched')
const readContext = patched ? readFocusContextPatched : readFocusContext
const decide = patched ? (decideKeyPatched as typeof decideKey) : decideKey
const confirm = patched ? patchedConfirm : coreConfirm
const ConfirmHost = patched ? PatchedConfirmHost : CoreConfirmHost
const capturedLayer = new WeakMap<Event, string>()

const options: InstallOptions = {
  getMode: () => mode,
  onDecision: (decision, event) => {
    // What the decision would have been from a fresh read at bubble time,
    // i.e. without the capture snapshot: shows whether the snapshot matters.
    const fresh = readContext(event.target)
    const freshDecision = decide({
      event,
      context: fresh,
      mode,
      bindings: listBindings(),
      layer: topKeyLayer(),
      isAvailable: (binding) =>
        commandAvailability(binding.command, binding.args as never).ok,
    })
    log(
      'decide',
      `${event.key} ${describeDecision(decision)} | fresh-ctx=${describeContext(fresh)} fresh=${describeDecision(freshDecision)} | layer cap=${capturedLayer.get(event)} now=${topKeyLayer()?.name ?? '-'} | active=${describeNode(document.activeElement)} prevented=${event.defaultPrevented}`,
    )
  },
}
if (patched) {
  installKeymapPatched(options)
} else {
  installKeymap(options)
}

// Registered after the dispatcher, so it runs right after its snapshot and
// sees the same state.
window.addEventListener(
  'keydown',
  (event) => {
    capturedLayer.set(event, topKeyLayer()?.name ?? '-')
    log(
      'cap',
      `${event.key} target=${describeNode(event.target)} active=${describeNode(document.activeElement)} ctx=${describeContext(readContext(event.target))} layers=${keyLayerNames().join('>') || '-'} mode=${mode}`,
    )
  },
  { capture: true },
)

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const DATA = ['Alpha', 'Beta', 'Gamma']

function ClickMenu({ id, label }: { id: string; label: string }) {
  return (
    <Menu onClose={traceClose(`${id}:close`)}>
      <Menu.Target>
        <Button id={id} data-c4={id}>
          {label}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item data-c4={`${id}-item-1`}>First</Menu.Item>
        <Menu.Item data-c4={`${id}-item-2`}>Second</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

function HoverMenu() {
  return (
    <Menu trigger='hover' onClose={traceClose('hover-menu:close')}>
      <Menu.Target>
        <Button id='hover-btn' data-c4='hover-btn' variant='light'>
          Hover menu
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item data-c4='hover-item-1'>First</Menu.Item>
        <Menu.Item data-c4='hover-item-2'>Second</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}

/** Our own transient layer (a fake peek) with a Menu inside it. */
function Peek({ onClose }: { onClose: () => void }) {
  useKeyLayer('peek', () => {
    log('layer', `peek:onEscape via ${currentListener()}`)
    onClose()
  })
  return (
    <Paper id='peek' data-c4='peek' withBorder p='sm'>
      <Group>
        <Text size='sm'>Peek layer</Text>
        <ClickMenu id='peek-menu-btn' label='Menu in peek' />
      </Group>
    </Paper>
  )
}

/** A plain Popover with a button inside (no layer). */
function PlainPopover() {
  return (
    <Popover onClose={traceClose('pop:close')}>
      <Popover.Target>
        <Button id='pop-btn' data-c4='pop-btn' variant='outline'>
          Popover
        </Button>
      </Popover.Target>
      <Popover.Dropdown data-c4-popover=''>
        <Button id='pop-inner' data-c4='pop-inner' size='xs'>
          Inside popover
        </Button>
      </Popover.Dropdown>
    </Popover>
  )
}

/** The recommended pattern: a Popover that registers an Esc layer while open. */
function LayeredPopover() {
  const [opened, setOpened] = useState(false)
  useKeyLayer(
    'lpop',
    () => {
      log('layer', `lpop:onEscape via ${currentListener()}`)
      setOpened(false)
    },
    opened,
  )
  return (
    <Popover
      opened={opened}
      onChange={(next) => {
        if (!next) {
          traceClose('lpop:close')()
        }
        setOpened(next)
      }}
      returnFocus
    >
      <Popover.Target>
        <Button
          id='lpop-btn'
          data-c4='lpop-btn'
          variant='outline'
          onClick={() => setOpened((open) => !open)}
        >
          Layered popover
        </Button>
      </Popover.Target>
      <Popover.Dropdown data-c4-popover=''>
        <Button id='lpop-inner' data-c4='lpop-inner' size='xs'>
          Inside layered popover
        </Button>
      </Popover.Dropdown>
    </Popover>
  )
}

function Harness() {
  const currentMode = useMode()
  const [peek, setPeek] = useState(false)
  const [drawer, setDrawer] = useState(false)
  return (
    <Stack p='md' gap='sm' maw={900}>
      <Text id='mode' data-c4='mode' fw={700}>
        mode: {currentMode} {patched ? '(patched dispatcher)' : ''}
      </Text>
      <Group>
        <Button id='neutral' data-c4='neutral' variant='default'>
          Neutral
        </Button>
        <ClickMenu id='menu-btn' data-c4='menu-btn' label='Click menu' />
        <HoverMenu />
        <Button
          id='confirm-btn'
          data-c4='confirm-btn'
          variant='default'
          onClick={() => {
            log('confirm', 'open')
            confirm({ title: 'Sure?', body: 'A confirm() modal' }).then(
              (result) => log('confirm', `resolved ${result}`),
            )
          }}
        >
          Confirm…
        </Button>
        <Button
          id='drawer-btn'
          data-c4='drawer-btn'
          variant='default'
          onClick={() => setDrawer(true)}
        >
          Drawer
        </Button>
      </Group>
      <Group>
        <PlainPopover />
        <LayeredPopover />
        <Button
          id='peek-btn'
          data-c4='peek-btn'
          variant='default'
          onClick={() => setPeek(true)}
        >
          Open peek
        </Button>
      </Group>
      {peek && (
        <Peek
          onClose={() => {
            setPeek(false)
          }}
        />
      )}
      <Group align='flex-end'>
        <Select
          id='select'
          data-c4='select'
          label='Select'
          data={DATA}
          onDropdownClose={traceClose('select:dropdown')}
        />
        <Autocomplete
          id='auto'
          data-c4='auto'
          label='Autocomplete'
          data={DATA}
          onDropdownClose={traceClose('auto:dropdown')}
        />
        <TextInput id='text' data-c4='text' label='Text' />
      </Group>
      <Paper
        id='local'
        data-c4='local'
        withBorder
        p='sm'
        tabIndex={0}
        data-mm-local-keys=''
      >
        <Text size='sm'>[data-mm-local-keys] region (focusable)</Text>
      </Paper>
      <Drawer
        opened={drawer}
        onClose={() => {
          traceClose('drawer:close')()
          setDrawer(false)
        }}
        title='Drawer'
      >
        <Button id='drawer-inner' data-c4='drawer-inner'>
          Inside drawer
        </Button>
      </Drawer>
      <ConfirmHost />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Runner API
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    __c4: {
      ready: boolean
      patched: boolean
      state(): Record<string, unknown>
      setMode(next: Mode): void
    }
  }
}

window.__c4 = {
  ready: false,
  patched,
  state: () => ({
    mode,
    folders: foldersShown,
    active: describeNode(document.activeElement),
    layers: keyLayerNames().join('>') || '-',
    peek: document.getElementById('peek') !== null,
    textValue: (document.getElementById('text') as HTMLInputElement | null)
      ?.value,
    ...overlayCounts(),
  }),
  setMode,
}

const root = document.getElementById('root')
if (!root) {
  throw new Error('#root missing')
}
createRoot(root).render(
  <StrictMode>
    <MantineProvider>
      <Harness />
    </MantineProvider>
  </StrictMode>,
)
watchOverlays()
requestAnimationFrame(() => {
  window.__c4.ready = true
})
