// The app's keymap from interaction-spec §8, declared in one place so the
// `?` sheet is complete from day one. Each binding runs a CommandMap command;
// whichever feature implements that command makes the key work, and until
// then the key does nothing (its command is "Not available yet").
//
// Feature-local keys (folder tree, alt field, image editor, menus) are not
// here: those components handle them under [data-mm-local-keys].

import type { Binding } from './bindings'

// biome-ignore format: one binding per line reads as a table
export const DEFAULT_BINDINGS: readonly Binding[] = [
  // Navigate (grid)
  { key: 'ArrowLeft', mode: 'grid', command: 'grid.move-focus', args: { to: 'left' }, label: 'Move focus (and select)', group: 'Navigate', repeat: true },
  { key: 'ArrowRight', mode: 'grid', command: 'grid.move-focus', args: { to: 'right' }, label: 'Move focus (and select)', group: 'Navigate', repeat: true, hidden: true },
  { key: 'ArrowUp', mode: 'grid', command: 'grid.move-focus', args: { to: 'up' }, label: 'Move focus (and select)', group: 'Navigate', repeat: true, hidden: true },
  { key: 'ArrowDown', mode: 'grid', command: 'grid.move-focus', args: { to: 'down' }, label: 'Move focus (and select)', group: 'Navigate', repeat: true, hidden: true },
  { key: 'Home', mode: 'grid', command: 'grid.move-focus', args: { to: 'first' }, label: 'First item', group: 'Navigate' },
  { key: 'End', mode: 'grid', command: 'grid.move-focus', args: { to: 'last' }, label: 'Last item', group: 'Navigate' },
  // Navigate (detail)
  { key: 'ArrowLeft', mode: 'detail', command: 'detail.step', args: { direction: -1 }, label: 'Previous item', group: 'Navigate', repeat: true },
  { key: 'ArrowRight', mode: 'detail', command: 'detail.step', args: { direction: 1 }, label: 'Next item', group: 'Navigate', repeat: true },
  // Select
  { key: 'ArrowLeft', shift: true, mode: 'grid', command: 'grid.move-focus', args: { to: 'left', mode: 'extend' }, label: 'Extend selection', group: 'Select', repeat: true },
  { key: 'ArrowRight', shift: true, mode: 'grid', command: 'grid.move-focus', args: { to: 'right', mode: 'extend' }, label: 'Extend selection', group: 'Select', repeat: true, hidden: true },
  { key: 'ArrowUp', shift: true, mode: 'grid', command: 'grid.move-focus', args: { to: 'up', mode: 'extend' }, label: 'Extend selection', group: 'Select', repeat: true, hidden: true },
  { key: 'ArrowDown', shift: true, mode: 'grid', command: 'grid.move-focus', args: { to: 'down', mode: 'extend' }, label: 'Extend selection', group: 'Select', repeat: true, hidden: true },
  { key: 'x', mode: 'any', command: 'selection.toggle-focused', group: 'Select' },
  { key: 'a', mod: true, mode: 'grid', command: 'selection.select-all', group: 'Select' },
  { key: 'Escape', mode: 'grid', command: 'selection.clear', group: 'Select' },
  // View
  { key: 'Enter', mode: 'grid', command: 'detail.open', group: 'View' },
  { key: ' ', mode: 'grid', command: 'peek.toggle', group: 'View' },
  { key: 'Escape', mode: 'detail', command: 'detail.close', group: 'View' },
  { key: 'g', mode: 'detail', command: 'detail.close', group: 'View', hidden: true },
  { key: '+', mode: 'grid', command: 'grid.density-step', args: { direction: 1 }, label: 'Larger thumbnails', group: 'View', repeat: true },
  { key: '-', mode: 'grid', command: 'grid.density-step', args: { direction: -1 }, label: 'Smaller thumbnails', group: 'View', repeat: true },
  { key: 'l', mode: 'grid', command: 'grid.layout-toggle', group: 'View' },
  { key: 'z', mode: 'detail', command: 'detail.zoom-toggle', group: 'View' },
  { key: '+', mode: 'detail', command: 'detail.zoom-step', args: { direction: 1 }, label: 'Zoom in', group: 'View', repeat: true },
  { key: '-', mode: 'detail', command: 'detail.zoom-step', args: { direction: -1 }, label: 'Zoom out', group: 'View', repeat: true },
  { key: ' ', mode: 'detail', command: 'detail.play-toggle', label: 'Play / pause video or audio', group: 'View' },
  // Panels
  { key: 'f', mode: 'any', command: 'panels.toggle-folders', group: 'Panels' },
  { key: 'i', mode: 'any', command: 'panels.toggle-inspector', group: 'Panels' },
  // Edit
  { key: 'e', mode: 'any', command: 'inspector.edit-image', group: 'Edit' },
  { key: 'a', mode: 'any', command: 'inspector.focus-alt', group: 'Edit' },
  // Folders
  { key: 'n', mode: 'grid', command: 'folders.create', group: 'Folders', folders: true },
  { key: 'r', mode: 'grid', command: 'folders.rename', label: 'Rename current/focused folder', group: 'Folders', folders: true },
  { key: 'm', mode: 'any', command: 'folders.move-to', label: 'Move selection to folder…', group: 'Folders', folders: true },
  { key: 'ContextMenu', mode: 'grid', command: 'folders.context-menu', group: 'Folders', folders: true },
  // Files
  { key: 'u', mode: 'any', command: 'upload.pick', group: 'Files' },
  { key: 'Delete', mode: 'any', command: 'items.delete', label: 'Remove from folder (in a folder), otherwise delete', group: 'Files' },
  { key: 'Delete', shift: true, mode: 'any', command: 'items.delete', args: { fromLibrary: true }, label: 'Delete from library', group: 'Files' },
  // General
  { key: '?', mode: 'any', command: 'help.shortcuts', group: 'General' },
  { key: 'k', mod: true, mode: 'any', command: 'palette.open', group: 'General' },
  { key: 'z', mod: true, mode: 'any', command: 'undo.last', group: 'General' },
]
