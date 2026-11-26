# Wave A (M3): rules shared by tracks A1–A4

Read this together with [README.md](README.md) and your own brief ([A1](A1.md), [A2](A2.md), [A3](A3.md),
[A4](A4.md)). Wave A builds the breadth of the four central areas on top of the M2 slice. The four tracks
run in parallel, each in its own worktree branched from `feature/media-manager`.

## Read first

- **Plan §0, all decisions,** especially D16, D19–D25, D31, D33–D37, D41–D45, D47 and D49–D52.
- **The design docs for your area:**
  - [interaction-spec.md](../design/interaction-spec.md);
  - your area spec in [design/specs/](../design/specs/) (folders, inspector, system);
  - [screens.md](../design/screens.md);
  - the prototype in `design/prototype/` as the behavioural reference.
- **The contracts:** [server-api.md](../contracts/server-api.md) and
  [plugin-api.md](../contracts/plugin-api.md).
- **The frozen core API:** [M2-slice-handoff.md](M2-slice-handoff.md) §3, with the signatures in the F1
  and F2 handoffs.
- **The M2 lessons:** M2-slice handoff §8, M2-integration.md, and the iPad notes below.

## Ownership

- **You own** `client/src/media-manager/features/<your areas>/**`, plus these per-track files:
  - `client/src/media-manager/core/data/<area>.ts` (your area's queries and mutations);
  - `client/src/media-manager/mocks/handlers/<area>.ts`;
  - `e2e/mock/<track>*.spec.ts` and `e2e/live/<track>*.spec.ts`;
  - your handoff note, `docs/media-manager/tracks/<track>-handoff.md`.
- **`core/`, `app/` and `shell/` are frozen** and belong to the orchestrator. If you need a change
  there (a new command declaration, a store field, a shell slot, a CSS token), write a precise change
  request in your handoff with an exact diff. Don't edit those folders.
  - The exception is TypeScript module augmentation of `core/commands/registry` (`CommandMap`) and
    `OverlayRegistry`, declared from your own files. That's how features add commands.
- **Not yours:** other tracks' feature folders, `server/`, `plugin/`, `shared/`, `dev/`, and the
  package files. If the backend lacks something you need, write a change request. The orchestrator
  routes it.

## Hard rules

- **Keyboard shortcuts:** `event.key`, and keys typable on US and DK layouts only (letters, digits,
  `, . - + ?`, named keys, Ctrl/Cmd+letter). Register them through `registerBindings`. Most are already
  declared in `DEFAULT_BINDINGS`; implement the commands.
- **Sub-path safety:** relative URLs only.
- **The bundle budget** (D31): the initial media-manager chunk must stay ≤ 150 kB gzip
  (`test/bundle-budget.spec.ts`). Load heavy, rarely used UI lazily: dialogs, menus, panels.
- **iPad lessons from M2,** where the owner reviews on an iPad Pro with a Magic Keyboard:
  - **Never** put `user-select: none` on anything the user clicks or focuses. It stops a trackpad click
    from handing the page the keyboard. Mark chrome regions `data-mm-no-select` instead; the
    `core/ui/noSelect` guard and `selectionchange` cleanup handle them.
  - Only purely decorative icons inside buttons may be `-webkit-user-select: none`.
  - Use `touch-action: manipulation` on controls.
  - React: no `flushSync` inside lifecycles. Tests use `failOnReactWarnings()`.
- **Accessibility:** ARIA roles per interaction-spec §10, focus return, the single polite live region
  (`announce`), and axe clean in both themes.

## Tests and gate

- **Every behaviour gets a test:** unit tests for pure logic, browser-mode specs for components (use
  `renderLibrary` and the fake library), and e2e flows in **mock and live** mode, in both colour schemes,
  with axe.
- **Before handing back:**
  - `npm run check` and `npm run typecheck -w client -w e2e`;
  - `npm run test -w client`;
  - the bundle budget;
  - `dev/run test plugin-static`, then `dev/run up test`, `dev/run seed small`, then
    `dev/run test e2e-mock e2e-live`.
- **Helpers:** any helper runs at effort **high**. Wait for every helper to report before you hand
  back; never hand back with helpers still running.

## Merge order and handoff

- **Merge order:** A1 → A2 → A4 → A3. A3's drag and drop touches tile behaviour last.
- **Your handoff covers:**
  - what works, with commands;
  - the tests and gate results;
  - change requests;
  - deviations;
  - open questions;
  - the branch and commit list.
