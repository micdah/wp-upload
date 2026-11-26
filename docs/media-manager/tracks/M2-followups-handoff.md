# Track M2-followups: handoff

Branch `mm/m2-followups`, from `feature/media-manager` @ 1c1dfb5. Scope: [M2-followups.md](M2-followups.md),
the M1-review decisions that need plugin, server or tooling changes (plan §0: D38, D40, D41, D44, D46,
D48(3), D48(4)), and running every contract test in the runner. Docker was available; every result below
comes from this worktree's own stack. The plugin version was not bumped (still `1.0.0-dev.4`).

## 1. What works

| # | Deliverable | Code | Tests |
|---|---|---|---|
| D38 | **Replace keeps old sub-size files** whose names the new image doesn't produce (another aspect ratio, or a size the new image is too small for). They stay on disk, are never in `sizes`/`srcset`, and are recorded in `_wp_attachment_backup_sizes` as `<size>-wpu-kept-<token>`, so WordPress deletes them with the item, also without the plugin. A later replace or regenerate that makes a size of that name again overwrites the file and stops keeping it (kept files never block a new size) | `Images/Engine.php` (`keep_dropped_sizes`, `forget_current_kept`, `without_kept`) | `images.spec.ts` › replace › "keeps old sub-size files whose dimensions no longer exist, until the item is deleted (D38)": kept files still answer 200 and aren't listed; a replace back to the first aspect makes them current sizes again; deleting the item makes every file 404 |
| D40 | **`[gallery]` without `ids`/`include`** counts the images attached to a post as `shortcode-gallery`: the `id` attribute's post, else the containing post, minus `exclude` (core's own query). The index follows attach, detach and moves (`attachment_updated`: core REST, `/media/batch`'s `set.post`), wp-admin's Attach/Detach (`wp_media_attach_action`), uploads attached to a post (`add_attachment`), and trashing or restoring an image. It rescans the parent and the posts with a `[gallery id="<parent>"]` (the first 50 at once, the rest through the maintenance step) | `Usage/Parser.php` (`attached_images`), `Index/UsageIndex.php` (`rescan_gallery_users` and three hooks) | `usage.spec.ts` › "[gallery] without ids (D40)": classic post and `[gallery id=N exclude=…]` in another post; detach/attach through core REST and `/media/batch`; wp-admin's attach action; a new attached upload |
| D41 | **Folder counts follow the collection's visibility rule** (`count`, `counts.all`, `counts.uncategorized`), from the index and from FileBird's relation table alike. For Editors and Administrators that is every attachment the collection lists (status `inherit` or `private`: the index path is unchanged, the relation-table path now matches it); Authors no longer count other users' private items or items attached to posts they can't read | `Rest/FoldersController.php` (`Query\Visibility::live`), `FileBird/Adapter.php` (`count_from_relations( $owner, $visible )`) | `folders.spec.ts` › "GET /folders as an Author (D41…)": an Editor's image attached to the Editor's draft and filed in a test folder counts 1 for the Editor and 0 for the Author; every Author count equals the matching `/collection` total; the same with the index stale (relation-table path) |
| D44 | **Visual Portfolio's placeholder** (`vp_general['no_image']`) is a site-level `visual-portfolio` use while Visual Portfolio is active: ref `{postId: null, postType: "site", postTypeLabel: "Site", title: "Visual Portfolio placeholder image", viewUrl: null}`, `editUrl` = Visual Portfolio's settings for `manage_options`. It follows the option, and Visual Portfolio being switched off and on | `Usage/Parser.php` (`parse_site`), `UsageIndex` (`vp_general` hooks, source 0 rescanned when Visual Portfolio comes back), `Rest/UsageController.php` (`site_ref`) | `usage.spec.ts` › "Visual Portfolio’s placeholder image (D44)" (2 tests); the existing site-ref test accepts the new title |
| — | Parser version 3 (`UsageIndex::ROW_VERSION`), so existing indexes rescan every post once for D40/D44 | `Index/UsageIndex.php` | covered by the suites above (fresh installs) |
| D48(3) | **A regenerate job releases its concurrency slot between items.** `JobSpec.slots: 'per-step'` plus `context.step(work)`: each item takes a slot and gives it back (FIFO, so queued uploads go first); the job is `queued` until its first item gets a slot and `running` from then on; progress, per-item results and the fatal codes are unchanged. Other jobs keep one slot throughout. Done by a helper agent, reviewed | `server/src/lib/library/jobs.ts`, `server/src/routes/library/images.ts` | `jobs.spec.ts` › "per-step jobs" (6); `images.spec.ts` › `POST items/regenerate` (4 new, incl. "releases its slot between items, so a job queued meanwhile goes first", which fails on the old code). Every test checks no slot is left held |
| D46 | **`[perf]` CI job is report-only.** `WPU_PERF_REPORT_ONLY=true` makes an over-budget run exit 0, with the failures still in `perf.md`/`perf.json` (`reportOnly: true`) and on stderr. The workflow sets it, and appends `perf.md` to the job summary; the artifact upload is unchanged. Local runs still fail over budget | `dev/perf/budget.mjs` (new, pure), `dev/perf/measure.mjs`, `dev/lib/suites.sh`, `.github/workflows/media-manager.yml` | `dev/perf/budget.test.mjs` (`node --test`, 4 tests), run by `dev/run test unit` |
| D48(4) | **`dev/run` derives the oldest supported plugin tag** from `PLUGIN_API_REQUIRED` in `server/src/routes/library/bootstrap.ts`: the oldest `plugin-v*` tag (version order) whose `WPU_API` has the same major and a minor ≥ `minMinor`; none → the current build. `WPU_PLUGIN_OLDEST_REF` still overrides it. `PLUGIN_OLDEST_SUPPORTED_TAG` is gone | `dev/lib/suites.sh` (`oldest_supported_plugin_ref` and helpers), `dev/lib/common.sh` | `dev/tests/oldest-plugin-ref.sh` (8 cases in a throwaway git repo: no release, older major, minMinor 0/1/2/3, version vs text order, new major, override), run by `dev/run test unit` |
| 8 | **Every contract test runs in the runner.** The dev mu-plugin answers `POST /wp-json/wpu-dev/v1/eval` `{php}` → `{output}`: registered only while `wp_get_environment_type()` is `local`, callable only with `manage_options` (the app user and the Author get 403, anonymous 401). It runs the code as `wp eval` does: admin includes loaded, no current user, output captured; a Throwable is 500 `wpu_dev_eval_failed` with the message and the output so far. `dev/run` now gives the administrator an app password (`WPU_ADMIN_APP_PASSWORD`, in `dev/.state/<mode>/stack.env`, the runner env and `dev/.env.wp`). The tests' `wpEval()` uses the route whenever it answers (host and runner alike, so both run the same way) and falls back to `dev/run wp eval` | `dev/wordpress/mu-plugins/wpu-dev.php`, `dev/wordpress/setup/users.php`, `dev/lib/{stack,wordpress}.sh`, `dev/compose.test.yml`, `plugin/tests/contract/support/{env,variants}.ts` | `plugin/tests/contract/dev-stack.spec.ts` (3 tests: wp-eval semantics, the 500, the 403/401s); the 27 formerly skipped tests themselves |
| M2-slice CR-2 | **The test proxy certificate names a specific `WPU_BIND_ADDRESS`** (asked for by the coordinator): when the stack listens on one address that isn't `127.0.0.1` or `0.0.0.0`, the certificate also carries `IP:<address>`, so a LAN device (an iPad) that trusts the dev CA can open the stack by IP. The CA is kept; only the proxy certificate is re-issued when its names change (recorded in `proxy/server.names`), and `dev/run` restarts a running proxy then. A value that isn't a plain IPv4/IPv6 address is ignored with a warning | `dev/lib/make-dev-ca.sh`, `dev/compose.yml` (the `ca` service gets `WPU_BIND_ADDRESS`), `dev/lib/stack.sh` (`ensure_dev_ca`) | `dev/tests/make-dev-ca.sh` (10 checks in a scratch directory: loopback and `0.0.0.0` add nothing, a specific address re-issues with `IP Address:…`, same CA, `openssl verify` passes, nothing re-issued for unchanged names, a non-IP value never reaches the certificate), run by `dev/run test unit`; also run in the `ca` service's own image (busybox `sh`) |
| — | **Fix found on the way: the uninstall callback is recorded on activation.** `boot()` runs on `plugins_loaded`, which the activation request has passed, so `register_uninstall_hook()` only ran on a later wp-admin or WP-CLI load. A plugin activated and deleted purely through core's REST API was deleted without dropping its tables and options, and so was the companion on a freshly restored stack (the uninstall test failed once it ran in the runner) | entry file `wp-upload-companion.php` (a `register_activation_hook`; the version constants untouched) | `maintenance.spec.ts` › "removes its tables and options on uninstall…", now in the runner |

### Commands

```sh
dev/run down --volumes && dev/run up test && dev/run seed small
dev/run test all                         # the gate
dev/run test plugin-contract             # three installs, now with the eval-route tests
bash dev/tests/oldest-plugin-ref.sh      # D48(4), host or runner
bash dev/tests/make-dev-ca.sh            # the LAN certificate (M2-slice CR-2)
WPU_BIND_ADDRESS=192.168.1.50 dev/run up test   # serve the test stack on that address, by IP
node --test dev/perf/                    # D46
WPU_PERF_REPORT_ONLY=true dev/run test perf   # what the [perf] CI job runs
npm run test -w server                   # D48(3) (after npm run build)
```

## 2. Gate

The gate after the review fixes is in §7. Below: the first handoff's gate.

From a clean state: `dev/run down --volumes`, `dev/run up test`, `dev/run seed small`, `dev/run test all`
→ **exit 0**.

| Suite | Result |
|---|---|
| lint | pass (Biome) |
| typecheck | pass (server, client, e2e, plugin) |
| unit | pass: `dev/tests/oldest-plugin-ref.sh` 8/8, `node --test` 4/4, server 805 (39 files), client 574 (39 files) |
| plugin-static | pass: build, `php -l` on 7.4 (shipped), 8.1, 8.4, PHPStan level 8 `[OK] No errors` |
| plugin-contract | pass: `plugin`, `oldest` and `mu-plugin` runs, each **203 passed, 1 skipped** (15 files). "No plugin-v* release meets the server's PLUGIN_API_REQUIRED yet", so `oldest` is the current build |
| server-live | pass: 49 tests (4 files) |
| e2e-mock | pass: 2 |
| e2e-live | pass: 2 |

The first clean-state run failed only `unit`: `node --test dev/perf/` treats the directory as a module on
Node 24 (the runner), though it works on the host's Node 26. Fixed with a file glob (`d736b6f`); the
re-run above is from a clean state again. Also checked: `shellcheck -x` 0.11.0 on `dev/run` (which follows
every `dev/lib/*.sh`) and `dev/tests/oldest-plugin-ref.sh`, and `actionlint` 1.7.12 on
`media-manager.yml`: clean.

After the gate, the LAN-certificate change (`89d24d6`) came in: `dev/run test unit` (now also
`dev/tests/make-dev-ca.sh`, 10/10) and `dev/run test e2e-live` (2 passed, through the re-issued certificate
and the restarted proxy) were re-run on the same stack, and `shellcheck -x` is clean on the changed scripts.

**perf** (`large` seed, this machine), both runs exit 0:

- `dev/run test perf` (enforced, 20 runs): every budgeted route within budget.
- `WPU_PERF_REPORT_ONLY=true WPU_PERF_RUNS=5 dev/run test perf`: `perf.md` says "Report-only run (D46)",
  `perf.json` has `reportOnly: true`. p95: collection 90.5 ms (166 kB gzip), Uncategorized 48.3 ms, facets
  159.3 ms, facets Uncategorized 85.3 ms; search 176.6 ms. The over-budget path itself is covered by
  `dev/perf/budget.test.mjs`, since the stack is within budget.

**`plugin-contract` skips, per install run (`plugin`, `oldest`, `mu-plugin`):**

| | passed | skipped |
|---|---|---|
| Before (M1-integration §5.4) | 164 | 28 (the `*-internals` specs, lifecycle, P-6, parts of maintenance, the stale-index collection test: all `wp eval`) |
| After | 203 | **1** |

The one skip is `media.spec.ts` › "as the app user switched to Author (role=author)": it runs only when the
stack has no separate Author user (D26), so it can't apply here. No skip is caused by `wp eval` any more.
(The suite has 12 more tests than before: 9 for this track's deliverables and 3 for the eval route.)

## 3. Deviations and notes

1. **The eval route runs inside a REST request.** That is close to `wp eval`, not identical: `REST_REQUEST`
   is set, and the rev bump happens at `rest_post_dispatch` instead of `shutdown`. The route loads the admin
   includes (`wp-admin/includes/admin.php`) and clears the current user, so the existing PHP snippets ran
   unchanged. Every formerly host-only test passes through it in all three installs.
2. **Existing stacks:** snapshots taken before this branch hold no administrator app password, so after each
   restore `dev/run` makes a new one and records it (state and `dev/.env.wp` only: nothing is restarted, review
   fix 6). `dev/run down --volumes` and a fresh `up` + `seed` stop it.
3. **The entry file changed** (the activation hook), outside the version constants, so it was in this track's
   ownership; it is shipped plugin source and needs the version bump at merge.
4. **D40 also reads `[gallery id=N]`** (another post's attached images), not only the id-less form in the
   post itself, because core does. Keeping such posts current costs one query per request in which attached
   images changed (indexable posts whose content has `[gallery` and is a changed parent or mentions `id=`),
   then a PHP check of each candidate's shortcodes; nothing runs for unattached items or non-images.
5. **D38 covers raster images only.** Other types (PDF previews, video posters) still drop the files they no
   longer produce, as before. Edits (which also change size names after a crop) are unchanged: the undo stack
   keeps those files; when an edited item is replaced, the stack's earlier sub-sizes are kept too (review
   fix 5).
6. **D46 uses an environment variable, not a `dev/run test perf --report-only` flag**, so the CI difference
   is one explicit, documented input that also works locally; `dev/run help` mentions it.
7. **`dev/run test unit` also runs dev/run's own tests** (`dev/tests/*.sh`, `node --test "dev/perf/*.test.mjs"`). They
   need no stack and take about a second.
8. **The LAN certificate:** existing test stacks have no `proxy/server.names`, so their proxy certificate is
   re-issued once (same CA) on the next `dev/run` command, and the proxy restarted. A device still has to
   trust the dev CA (`dev/.state/test/ca/public/ca.crt`) and reach the proxy port; the app's own URLs stay
   relative, so it works under the IP as under `wpu.test`. `WPU_BIND_ADDRESS` isn't stored: export it for
   the session, because a `dev/run` call without it goes back to `127.0.0.1` (and re-issues the
   certificate without the IP).
9. **D48(3) design notes from the helper:** a per-step job cancelled between steps would free a temp file
   only at its next step; no per-step job has one (only uploads can be cancelled, and only regenerate is
   per-step), so it doesn't matter today.

## 4. Contract changes (additive or clarifying)

- **plugin-api.md:**
  - §5.15: replace keeps old sub-size files (D38), with a sentence the client's Replace confirm can use:
    "Posts that embedded an old size keep showing the old image until the item is deleted."
  - §5.16: folder counts follow §5.2's visibility (D41); equal to the matching `/collection` totals.
  - §8.2: the id-less `[gallery]` (D40), the site-level Visual Portfolio placeholder and its ref (D44), and
    the parser version 3 on `wpu_usage_sources.row_version`.
- **server-api.md:**
  - §7.9: the `shortcode-gallery` and `visual-portfolio` context descriptions (D40, D44).
  - §7.12/§7.13: a regenerate job takes its slot per item; `queued` means "waiting for its first item's slot"
    (D48(3)).
- No wire shape, `shared/` type or schema changed: the placeholder ref is an ordinary site-level `UsageRef`.

## 5. Change requests

**CR-1 (orchestrator, `contracts/plugin-api.md` §5.10, outside this track's sections):** the site-level
sentence lists only the logo and the icon.

```diff
-- Site-level uses: `postId: null`, `postType: "site"`, `postTypeLabel: "Site"`, title "Site logo" /
-  "Site icon", `editUrl` = the Site Editor or Customizer when the user has `edit_theme_options`.
+- Site-level uses: `postId: null`, `postType: "site"`, `postTypeLabel: "Site"`, title "Site logo" /
+  "Site icon", `editUrl` = the Site Editor or Customizer when the user has `edit_theme_options`; and
+  Visual Portfolio's placeholder (D44, §8.2): title "Visual Portfolio placeholder image", `viewUrl` null,
+  `editUrl` = Visual Portfolio's settings when the user has `manage_options`.
```

**CR-2 (orchestrator, at merge):** bump the plugin version (shipped source changed: `Engine.php`,
`Parser.php`, `UsageIndex.php`, `UsageController.php`, `FoldersController.php`, `Adapter.php`, the entry
file), and add the changelog lines below under "Unreleased" in `plugin/CHANGELOG.md`.

**CR-3 (M2-slice / client, for information):** the Replace confirm can now say that old sizes stay until the
item is deleted (§5.15); the inspector's where-used list may show a site-level ref titled "Visual Portfolio
placeholder image" with `viewUrl: null`. The mock library (`client/src/media-manager/mocks/fake/dto.ts`) only
knows the logo and icon titles.

### Proposed changelog lines

```md
- Replacing an image with one of another aspect ratio keeps the old sub-size files, so posts that embedded
  them keep an image; they are deleted with the item.
- A `[gallery]` shortcode without ids counts the post's attached images as used, and stays current when
  images are attached, detached, trashed or restored.
- Visual Portfolio's "no image" placeholder is reported as used by Visual Portfolio.
- Folder counts for Authors count only the items they can see.
- The uninstall clean-up is registered when the plugin is activated, so deleting it right after activating
  it (for example through the REST API) still removes its tables and options.
```

## 6. Open questions

1. **Kept sub-sizes accumulate** across repeated replaces with different aspect ratios (only deleting the item
   removes them). Fine for v1, or should a later replace drop kept files no post references (the usage index
   knows `content` URLs)?
2. **`[gallery id=N]` across posts** (deviation 4): keep, or count only the containing post's own attached
   images, as D40's wording strictly says?
3. **Author folder counts at 50k** weren't timed: they add the same `wp_posts` join and `NOT EXISTS` the
   Author's `/collection` already pays (X4: within budget). `perf` measures as the Editor only.

## 7. Fixes from the independent review

No critical findings; 3 important and 6 minor, all fixed on this branch.

| # | Finding | Fix | Test |
|---|---|---|---|
| 1 | The parser v3 bump never rescanned existing installs: `DB_VERSION` stayed `2`, so a `ready` index stayed ready and `complete` true; rows deferred by a rescan (`row_version` 0) also left it `ready` | The state option records the parser version (`parser`); a mismatch makes a ready index `building` (no query: the option is autoloaded). Deferring rows calls the new `mark_building()`, and the consistency check also catches `row_version < ROW_VERSION` (→ `building`, not a full stale rescan) | `usage.spec.ts` › "rescans after a parser upgrade or a deferred rescan": state and rows downgraded through the eval route → `complete: false` → maintenance → `complete: true`, no outdated row; the same for one deferred row plus the consistency check |
| 2 | The D40 hooks were too expensive: a full-table `LIKE '%N%'` per attachment event, twice for a trash, for non-images too, with non-indexable posts counting toward the cap | Parents are queued in a static set and rescanned once per request (`rest_post_dispatch` at 999, before Rev's flush; `shutdown` at -10 otherwise). One query over indexable types and statuses (`[gallery` and either a queued parent or `id=`), then `get_shortcode_regex(['gallery'])` confirms a real id-less `[gallery id="N"]`. Non-images are skipped; trash/restore is handled only by `attachment_updated` | `usage.spec.ts` › "rescans once per request, and never for non-images": three changes → one gallery query; a non-image → none. Plus the existing D40 tests |
| 3 | `get_children()` could return stale results with a persistent object cache after core's SQL-only `wp_media_attach_action()` | `'cache_results' => false` in `attached_images()`, and `clean_post_cache()` at the start of `on_media_attach_action()` | Covered by the existing wp-admin attach/detach test (the stack has no persistent cache, so the stale case itself can't be reproduced here) |
| 4 | `make-dev-ca.sh` accepted `beef` and `300.1.1.1`; a failed `openssl x509` left a new key next to the old certificate, and failed silently | IPv4 octets ≤ 255, IPv6 needs a colon; key and certificate are issued under temporary names and moved in only after both succeed, then `server.names`; openssl's stderr is shown on failure | `dev/tests/make-dev-ca.sh`: 22 checks (adds `beef`, `300.1.1.1`, `1.2.3`, `1.2.3.4.5`, IPv6 `fd00::5`, and a damaged CA key: the script fails with openssl's message, key, certificate and `server.names` unchanged, no temporary files left) |
| 5 | Replacing an edited image deleted the pre-edit sub-sizes that posts made before the edit embed | `keep_stack_sizes()` records the stack entries' still-existing, non-current sub-sizes as `-wpu-kept-` backup sizes before `drop_stack()` | `images.spec.ts` › "also keeps the sub-sizes from before an edit when an edited item is replaced (D38)": square crop, replace, pre-edit files answer 200, then 404 after deleting the item |
| 6 | A new admin app password set `APP_PASSWORDS_CHANGED`: a needless "restart npm run dev" warning and app restart on every restore of an old snapshot | Its own flag, `ADMIN_APP_PASSWORD_CHANGED`: only the state and `dev/.env.wp` are written | `dev/tests/app-passwords.sh` (5 cases, stubbed wp-cli and compose; fails on the old code) |
| 7 | An aborted regenerate step counted as an item failure and the loop went on | `if (context.signal.aborted) throw err` in the catch | `images.spec.ts` (server) › "stops at the first item when the job is aborted…" (fails on the old code) |
| 8 | No test of trash/restore for the D40 gallery | — | `usage.spec.ts` › "drops a trashed attached image from the gallery and brings it back on restore (trash=on)" |
| 9 | "Query unchanged" / "(FileBird's own count)" were inaccurate for Editors on the relation-table path | Reworded here (§1, D41) and in `plugin-api.md` §5.16 ("every attachment the collection lists") | — |

Also clarified in `plugin-api.md` §8.2: the gallery rescans run once per request, and an update with a newer
parser or deferred posts keep the index `building` (so `complete` false) until rescanned.

**Gate after the fixes**, from a clean state (`down --volumes`, `up test`, `seed small`, `test all`) →
**exit 0**:

| Suite | Result |
|---|---|
| lint, typecheck | pass |
| unit | pass: dev tests (`app-passwords`, `make-dev-ca`, `oldest-plugin-ref`: all passed; `node --test` 4/4), server 806, client 574 |
| plugin-static | pass: `php -l` 7.4/8.1/8.4, PHPStan level 8 `[OK] No errors` |
| plugin-contract | pass: `plugin`, `oldest`, `mu-plugin`, each **208 passed, 1 skipped** (the same role-switch fallback; 5 new tests) |
| server-live | pass: 49 |
| e2e-mock, e2e-live | pass: 2 and 2 |

The first clean-state run after the fixes failed only `plugin-static`: PHPStan wanted a `list<int>` for
`reindex_now_or_later()` (`array_values()` added, `96117bf`); the run above is the re-run from a clean state.
`shellcheck -x` is clean on `dev/run`, `dev/lib/make-dev-ca.sh` and the three `dev/tests/*.sh`.

## 8. Branch and commits

`mm/m2-followups` (not pushed):

- `d2987e8` feat(server): a regenerate job releases its concurrency slot between items (D48)
- `0f643ea` test(dev): run the wp eval contract tests in the runner through an admin-only eval route
- `63efa67` fix(plugin): record the uninstall callback when the plugin is activated
- `b63be49` feat(plugin): replace keeps old sub-size files whose dimensions no longer exist (D38)
- `6eb8a14` feat(plugin): usage of [gallery] without ids and Visual Portfolio's placeholder (D40, D44)
- `09cabfc` feat(plugin): folder counts follow the collection's visibility rule (D41)
- `5ddd60f` feat(dev): report-only perf in CI and the oldest plugin tag from the server's API level (D46, D48)
- `9a24d2a` docs: contract wording for D38, D40, D41 and D44
- `d736b6f` fix(dev): run the perf unit tests with a glob Node 24 accepts
- `89d24d6` feat(dev): name a specific WPU_BIND_ADDRESS in the test proxy certificate
- `23f3a87` docs: M2-followups handoff
- `aff4ce7` fix(plugin): usage index rescans honestly and cheaply after the D40/D44 changes
- `bdf66ca` fix(plugin): replacing an edited image keeps the pre-edit sub-sizes too (D38)
- `3cebfb5` fix(server): an aborted regenerate job stops instead of failing every item
- `f4703c9` fix(dev): safer proxy certificate issuing and no restart for a new admin password
- `fc38790` docs: clarify folder counts for Editors and when the usage index is building
- `96117bf` fix(plugin): pass a list to reindex_now_or_later (PHPStan level 8)
- (this update of the note)

The stack was stopped with `dev/run down` (volumes kept).
