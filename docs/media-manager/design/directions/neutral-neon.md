# Direction: Neutral + neon

Skin: [`../prototype/css/skins/neutral-neon.css`](../prototype/css/skins/neutral-neon.css). Screenshots:
`../screenshots/direction-neutral-neon-{grid,detail}-{dark,light}.jpg`.

## Concept

Today's brand, distilled. The chrome is **achromatic**: near-black greys in dark and near-white greys in
light, with no blue tint. The cyan neon (`#00e5ff`) from the current app survives only as a **signal**. It
marks the brand mark, the primary action, keyboard focus, selected tiles, the active chip, the active
folder and the active inspector tab. Everything else stays grey, so the photos are the only colour on
screen and the neon always means "this is where you are / what you picked".

Neon discipline rules the skin enforces with scoped decoration:

- Toggle *state* (layout switch, panel toggles) is neutral (`--surface-active`), not neon.
- The density slider is grey, because it is a setting, not a signal.
- The selection bar keeps the neutral toolbar. It gets a 2 px neon underline and a neon count instead of
  a tinted background.
- `--select-tint` behind a selected (shrunk) tile is neutral white/black at 4–5 %, so no cyan sits next to
  the photo. Only the ring and the check badge carry the accent.
- In the filmstrip, "current" is a neutral `--text-1` ring in both themes. Selection shows via the check.

## Palette

| Token | Dark | Light |
|---|---|---|
| `--surface-app` | `#0d0d0d` | `#f4f4f4` |
| `--surface-panel` | `#141414` | `#ffffff` |
| `--surface-raised` / `-overlay` | `#1c1c1c` / `#222222` | `#ffffff` / `#ffffff` |
| `--surface-stage` | `#080808` | `#ebebeb` |
| `--surface-tile` | `#1d1d1d` | `#e6e6e6` |
| `--surface-input` | `#101010` | `#ffffff` |
| `--text-1` / `-2` / `-3` | `#f2f2f2` / `#b3b3b3` / `#8f8f8f` | `#111111` / `#4a4a4a` / `#6b6b6b` |
| `--accent` (fills) | `#00e5ff` | `#00d4ec` |
| `--accent-hover` | `#5cefff` | `#00c2da` |
| `--text-on-accent` | `#002a30` | `#00262b` |
| `--text-accent` | `#00e5ff` | `#007485` |
| `--focus-ring` / `--select-ring` | `#00e5ff` | `#008a9e` |
| `--accent-subtle` | cyan @ 10 % | `rgb(0 180 205 / .1)` |
| `--ok` / `--warn` / `--danger` | `#3ddc84` / `#ffc247` / `#ff5c6c` | `#17803d` / `#a86400` / `#c8283a` |
| `--info` | `#00e5ff` | `#007485` |

The light theme **splits the neon in two**. Fills stay bright (`#00d4ec`) with dark text on them, so the
Upload button still reads as the brand neon. Text, focus and selection rings use a deeper teal
(`#007485` / `#008a9e`), because cyan on white fails contrast (`#00d4ec` on white is 1.8:1).

## Type

- **Geist** (UI, 400/500/600): a modern geometric grotesk with crisp, technical letterforms. It feels
  closer to the brand's tech edge than Inter while staying neutral and very legible at 12–13 px. Its
  tabular figures work for counts and sizes.
- **Geist Mono** (via `--font-display` and `--font-mono`): used for the small uppercase section labels
  (FOLDERS, INFO, FILE), counts, the filter summary and the detail index (`90 / 93`). This gives an
  "instrument label" feel that echoes the old cyber identity without any colour.
- **Orbitron** is reserved for the `.brand` wordmark (uppercase, +0.06 em), set by a scoped rule.

## Shape and motion

- Radii are 4 / 6 / 10 / 14 px. Tiles have 2 px corners with a 2 px grid gap, so the grid reads as one
  surface. Selected tiles shrink to 0.9 with 8 px corners.
- The brand mark is a neon gradient "viewfinder" (a cyan to blue frame with a panel-coloured centre).
- `--glow-accent` is a 1 px halo plus a 12 px blur in dark, and only a soft lift in light. It is used on
  the primary button, the brand mark and the selected-tile check only.
- Focused controls get the outline plus a 4 px `--accent-subtle` halo. Selected tiles in dark get a faint
  inner glow.
- Motion is short and crisp: 90 / 150 / 220 ms, with a 260 ms morph. Enter uses an expo-out curve
  (`cubic-bezier(.16,1,.3,1)`) and exit `cubic-bezier(.5,0,.75,0)`.

## Contrast (WCAG 2.x)

| Pair | Dark | Light |
|---|---|---|
| text-1 on panel / app | 16.5 / 17.4 | 18.9 / 17.2 |
| text-2 on panel / app | 8.8 / 9.3 | 8.9 / 8.1 |
| text-3 on panel / app | 5.7 / 6.0 | 5.3 / 4.85 |
| text-3 on raised / input | 5.3 / 5.9 | 5.3 / 5.3 |
| text-on-accent on accent | 9.9 (hover 11.1) | 8.9 (hover 7.4) |
| text-accent on panel | 12.0 | 5.5 (4.96 on accent-subtle) |
| focus ring vs panel / app | 12.0 / 12.6 | 4.1 / 3.7 |
| select ring vs tile | 11.0 | 3.3 |
| white check on select ring (light) | — | 4.1 (icon, ≥ 3) |
| warn / ok / danger text on panel | 11.5 / 10.3 / 6.1 | 4.7 / 5.0 / 5.5 |

All text pairs pass AA (4.5) and all focus/selection pairs pass 3.0. The weakest pairs are light text-3
on `#f4f4f4` (4.85) and the light select ring on the grey tile placeholder (3.3).

## Strengths

- It is clearly the same product as today's app, but the photos now own the colour.
- The neon has one meaning (signal), so a glance finds focus, selection and the primary action.
- The Mono labels add character without adding chroma.

## Risks

- Bright cyan fills in light mode can look "toy-like" next to the teal text. Without the 1 px teal edge
  added to `.btn--primary`, the fill would barely separate from white.
- Two cyans in light (fill vs. ring) need discipline in future components.
- Fonts load from Google Fonts, so the real app should self-host Geist and Orbitron.

## Markup or shared-CSS changes I'd want (not implemented)

- Shared `.badge--warn` uses `--warn` as a fill with fixed dark text. Light `--warn` must be dark enough
  for text on white, which is then too dark for a fill. The skin overrides the badge fill to `#ffc247`.
  A `--warn-fill` / `--text-on-warn` token pair would remove that override.
- `.input:focus-visible` uses `--accent` for its border. In light that is the bright fill colour (1.8:1),
  so the skin overrides it to `--focus-ring`. A dedicated token (or using `--focus-ring` in shared CSS)
  would be cleaner.
- `.filmstrip .tile.is-current` and the selected ring compete for the same `box-shadow`. A separate
  current marker (e.g. an underline element) would let both show at once.
- A wordmark element (`.brand__name`) would allow styling the text apart from the mark without
  overriding `.brand` wholesale.
