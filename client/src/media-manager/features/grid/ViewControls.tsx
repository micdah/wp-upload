// The toolbar's layout and density controls (interaction-spec §2, §6): a
// segmented Justified / Square toggle (`L`) and the thumbnail-size slider
// (`+` / `-`). Both write the URL (replacing the entry, D16); the grid keeps
// the focused tile anchored across the re-layout (spike C1).
//
// Native controls rather than Mantine's SegmentedControl and Slider keep the
// initial chunk inside its budget (D31). The slider is `data-mm-local-keys`:
// its arrow keys change the size and must not also move the grid's focus.

import { Tooltip } from '@mantine/core'
import { JustifiedIcon, SquareIcon } from '../../core/ui/icons'
import { DENSITY_SIZES, type Density, MAX_DENSITY } from '../../core/url/codec'
import { urlStore, useUrlState } from '../../core/url/useUrlState'
import classes from './Controls.module.css'

const LAYOUT_OPTIONS = [
  { value: 'justified', label: 'Justified layout', Icon: JustifiedIcon },
  { value: 'square', label: 'Square layout', Icon: SquareIcon },
] as const

export function ViewControls() {
  const layout = useUrlState((state) => state.layout)
  const density = useUrlState((state) => state.density)
  return (
    <div className={classes.viewControls}>
      {/* biome-ignore lint/a11y/useSemanticElements: two toggle buttons, not a fieldset */}
      <div className={classes.segmented} role='group' aria-label='Layout'>
        {LAYOUT_OPTIONS.map(({ value, label, Icon }) => (
          <Tooltip
            key={value}
            label={`${label} (L)`}
            openDelay={400}
            withinPortal
          >
            <button
              type='button'
              className={classes.segment}
              aria-label={label}
              aria-pressed={layout === value}
              onClick={() => urlStore().navigate({ layout: value })}
            >
              <Icon size={18} aria-hidden />
            </button>
          </Tooltip>
        ))}
      </div>
      <Tooltip label='Thumbnail size (+ / -)' openDelay={400} withinPortal>
        <input
          type='range'
          className={classes.density}
          data-mm-local-keys=''
          min={0}
          max={MAX_DENSITY}
          step={1}
          value={density}
          aria-label='Thumbnail size'
          aria-valuetext={`${DENSITY_SIZES[density]} px`}
          onChange={(event) =>
            urlStore().navigate({
              density: Number(event.currentTarget.value) as Density,
            })
          }
        />
      </Tooltip>
    </div>
  )
}
