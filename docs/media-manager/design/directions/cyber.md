# Direction: Adapted cyberpunk (`cyber`)

Skin: [`../prototype/css/skins/cyber.css`](../prototype/css/skins/cyber.css) ·
Screenshots: `../screenshots/direction-cyber-{grid,detail}-{dark,light}.jpg`

## Concept

The wp-upload you know, grown up. The identity stays: Orbitron display type, Rajdhani UI text, neon cyan,
blue-black chrome. It is now confined to the frame. The toolbar, folder column, inspector and inputs carry
the blue-black tint and the small HUD details. Everything that touches media is achromatic: grid gaps, tiles,
detail stage, filmstrip and inspector preview. Nothing glows at rest except the brand mark and the primary
button. Neon is a signal for focus, selection and active state, not a decoration.

## Palette

| Token | Dark | Light |
|---|---|---|
| `--surface-app` (grid gaps, centre) | `#0f0f10` neutral | `#f2f2f2` neutral |
| `--surface-stage` | `#0a0a0a` neutral | `#e9e9e9` neutral |
| `--surface-tile` | `#1c1c1c` neutral | `#dedede` neutral |
| `--surface-panel` | `#0c121b` blue-black | `#f6f9fc` cool white |
| `--surface-raised` / `--surface-overlay` | `#131b27` / `#172131` | `#ffffff` / `#ffffff` |
| `--surface-input` | `#080d14` | `#ffffff` |
| `--surface-hover` / `--surface-active` | white 6% / 10% (neutral alpha) | black 4.5% / 8% |
| `--text-1` / `--text-2` / `--text-3` | `#e4eef8` / `#a8bdd2` / `#7d94ab` | `#0a1726` / `#33495f` / `#56697d` |
| `--text-on-accent` | `#03060b` | `#ffffff` |
| `--text-accent` | `#5ff1ff` | `#005a8f` |
| `--line-1` / `--line-2` | `rgb(127 163 202 / .14 / .26)` | `rgb(10 40 80 / .10 / .20)` |
| `--accent` / `--accent-hover` | `#00e5ff` / `#4df4ff` | `#006fb0` / `#005c93` |
| `--accent-subtle` / `--accent-line` | cyan 10% / 45% | `rgb(0 140 210 / .10)` / `rgb(0 111 176 / .42)` |
| `--focus-ring` = `--select-ring` | `#00e5ff` | `#006fb0` |
| `--select-tint` | white 4% (neutral) | black 4% (neutral) |
| `--ok` / `--warn` / `--danger` / `--info` | `#3ddc97` / `#ffc857` / `#ff5c7a` / `#4df4ff` | `#0f7b4a` / `#966300` / `#c8203f` / `#006fb0` |

The dark accent is the brand neon (`#00e5ff`, neon-5). The light accent is a deep cyan-blue between neon-7
and neon-8, so it passes AA with white text. The brand mark keeps a pure gradient from the brand tuple in both
themes.

## Type

- **UI:** Rajdhani 500/600/700. Rajdhani is narrow with a small x-height, so this skin shifts every size up
  one step (`--fs-11` → 12 px, `--fs-12` → 13, `--fs-13` → 14, `--fs-14` → 15, `--fs-16` → 17, `--fs-20` →
  21, `--fs-24` → 26). It also maps regular/medium/semibold to 500/600/700, because Rajdhani 400 is too thin
  at 12–14 px. At these settings, labels, meta rows and chip counts read cleanly at 1× and 2×.
- **Display:** Orbitron, uppercase, tracking 0.14 em for the wordmark. Panel and section titles are 10.5 px,
  weight 600, tracking 0.16 em, preceded by a small skewed accent tick (`/ FOLDERS`, `/ FILE`). The primary
  button label and folder-summary stat numbers also use Orbitron. File names and body copy never use it.
- **Mono:** Share Tech Mono (kbd only).

## Shape, motion, glow

- **Shape:** near-square corners (2–6 px). `--radius-pill` is 3 px, so chips and badges are squared off
  rather than pills. Tiles are square-cornered, with a 2 px gap.
- **Motion:** the brief's timings (100/150/220 ms, 260 ms morph), with a sharper expo-out ease for a
  "snappy" HUD feel.
- **Glow budget:** only the brand mark, the primary button (`--glow-accent`), keyboard focus on controls,
  active chips/toggles, the open folder row (left edge bar + inner glow, echoing today's
  `.cyber-folder-row`), the selected tile (ring + inner glow confined to the tile's own margin) and the
  current filmstrip frame glow. Dark only: pressed icon buttons get an icon drop-shadow.
- **Chrome texture:** the toolbar has faint 3 px scanlines (dark only) and a cyan hairline along its bottom
  edge that fades out at both ends. The selection bar gets a cyan wash.

## Contrast (WCAG 2.x)

| Pair | Dark | Light |
|---|---|---|
| text-1 on panel / app | 16.0 / 16.3 | 17.1 / 16.1 |
| text-2 on panel / app | 9.7 / 9.9 | 8.8 / 8.3 |
| text-3 on panel / app / raised | 6.0 / 6.1 / 5.5 | 5.4 / 5.1 / 5.7 |
| text-on-accent on accent | 13.2 | 5.4 |
| text-accent on panel / on accent-subtle (active chip, folder) | 13.9 / 11.5 | 7.0 / 6.2 |
| focus ring vs panel / app / stage / tile | 12.2 / 12.5 / 12.9 / 11.1 | 5.1 / 4.8 / 4.4 / 4.0 |
| warn as text on panel | 12.2 | 4.9 |
| danger as text on panel | 6.3 | 5.3 |
| "Alt" badge label on its fill | 12.0 | 11.5 |

Every text pair meets AA at 4.5:1, and every focus/selection ring meets 3:1 against all surfaces.

## How imagery is protected

- The grid gaps (`--surface-app`), the tile fill, the detail stage, the inspector preview letterbox and the
  filmstrip strip are all achromatic. The blue-black tint ends at the panel borders.
- `--surface-hover`, `--surface-active` and `--select-tint` are neutral white/black alphas. Hover never tints
  a photo, nor the SVG checkerboard, which uses `--surface-hover`.
- The selected tile's glow is an *inset* shadow, so it only lights the tile's own margin around the shrunk
  image. It never bleeds onto neighbouring images across the 2 px gap.
- Neon appears only in chrome, and in rings and checks at the image edge.

## Strengths and risks

- **Strengths:** instantly recognisable as wp-upload. The chrome has character, yet the grid reads like a
  photo tool. Rajdhani at the bumped sizes is surprisingly compact for dense inspector metadata. The light
  theme keeps the identity (wordmark, diamond, edge line, ticks) without neon-on-white glare.
- **Risks:** this direction needs three web fonts (≈ 90 kB), and Orbitron's width limits it to short labels.
  Rajdhani's digits are narrow, so long numbers can feel cramped. The light theme is the least distinctive of
  the two. Cyan focus on cyan selection relies on the extra `--surface-app` gap ring to stay distinguishable.
  Users who disliked the old neon may still find the dark toolbar busy, but the scanlines can be dropped at no
  cost.

## Markup and contract changes worth considering (not implemented)

1. **`--surface-filmstrip` token.** The filmstrip uses `--surface-panel`, which is tinted chrome in this
   skin. It is neutralised here with a scoped override. A token would make that intent explicit for every
   skin.
2. **Warn fill vs warn text.** `.badge--warn` uses `--warn` as a fill with a hard-coded dark label, while
   `.field__hint` uses `--warn` as text. No single light amber passes AA for both uses. This skin overrides the
   badge fill. A `--warn-fill` / `--text-on-warn` pair would remove the override.
3. **Brand mark element.** A real SVG mark (or a `data-` hook on the brand) would allow the actual unicorn
   or wordmark instead of the CSS diamond.
4. **Fonts.** Production should self-host Rajdhani and Orbitron (subset, `font-display: swap`), rather than
   use the `@import` from Google Fonts that this prototype skin relies on.
