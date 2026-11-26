# Track M2-slice: client glue, Mantine CSS, and the vertical slice

Follows the rules in [README.md](README.md). This is plan §7, milestone M2: one client agent, carrying
on from F1.

**Goal:** wire the client foundation together and build the first vertical slice end to end, against the
mock and against the real stack: grid → detail → editing alt text.

**You own:**
- `client/src/media-manager/**`, including `core/`, `app/`, `shell/`, `theme/`, `test/`, and
  `features/{grid,detail,inspector}`. The other `features/*` stubs keep their exported names.
- `client/vite.config.ts`, `client/vite.mock.config.ts`, `client/vitest.config.ts` and
  `client/scripts/**`.
- `e2e/{mock,live}/slice*.spec.ts`, plus helpers you add under `e2e/support/`.
- Your handoff note `M2-slice-handoff.md`.

**Not yours:** `server/`, `plugin/`, `shared/`, `dev/` and the package files. Anything there needs a
change request. The follow-ups track ([M2-followups.md](M2-followups.md)) works on `plugin/`, `server/`
and `dev/` in parallel.

**Read first:**
- the plan's §0 decisions, especially D16, D31, D33–D36 and D45–D47;
- `tracks/M1-integration.md` §5 (behaviour changes) and **§6 (the 12 glue items)**;
- the F1, F2 and F3 handoffs;
- spikes C1–C5;
- `design/interaction-spec.md` §1–§6, §8–§10, and `design/specs/inspector.md` §2–§3.

**Deliverables, in order:**

1. **Glue:** all 12 items in `M1-integration.md` §6.
   - F2's data layer replaces F1's `TEMPORARY (M1)` seams.
   - F3's `MediaManagerThemeProvider` replaces the bare provider, with the storage key
     `wpu-mm-color-scheme`. The colour scheme follows the OS by default, with a manual override.
   - The rest: one connectivity source, session gate calls on login and logout, one collection decode,
     one `useItem`, query keys from F2, `LibraryError` from uploads, `useRevPolling` mounted once, F3's
     layout tokens, Orbitron, and browser-mode specs for the shell.
2. **D31: per-component Mantine CSS** instead of `@mantine/core/styles.css`.
   - The initial media-manager chunk must stay within the 150 kB gzip budget. `test/bundle-budget.spec.ts`
     enforces it.
   - Report the before and after numbers.
3. **The vertical slice** (plan §7, M2 scope):
   - **Boot:** checks the plugin first, then shows Onboarding (placeholder) or the shell.
   - **A justified, virtualised grid,** driven by `?folder=&q=&sort=`.
     - Reuse spike C1: `justifiedLayout.ts` and the `VirtualJustifiedGrid` wiring, keeping the four
       rules from C1.md.
     - Click and arrow-key selection and focus, with the tiles as `gridcell`s.
     - Real thumbnails from the item's sizes/srcset, with a placeholder of reserved size and no layout
       shift.
   - **Detail mode:**
     - Enter or double-click opens it with the morph (spike C2's rules), and `?item=` pushes a history
       entry. Back and Esc and `G` leave it.
     - `←`/`→` step through the collection, stopping at both ends (D34).
     - The stage shows the right sub-size, and the filmstrip can wait for wave A.
   - **The inspector, for one item:**
     - Title and Alt fields with autosave: Unsaved → Saving… → Saved ✓, or "Not saved · Retry".
       `Ctrl/Cmd+Enter` commits, `Esc` reverts.
     - An optimistic patch through F2's data layer, with rollback.
     - A draft that survives re-renders.
   - **Both themes,** and the app must work under the `/wp-upload/` sub-path.
4. **Tests:**
   - unit and browser-mode specs for the slice;
   - e2e slice flows in **mock and live** mode (live means the production image under `/wp-upload/`,
     against the compose WordPress), in both colour schemes, with axe clean on each screen;
   - `dev/run test all` passes.
5. **For the owner's feel review** (D47), document in your handoff:
   - how to open the mock at 50k items with real photos (`?mock-scenario=large&mock-images=picsum`);
   - how to serve it so the owner can open it from another device on the same network
     (`WPU_BIND_ADDRESS`).

   The owner reviews on an iPad.
6. **Core API freeze:** at the M2 gate, `core/`, `app/` and `shell/` pass to the orchestrator. List
   every exported foundation API in your handoff, as the frozen surface wave A builds on.
