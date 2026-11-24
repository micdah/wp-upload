# Track P1 (M1): companion plugin, read side and structure — handoff

Branch `mm/p1`, from `feature/media-manager` @ e09ac4f. Scope: [P1.md](P1.md), i.e.
[plugin-api.md](../contracts/plugin-api.md) §1–3, §5.1–5.3, §5.16–5.21, §6, §7, §8.1, §9 and §10.
The plugin version was not bumped (it is still `1.0.0-dev.1`).

## 1. What works

Every P1 route is implemented and covered by contract tests over HTTP. Every response is validated
with the zod schemas in `shared/library-api.schema.ts`.

| Route / piece | Notes |
|---|---|
| `GET /info` | Frozen shape: the identity comes first. The 403 still identifies the plugin, and it is never 401. `features` lists what this build implements (§4.3) |
| `GET /rev` | Reads options only. The bump is one atomic `UPDATE … LAST_INSERT_ID(GREATEST(rev + 1, now_ms))`. Every hook in §6 marks the rev dirty; the bump happens once, at `rest_post_dispatch`/`shutdown`, after the index flush |
| `GET /collection` | Every param, sort and filter, folder filters, the Trash and the 422 cap. Visibility mirrors core's read check. Two SQL shapes: index-driven (ready) and `wp_posts`-driven (building or stale; same rows, `indexComplete: false`) |
| `GET /facets` | `view`, `folder` and `months`. `editable` per user. `unused` and `usageComplete` go through the usage bridge (stub: everything unused, `usageComplete: false`) |
| `wpu` field | Provider model, primed once per response from `the_posts`. P1 keys from the index and FileBird, P2 keys stubbed. `null` without `upload_files` |
| `GET/POST/PATCH/DELETE /folders`, `POST /folders/assign` | Only FileBird's own functions (D17), then `folder_id` written by the route. 409 without FileBird or in per-user mode. Pro-gated colours (X9). Cycle check. `X-HTTP-Method-Override` works |
| `POST /maintenance/step` | Atomic lock (`INSERT IGNORE`), schemas, media backfill or stale reconcile in batches of 200, a one-statement folder-column reconcile, then the usage step through the bridge |
| `MediaIndex` | dbDelta schema with a db-version option, hooks, deferred flush, backfill, stale mark on deactivation, the cached `/info` consistency check, uninstall |
| Build | `plugin/scripts/build.mjs` writes `plugin/dist/wp-upload-companion/wp-upload-companion.php` (bracketed namespaces, no autoloader, ordered by inheritance), `wp-upload-companion.zip`, `plugin.json` and `changelog.json` (D30). The file starts with an `ABSPATH` guard and a "loaded twice → first copy wins" guard |
| PHPStan | Level 8 with the WordPress stubs, clean. Dev-only `plugin/composer.json`/`composer.lock` |

### Commands (from the repo root)

```sh
# Static: lint on 8.1/8.4 and the build (passes; see §3 about the composer.lock)
dev/run test plugin-static
node plugin/scripts/build.mjs

# Contract tests in the runner, against `test` mode with the built plugin
dev/run test plugin-contract            # 73 passed, 21 skipped (variants, see below)

# The same tests from the host against this worktree's dev stack, with variants
dev/run up dev && dev/run seed small
WPU_MODE=dev npx vitest run --config plugin/vitest.config.ts    # 96 passed

# PHPStan (until track D wires it into plugin-static)
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/plugin:/app" -w /app composer:2 install
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/plugin:/app" -w /app php:8.4-cli \
  php vendor/bin/phpstan analyse -c phpstan.neon.dist --memory-limit=1G
```

### Verified

- **Runner** (`dev/run test plugin-contract`, `test` mode, built plugin over TLS): 73 passed. The 21
  skipped tests need FileBird-off, per-user, Trash or Author variants, or `wp eval`, all of which need
  Docker.
- **Host against `dev` mode**, regular plugin from source: all 96 passed, including:
  - Editor and Author (role switch);
  - FileBird off and per-user mode;
  - the Trash;
  - stale/rebuild/uninstall lifecycles.
- **Built single file installed as a mu-plugin** in the dev stack (regular plugin deactivated): all 96
  passed, and `/info.install` is `mu-plugin`.
- **The built file loaded twice** (scratch harness): no fatal on PHP 7.4, 8.1 or 8.4, and only one
  `plugins_loaded` hook. On 7.4 it registers nothing: the entry file's minimum check returns.
- **`php -l`:** every source file and the built file are clean on 7.4, 8.1 and 8.4.
- **Biome:** `npx biome check plugin` is clean. `npm run check` is clean once `plugin/vendor/` is ignored
  (CR-2) or deleted.
- **Lifecycle, manually and in tests:** deactivate marks the index `stale` and bumps the rev; reactivate,
  then one step returns it to `ready`. Uninstall drops the tables and every `wpu_*` option (except the
  dev stack's `wpu_dev_*`); reinstall starts in `building`.

### What the tests cover

| File | Covers |
|---|---|
| `info.spec.ts` | Identity order, features, caps (Editor, Author), FileBird active/inactive/per-user, Trash, the 403 identity, no `WWW-Authenticate` |
| `rev.spec.ts` | Stability, bumps from core edits (alt, title), no bump on reads, 8 concurrent mutations → 8 distinct newer revs |
| `collection.spec.ts` | Echo, totals against core's `X-WP-Total`, rows = the `wpu` field, every sort's invariant, every filter checked against hydrated data, AND, validation (`data.param`), folder and Uncategorized (with `wpu.folder`), Trash order, Author visibility (every row hydrates; hidden rows return non-200 from core), FileBird off, per-user, identical rows in the stale `wp_posts` shape |
| `facets.spec.ts` | `view` = the collection's own counts for 8 queries, `folder`/`months`, Trash, the usage stub, Author `editable` |
| `field.spec.ts` | Key order and schema, equality with the rows, folder/perms/raw/author, entity decoding, `original` for `-scaled` images, durations, single item, `_fields` skipping, P2 stubs, null when anonymous, Author perms, FileBird off, per-user |
| `folders.spec.ts` | Tree order and counts; create (append, auto-suffix, plain text, validation); rename, clash, no-op, move (default last, positions, to root), name+move, cycle, Pro gate, method override; delete (subtree order, `movedFiles`, files become Uncategorized); assign (previous, skipped, moved, `byId` for every folder, no-op, 5000 ids < 20 s, limits, Author `wpu_forbidden`); FileBird off and per-user 409s |
| `maintenance.spec.ts` | Idle step, empty body, validation, the lock, stale reconcile, backfill from a dropped table, the consistency check, folder-column repair, deactivation and uninstall |

The tests clean up after themselves (folders deleted, items moved back, variants reset), so the suite
can run repeatedly on one stack.

## 2. For P2, S1 and the orchestrator: what P1 publishes

All of it lives in `plugin/wp-upload-companion/src/`. P2 should use these and not reimplement them.

- **The `wpu` field providers (§7.2):**
  - `Field\Provider` is an interface with `keys(): array`, `prime(array $ids): void` and
    `value(int $id): array` (key ⇒ value).
  - Register one from your component's `register()` with
    `\WpUpload\Companion\Field\WpuField::add_provider( new MyProvider() )`.
  - A later provider takes over the keys it declares. `Field\StubProvider` holds P2's six keys until
    then.
  - `MediaIndex::flush()` runs before priming, so rows changed earlier in the same request are
    current.
- **Usage index hooks (P2 implements these on `Index\UsageIndex`, all optional, all `public static`):**
  - `status(): array{state, done, total}` (options only);
  - `check_consistency(bool $use_cache): void`;
  - `ensure_schema(): void`;
  - `step(float $deadline): array{did: int, changed: bool}`;
  - `mark_stale(): void`;
  - `unused_condition(string $attachment_id_sql): string` (SQL, true when unused).

  `Index\UsageBridge` calls them when they exist. The docblock there is the spec.
- **Rev:**
  - `Rev::touch()` on any visible change; it bumps at the end of the request.
  - `Rev::commit()` in mutation routes: it flushes pending index rows, bumps, and returns the rev to
    report.
  - `Rev::current()` at the start of reads (§1.7).
- **Media index:** `MediaIndex::mark($id)` (already hooked on core's attachment and meta hooks) and
  `MediaIndex::flush()`. P2's image operations change `_wp_attachment_metadata`/`_wp_attached_file`,
  which the hooks already catch.
- **Routes and helpers:**
  - `Support\Routes::add($path, $methods, $callback)`: the 403 permission callback, and Throwable →
    500 `wpu_internal`.
  - `Support\Errors` (every `wpu_*` code), `Support\Params` (strict JSON body, `int`, `ids` with
    `wpu_too_many_items`), `Support\Format` (ISO times, entity decoding).
  - `Query\Visibility` (the §5.2 visibility rule, including `trash()` for P2's `/trash`).
- **Features:** call `Plugin::provide_feature( 'trash' )` (a string literal: the build greps for it)
  in `register()` once a feature works. `/info` and `plugin.json` list only provided features, in
  `PLUGIN_FEATURES` order.
- **Syntax rule for every shipped file:** it must **parse on PHP 7.4**. The single file is also
  dropped into `mu-plugins`, where WordPress doesn't check `Requires PHP`, and the entry file's
  minimum check only runs if the file parses (§2.1). So no union types, `match`, nullsafe `?->`,
  named arguments, constructor promotion, `mixed`/`static` return types, enums or `readonly`. Check
  with `docker run --rm -v "$PWD/plugin:/p:ro" php:7.4-cli php -l <file>` (CR-4 asks D to automate
  this).
- **The built file:**
  - The build orders classes so that interfaces and parents come first.
  - Every source file needs `namespace X;` and exactly one class, interface or trait, and no closing
    `?>`.

## 3. Missing, and why

- **`plugin-static` reports "not available yet" once `plugin/composer.lock` is committed.** Track D's
  M0 `suite_plugin_static` does that until its M1 PHPStan step lands (D.md deliverable 4).
  - The lint and build parts pass: I verified them before adding the lock.
  - PHPStan passes when run as in §1.
  - After `mm/d-m1` merges, `plugin-static` should pass.
  - If the orchestrator merges P1 first and needs the gate green, it can hold back the lock commit
    (`74facb8`), at the cost of PHPStan.
- **Variant tests are skipped in the runner.** The runner has no Docker, so `dev/run variant`/`wp eval`
  can't be called from it (CR-1). They run from the host.
- **Spike X4 on D's real `large` seed** wasn't possible: it isn't on my base. I measured on my own
  50k profile ([spikes/X4.md](spikes/X4.md)). D's `perf` suite should confirm.
- **Per-user mode at 50k** wasn't timed. It reads FileBird's relation table (by design, §8.1).
- **Pro colours on a real Pro site:** unverifiable without a licence (D15, [spikes/X9.md](spikes/X9.md)).
- **`more` in `/maintenance/step` stays `true` until P2's `UsageIndex::status()` exists.** The stub
  usage index is `building`. S1's maintenance loop should keep its own pacing so it doesn't spin.

## 4. Deviations from the plan and contracts (none change a wire shape)

1. **`upload.mimes[].extensions`:** core's `audio/wav` pattern is `wav|x-wav`, and `x-wav` fails the
   frozen schema's `^[a-z0-9]+$`. The plugin drops extensions that aren't `[a-z0-9]+` (and entries
   left empty). CR-6 documents this.
2. **The rev bump reads back with `LAST_INSERT_ID(expr)`**, not a separate `SELECT`, so each mutation
   reports the value *its* bump wrote. With a plain `SELECT`, 8 concurrent creates got only 3 distinct
   revs.
3. **Locks** (maintenance, schema) use `INSERT IGNORE` into `wp_options`, plus a takeover of expired
   locks, instead of `add_option()`. `add_option()` checks and then upserts, so it isn't atomic.
4. **FileBird calls:**
   - `DELETE` prefers `Folder::delete()` (what FileBird's own UI calls; it fires
     `fbv_after_folder_deleted`) over `deleteFolderAndItsChildren()` (no hooks), which remains the
     fallback.
   - Assign prefers `Folder::assignFolder()` (one DELETE + one INSERT; FileBird's UI path) over
     `setFoldersForPosts()` (two queries per id).
   - The contract allows "its equivalent" for assign. §10.3 names `deleteFolderAndItsChildren`
     (CR-6).
5. **`features[]` is what the build implements**, not always all twelve: P1's five today
   (`collection, facets, folders, folder-colors, maintenance`). It reaches all twelve once P2 calls
   `provide_feature` for its features.
6. **Folder counts** (`count`, `counts.all`, `counts.uncategorized`) use FileBird's semantics
   (non-trashed attachments, any author), as §5.16 says. They don't apply the per-user visibility of
   `/collection`. For an Author the folder count can therefore exceed the visible items by the few
   attachments of others' unpublished posts.
7. **New files under `src/`:**
   - `Rev.php`, `Support/*`, `Index/{MediaKinds,IndexStatus,UsageBridge}.php`;
   - `Field/{Provider,CoreProvider,StubProvider}.php`, `Query/Visibility.php`;
   - `Rev` is registered as the first component in `Plugin::COMPONENTS` (§6 "Plugin.php's Rev
     component").
8. **No `parent` column in the index.** Author visibility joins `wp_posts` by primary key (X4 shows
   that's within budget).

## 5. Change requests

**CR-1 (track D, `dev/**`): switch variants and run WP-CLI from inside the runner.** Contract tests
for FileBird-off, per-user, Trash, the Author role and the index lifecycle skip in
`dev/run test plugin-contract` today. Suggested design:

- add an admin-only REST route to `dev/wordpress/mu-plugins/wpu-dev.php`, for example
  `POST /wp-json/wpu-dev/v1/variant {trash, filebird, peruser, role}`, authenticated with
  `WPU_ADMIN_USER` plus an admin app password exported to the runner;
- and a test-only `POST /wpu-dev/v1/eval`, or named actions (`mark-media-index-stale`,
  `deactivate-reactivate`, `uninstall`), because the lifecycle tests use `wp eval`.

`plugin/tests/contract/support/variants.ts` would then call the route when the env var is present.
That's a small P1 follow-up.

**CR-2 (orchestrator, root `.gitignore`):** composer's dev install for PHPStan.

```diff
 plugin/dist/
+plugin/vendor/
```

**CR-3 (orchestrator, `plugin/package.json` and a new `plugin/tsconfig.json`):** typecheck the
contract tests in `dev/run test typecheck`. This config is verified clean (`npx tsc -p plugin/tsconfig.json`).

```diff
   "scripts": {
     "build": "node scripts/build.mjs",
-    "test:contract": "vitest run --config vitest.config.ts"
+    "test:contract": "vitest run --config vitest.config.ts",
+    "typecheck": "tsc -p tsconfig.json"
   },
```

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "target": "es2023",
    "lib": ["es2023", "dom"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true
  },
  "include": ["vitest.config.ts", "tests/**/*.ts", "../shared/**/*.ts"]
}
```

**CR-4 (track D, `plugin-static`):**

- PHPStan: `composer install` in `plugin/` with the `composer:2` image, then
  `php vendor/bin/phpstan analyse -c phpstan.neon.dist --memory-limit=1G` (config at
  `plugin/phpstan.neon.dist`, level 8).
- Add a `php:7.4-cli` `php -l` of `plugin/dist/wp-upload-companion/wp-upload-companion.php` after the
  build. It enforces the parse rule in §2.
- Keep `-not -path "*/vendor/*"` in the lint `find`.

**CR-5 (orchestrator, the entry file `wp-upload-companion.php`):**

- Explicit build markers. `build.mjs` falls back to a regex for the current file, but markers are
  sturdier.
- Logging below the minimums. Contract §2.1 says "logs why"; today it returns silently.

```diff
 if ( version_compare( PHP_VERSION, WPU_MIN_PHP, '<' ) ) {
+	error_log( sprintf( 'wp-upload companion: PHP %s is below the required %s; no routes registered.', PHP_VERSION, WPU_MIN_PHP ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
 	return;
 }
 
+// @build-strip-start
 // Development autoloader for the multi-file source. The single-file build
 // (plugin/scripts/build.mjs) inlines every class and drops this block.
 spl_autoload_register(
@@
 	}
 );
+// @build-strip-end
 
 add_action(
 	'plugins_loaded',
 	static function (): void {
 		global $wp_version;
 		if ( version_compare( $wp_version, WPU_MIN_WP, '<' ) ) {
+			error_log( sprintf( 'wp-upload companion: WordPress %s is below the required %s; no routes registered.', $wp_version, WPU_MIN_WP ) ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
 			return;
 		}
```

**CR-6 (orchestrator, `contracts/plugin-api.md`), clarifications, no wire change:**

- **§3.2:** "`mimes` keys … split and lowercased; tokens that aren't `[a-z0-9]+` (core's `x-wav`) are
  dropped."
- **§6 "Atomic":** "…`SET option_value = LAST_INSERT_ID(GREATEST(…))`; the new value is read with
  `SELECT LAST_INSERT_ID()` on the same connection, so each bump reports its own value."
- **§5.21 step 1:** "Takes the lock with `INSERT IGNORE` into `wp_options` (atomic; `add_option()`
  isn't)…"
- **§10.3:** `DELETE` → "`FolderModel::delete([$id])` (fires `fbv_after_folder_deleted` per folder),
  else `deleteFolderAndItsChildren()`"; assign → "`FolderModel::assignFolder()` (FileBird's UI path),
  else `setFoldersForPosts()`".
- **§2.2:** "A build lists the features it implements; a complete API 1.0 build lists all twelve."

**CR-7 (orchestrator, `plugin/CHANGELOG.md`):** proposed lines under "Unreleased":

```md
- `GET /info`, `GET /rev`, `GET /collection`, `GET /facets`, the folder routes
  (`GET/POST/PATCH/DELETE /folders`, `POST /folders/assign`) and `POST /maintenance/step` work.
- The `wpu` field on `/wp/v2/media` (track P2's keys are stubs).
- New table `wp_wpu_media_index`, built by maintenance steps and kept current by hooks.
- Works as a regular plugin and as a mu-plugin from one built file.
```

`build.mjs` turns released sections into `changelog.json` when their headings read
`## 1.0.0 (2026-12-01)` or `## 1.0.0 - 2026-12-01`, with `- ` items. "Unreleased" is skipped. Please
use that heading format at release.

## 6. Spikes

- **[X9](spikes/X9.md), Pro detection:**
  - Pro = the active FileBird's directory is `filebird-pro/`, or its header name says Pro and not Lite.
  - The filter `wpu_filebird_pro` can override it.
  - It's never true on Lite (verified); a false negative only hides colours.
  - Unverified on real Pro (D15). Recommendation: ship it.
- **[X4](spikes/X4.md), 50k performance:**
  - Every measured request meets p95 ≤ 300 ms, as Editor and as Author. Slowest Editor request:
    search, 251 ms. Slowest Author request: search, 288 ms.
  - Collection payload: 224 kB gzip (budget 250 kB; it runs out at about 55k items).
  - Backfill: about 7.7k rows/s.
  - One fix came out of it (the Author `NOT EXISTS`).

## 7. Open questions

1. **Folder counts for Authors:** FileBird's semantics (any author's items) or the collection's
   visibility rule? I followed §5.16 literally (deviation 6).
2. **`features[]` before P2 merges:** implemented features only (as built), or the full API 1.0 list?
   The server's `update-available`/`missingFeatures` logic depends on it.
3. **Pro detection:** ship the X9 detection in v1, or force `pro: false` until a Pro site has
   confirmed it?
4. **Payload headroom:** at about 55k items the collection passes 250 kB gzip. Is chunking (plan §10,
   C5) worth planning now?
5. **The composer.lock vs plugin-static ordering** (§3): merge `mm/d-m1` first, or hold back
   `74facb8`?

## 8. Commits

```text
b99b706 fix(plugin): no rev query or uninstall registration on front-end requests
44476d7 perf(plugin): check an attachment's parent with a correlated NOT EXISTS
74facb8 chore(plugin): PHPStan level 8 with WordPress stubs (dev-only composer)
7917afc test(plugin): retry stale keep-alive sockets; deactivation and uninstall lifecycle
fe211b3 feat(plugin): single-file build and contract tests for the P1 routes
270949c feat(plugin): info, rev, collection, facets, folders and the wpu field
```

Plus the commit with this note and the spike notes.
