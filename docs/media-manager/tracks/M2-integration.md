# M2 integration

M2 (plan §7) merged two tracks:
- [M2-slice](M2-slice-handoff.md): client glue, per-component Mantine CSS (D31), and the vertical slice
  of grid → detail → editing alt text;
- [M2-followups](M2-followups-handoff.md): the plugin, server and dev-stack changes from the M1 review
  decisions.

Each track's own handoff note has the detail. This note records the integration.

## Merged

- **Branches:** `mm/m2-followups`, then `mm/m2-slice`, then each one's review-fix commits. There were no
  conflicts.
- **The orchestrator's part:**
  - plugin version `1.0.0-dev.5`, with changelog lines from the follow-ups handoff;
  - the `plugin-api.md` §5.10 wording for Visual Portfolio's placeholder (CR-1 of the follow-ups
    handoff);
  - the C2 spike harness (`client/src/media-manager/app/spikes/`) deleted.

## Independent reviews

Two high-effort reviews found no critical issues. All findings are fixed, each with a test where one can
reach it:

| Review | Findings | Where the fixes are listed |
|---|---|---|
| Client slice | 2 important, 13 minor | M2-slice handoff §4a |
| Backend follow-ups | 3 important, 6 minor | M2-followups handoff §7 |

The important ones:
- The LAN-HTTPS mock command for the iPad feel review failed. It is fixed and checked on this machine.
- Esc during a save committed the text instead of reverting it.
- A plugin update didn't trigger the usage rescan.
- The `[gallery]` hooks ran full-table scans per event.
- With a persistent object cache, attach and detach could be re-indexed from stale results.

## Gate

From a clean state: `dev/run down --volumes`, `up test`, `seed small`, `test all`. Exit 0.

| Suite | Result |
|---|---|
| lint, typecheck | pass |
| unit | server 806, client 675 (51 files), plus the dev script tests |
| plugin-static | pass (PHP 7.4, 8.1 and 8.4 lint; PHPStan level 8) |
| plugin-contract | 208 passed, 1 skipped, in each of the `plugin`, `oldest` and `mu-plugin` installs |
| server-live | 49 passed |
| e2e-mock, e2e-live | 12 and 12: the smoke tests and the slice flows, in both colour schemes, with axe |

- **The one skip:** a role-switch fallback that only applies to stacks without a separate Author user.
- **Bundle:** the initial media-manager chunk is 145.3 kB of the 150 kB budget (D31).

## Core API freeze

From now on, `core/`, `app/` and `shell/` belong to the orchestrator. The frozen surface is listed in the
M2-slice handoff §3. Wave A tracks request changes through change requests.

## Feel review (D47)

The steps are in the M2-slice handoff §2: the mock at 50k items with real photos, served over HTTPS on
the LAN for an iPad that trusts the dev CA.

## Open questions

Decided at the M2 review as D49–D51 (plan §0): 1 kept as built, 2 kept collapsed, 3 and 4 kept.

From the slice:
1. While offline, Retry is refused and the fields turn read-only, though the typed text stays. Keep
   that, or let Retry try anyway?
2. At 900–1199 px (an iPad in landscape) the inspector starts collapsed, as the spec says, so the alt
   field is hidden by default there. Fine for v1?

From the follow-ups:

3. Kept sub-size files pile up over repeated replaces with different aspect ratios (D38). Fine for v1?
4. Should the `[gallery id=N]` handling, which shows another post's attached images, stay?

Carried into later waves:
- Author folder counts at 50k are untimed (perf runs as the Editor).
- The Replace confirm wording for kept sizes and the placeholder's where-used ref (M2-followups CR-3)
  go to the wave-A and wave-B tracks that own the inspector and the editor.
- The inspector's "Unsaved changes" note ignores typing done during a save.
- Drop the old page's Google Fonts link in M5.
