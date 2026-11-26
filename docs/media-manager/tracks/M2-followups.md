# Track M2-followups: plugin, server and dev-stack changes from the M1 decisions

Follows the rules in [README.md](README.md). It runs in parallel with [M2-slice.md](M2-slice.md), which
owns the client.

**Goal:** apply the M1-review decisions that need backend or tooling changes (plan §0, the rows marked
*M2 task*). Also close the "`wp eval` only on the host" gap, so the whole contract suite runs in the
runner and in CI.

**You own:**
- `plugin/**`, except the entry file's version constants. **Never bump versions**: the orchestrator
  bumps them at merge time. Propose changelog lines in your handoff note.
- `server/src/lib/library/jobs.ts` and `server/src/routes/library/images.ts`, with their specs.
- `dev/**` and `.github/workflows/media-manager.yml`.
- **Contract wording,** additive and clarifying only: `docs/media-manager/contracts/plugin-api.md`
  §5.15–5.16 and §8.2 (and `server-api.md` if a change surfaces there). Plus `shared/` if a type or
  schema has to follow.
- Your handoff note `M2-followups-handoff.md`.

**Deliverables, each with tests:**

1. **D38: replace keeps old sub-size files** whose dimensions no longer exist after a replace with a new
   aspect ratio.
   - They're deleted with the item, and never served as current sizes.
   - Update the §5.15 wording, so the client's Replace confirm can mention it.
2. **D40: a `[gallery]` shortcode without ids** counts the post's attached images (`post_parent`) as
   `shortcode-gallery`. The usage index must stay current when an image is attached or detached.
3. **D41: an Author's folder counts follow the collection's visibility rule** (`count`, `counts.all` and
   `counts.uncategorized`), so they match what the Author sees. Update §5.16.
4. **D44: Visual Portfolio's "no image" placeholder attachment** (`vp_general['no_image']`) is reported
   as used by Visual Portfolio.
5. **D48(3): a large regenerate releases its concurrency slot between items,** so uploads interleave.
   Keep the job's progress and the per-item results.
6. **D46: the `[perf]` CI job is report-only.** It records and uploads the numbers without failing.
   Local runs keep enforcing the budget.
7. **D48(4): `dev/run` derives the oldest supported plugin tag** from the server's required API level
   (`PLUGIN_API_REQUIRED`), so it no longer has to be raised by hand.
8. **Run every contract test in the runner.** Add a local-only, admin-only eval or lifecycle route to the
   dev mu-plugin (never shipped). The ~28 contract tests that need `wp eval` then run inside the runner
   and in CI, not only on the host. Keep it inert outside `WP_ENVIRONMENT_TYPE=local`.

**Gate:** `dev/run test all` passes from a clean state. `plugin-contract` must now report no skips
caused by the host-only `wp eval`, except where a variant genuinely can't apply.
