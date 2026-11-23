# Track D (M1): dev/test environment, continued

Follows the rules in [README.md](README.md). Your M0 work is merged, and your M0 handoff note is
[D-handoff.md](D-handoff.md).

**Goal:** finish the local Docker environment so every gate suite can run in `test` mode, locally and in
CI (plan §5–§6, D18).

**You own:** `dev/**`, `.github/workflows/media-manager.yml`, `e2e/playwright.config.ts`,
`e2e/tsconfig.json`, `e2e/support/**`, and your handoff note `D-m1-handoff.md`.

**Deliverables, in order:**

1. **D26: a separate Author user.** `up` creates both the Editor app user and an Author app user (each
   with an app password), and writes both to `dev/.env.wp` and the runner env. The `role=` variant stays
   for the `app` container's user.
2. **D22 / spike X10: Visual Portfolio.**
   - Install Visual Portfolio 3.11.0, pinned with a sha256 check, active by default. Add a variant
     `vp=on|off`.
   - Extend the `small` seed, deterministically, with:
     - a post with a `visual-portfolio/block` image gallery;
     - a saved layout (`vp_lists` with `vp_images`) embedded in one post by the `visual-portfolio/saved`
       block and in another by the `[visual_portfolio id=N]` shortcode;
     - if the plugin has one, a loop-gallery block using `imagesQuery.images`.
   - Record in your handoff note exactly where each stores the attachment ids. That is the dev half of
     spike X10; P2 builds the parser.
3. **The e2e workspace config:**
   - `e2e/playwright.config.ts` with projects for `mock` (`WPU_MOCK_URL`) and `live` (`WPU_APP_URL`, the
     production image under `/wp-upload/`), `--trace off` by default, and results into
     `WPU_SUITE_RESULTS_DIR`;
   - `e2e/tsconfig.json`;
   - one smoke spec per project: the page loads under the sub-path with no console errors, and
     `?view=library` loads the library chunk;
   - `@axe-core/playwright` wiring in `e2e/support/`.

   Request a `typecheck` script for `e2e/package.json` as a change request.
4. **The plugin suites, wired to the real plugin build:**
   - `plugin-static`: `php -l` on 8.1 and 8.4, and PHPStan with composer from a digest-pinned
     `composer:2` image (D30), reading `plugin/composer.json`/`composer.lock` once P1 adds them.
   - `plugin-contract`: run `plugin/vitest.config.ts` against `test` mode, then again against the oldest
     supported build (git tag `plugin-v<min>`; until a release exists, the current build) and once with
     the build installed in `mu-plugins/` (D30: `plugin/dist/wp-upload-companion/wp-upload-companion.php`).
   - Keep the "not available yet" messages until the files exist.
5. **The `large` seed and the `perf` suite:**
   - 50k synthetic attachments pointing at a few dozen real files;
   - 300 FileBird folders through FileBird's functions, with about 70 % of items assigned;
   - 5k posts;
   - its own snapshot, plus `dev/run reset large`.

   Together with P1, this is the dev half of spike X4. Provide `dev/run test perf` that times the
   plugin's `/collection`, `/facets` and the Uncategorized query (p95 over 20 runs). Report the numbers
   against plan §9's budget (p95 ≤ 300 ms at 50k) once P1's routes exist; until then, time core REST
   and FileBird's own count queries as a baseline.

**Coordination:** P1, P2 and S1 develop against your stack in parallel. Don't change `dev/run`'s
interface (command names, env var names, the output paths in your M0 handoff §5) without listing it as a
breaking change in your handoff note.

**Verify:** run each new piece from a clean state, then `shellcheck` and `actionlint`, and record the
results in your handoff note.
