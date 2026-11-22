# Direction: Pro tool

Skin: [`prototype/css/skins/pro-tool.css`](../prototype/css/skins/pro-tool.css) ·
screenshots: `screenshots/direction-pro-tool-{grid,detail}-{dark,light}.jpg`

## Concept

The Lightroom / Immich kind of calm. The tool gets out of the way and the photos are the only colour on
screen. The chrome uses true neutral greys (OKLCH chroma 0.000 on stage, tile and app) on an evenly
stepped surface scale. One restrained indigo-blue accent marks selection, focus and the primary action,
and nothing else. Borders are hairlines, elevation is soft and there is no glow. The interface feels
quiet, precise and professional, and it stays that way after hours of use.

## Palette

| Token | Dark | Light | Note |
|---|---|---|---|
| `--surface-stage` | `#0b0b0b` | `#e8e8e8` | Detail stage *and* filmstrip, so the viewer reads as one surface |
| `--surface-app` | `#121212` | `#f3f3f3` | Grid canvas |
| `--surface-panel` | `#181818` | `#fbfbfb` | Toolbar, folders, inspector |
| `--surface-input` | `#1d1d1d` | `#ffffff` | |
| `--surface-tile` | `#1f1f1f` | `#e3e3e3` | Placeholder before an image loads |
| `--surface-raised` / `-overlay` | `#222222` / `#282828` | `#ffffff` / `#ffffff` | |
| `--surface-hover` / `-active` | white 5.5 % / 9 % | black 4.5 % / 7.5 % | |
| `--text-1` / `-2` / `-3` | `#e6e6e6` / `#a6a6a6` / `#8c8c8c` | `#171717` / `#4a4a4a` / `#666666` | |
| `--accent` | `#8ea8f2` | `#3653c9` | Pastel periwinkle in dark, deep indigo-blue in light |
| `--accent-hover` | `#a5baf5` | `#2d47b0` | |
| `--text-accent` | `#aec2f7` | `#2f4ab8` | |
| `--text-on-accent` | `#0d1426` | `#ffffff` | |
| `--focus-ring` | `#b4c6f8` | `#3653c9` | |
| `--select-ring` / `--select-tint` | `#8ea8f2` / white 7 % | `#3653c9` / black 6 % | The tint is **neutral**: a lighter or darker cell, as in Lightroom, never blue behind a photo |
| `--line-1` / `-2` | white 7 % / 13 % | black 8 % / 14 % | |
| `--ok` / `--warn` / `--danger` | `#6cc28c` / `#e3b44f` / `#ef7b7b` | `#1d7a47` / `#975c0b` / `#c43535` | Slightly desaturated so they sit with the chrome |

## Type

- **Inter** (variable, with the `opsz` axis) for all UI text. It was drawn for screens at 11–14 px, with a
  tall x-height, open apertures and true tabular figures. That suits dense counts, sizes and dates. It is
  the de-facto "pro tool" voice (Linear, Figma), and unlike a system font stack it renders the same on
  every OS. Its `cv05` alternate (an "l" with a tail) is enabled, so `l`, `I`
  and `1` stay distinct in file names. Tracking is −0.003em for body text and −0.01em for the wordmark.
- **JetBrains Mono** for `kbd` and other monospace text. It has clear key glyphs at 11 px.
- The sizes keep the contract scale (11–24 px). Panel headers and section titles keep the shared uppercase
  11 px / 600 / +0.08em micro-labels in `--text-3` (≥ 5.2:1), which stay legible. Field labels are
  dropped to `--text-3`, so values outrank labels, as in Lightroom.

## Shape and motion

- The radii are small and precise: 3 / 5 / 7 / 10 px. Tiles are square-cornered, and a selected tile
  insets to 90 % with a 3 px radius.
- The grid gap is **2 px**, so the photos form one surface.
- Filter chips become borderless toggles with a 5 px radius, closer to a segmented control than to tags.
  Pressed toolbar toggles use a neutral fill, not the accent, so the accent stays scarce.
- The brand mark is a neutral aperture ring (`--text-1`) rather than an accent square.
- Motion is quick and functional: 90 / 140 / 200 ms, with a 240 ms morph. Enter uses an ease-out-quint
  curve and exit uses a standard ease-in. Under reduced motion, base.css's override still applies.

## Contrast (WCAG 2.x)

Checked with `scripts/token-report.mjs` (no failures, chroma 0.000 on every image surround) plus extra
pairs:

| Pair | Dark | Light |
|---|---|---|
| text-1 on panel / app | 14.2 / 15.0 | 17.3 / 16.2 |
| text-2 on panel / app | 7.3 / 7.7 | 8.6 / 8.0 |
| text-3 on panel / app / stage | 5.3 / 5.6 / 5.9 | 5.6 / 5.2 / 4.7 |
| text-3 on input / raised | 5.0 / 4.7 | — (white: 5.7) |
| text-on-accent on accent / accent-hover | 7.9 / 9.6 | 6.5 / 8.0 |
| text-accent on panel / on accent-subtle row | 10.0 / 8.2 | 7.3 / 6.4 |
| focus-ring vs app / panel / stage | 11.0 / 10.5 / 11.6 | 5.9 / 6.3 / 5.3 |
| select-ring vs selected cell (tint) | 6.8 | 5.2 |
| warn text on panel | 9.2 | 5.3 |

## Strengths

- It is the most "invisible" chrome of the three directions. Thumbnails keep their real colour, because
  even the selection tint is neutral.
- The accent is rare, so it reads instantly as "selected / focused / do this".
- The light theme is first-class, not an inverted afterthought, and both themes pass AA everywhere.
- It maps cleanly onto Mantine: neutral `gray` scale, an `indigo`-like primary, and Inter as the theme
  font.

## Risks

- It is quiet to the point of anonymity. It keeps nothing of the current brand identity, and the
  wordmark alone carries "wp-upload".
- The pastel dark accent is calm, but less vivid than users of the current neon theme expect.
- The hairline input borders (7–8 % alpha) are elegant but below 3:1 against the panel. The inputs still
  read through their fill and placeholder, but a stricter reading of WCAG 1.4.11 would want stronger field
  edges.
- Google Fonts is an external request. A production build should self-host Inter.

## Markup changes I'd want (not implemented)

- **A neutral "stage colour" switch** (black / grey / white) in the detail bar, as with Lightroom's
  lights-out. It needs a control, plus a `data-stage` attribute that overrides `--surface-stage`.
- **Middle-truncated file names**, such as `portrait-cornelia…337.jpg`. This needs JS or split markup,
  because CSS can only truncate at the end.
- **An EXIF strip under the inspector heading** (camera · lens · f/ · s · ISO in mono). That is a
  signature pro-tool detail, and it needs the data in the inspector markup.
- **A `.badge--warn` text colour token** (e.g. `--text-on-warn`). The shared CSS hard-codes `#1a1300`,
  which fails on a deep light-theme amber. The skin currently overrides it to white, scoped to this
  direction.
