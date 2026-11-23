# Media manager: implementation tracks

Every track in the [implementation plan](../implementation-plan.md) (§7) has a brief here, named
`<id>.md`, and writes its own handoff note, `<id>-handoff.md`. This page holds the rules every track
follows. The brief adds what is specific to the track.

## Read first

- [`implementation-plan.md`](../implementation-plan.md). §0 lists the decisions D1c and D12–D30 and the
  spec amendments. Also read §2.5 (orchestrator-owned files), §4 (layout and ownership) and §7 (tracks).
- The contracts: [`contracts/plugin-api.md`](../contracts/plugin-api.md) and
  [`contracts/server-api.md`](../contracts/server-api.md), plus the types in `shared/`. They are
  **frozen**. A change goes in your handoff note as a change request, never into the files.
- The repo's `CLAUDE.md` and [`HANDOFF.md`](../HANDOFF.md) §2–3.
- The design docs for your area. Where they disagree with the plan or the contracts, the plan and the
  contracts win.

## Working rules

- **Branch:** run `git switch -c mm/<id>` in your worktree first.
  - **Commits:** you may commit on that branch only. This is the owner's standing permission (D14), and it
    overrides the global no-commit rule for that branch only.
  - **Never** push, open a PR, rebase, or commit anywhere else. The orchestrator pushes branches for
    review.
  - **Format:** conventional commits, each ending with
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Ownership is exclusive.**
  - Create or edit only the paths your brief lists.
  - Everything else, especially the orchestrator-owned files in plan §2.5, needs a **change request**:
    the file and an exact diff, in your handoff note.
  - You may delete temporary spike files only if you created them.
- **Dependencies:** never add npm or composer dependencies yourself; request them.
- **Effort:** any sub-agent you start runs at **high** effort.
- **FileBird:** never modify it (D17). Mutations go through its own PHP functions; reads may use
  read-only SQL.
- **Public repo:** no hostnames, mount paths or deployment specifics. Use placeholders such as
  `example.com` and `/wp-upload/`.
- **Shell scripts:** readable, with named functions, descriptive variables, multi-line `if`, and a
  *why* comment per function.
- **Keyboard shortcuts:** use `event.key`, and only keys typable on US and Danish layouts (letters,
  digits, `, . - + ?`, named keys, `Ctrl/Cmd`+letter).
- **The app must work under any sub-path:** relative URLs only, and state in query parameters.

## Environment

- **Your own stack:** your worktree gets its own Docker stack (plan §5). `dev/run up dev` gives
  WordPress with FileBird, and `dev/run seed small` seeds it. `dev/run test <suite>` runs a suite
  exactly as CI does.
- **Stop it when done:** run `dev/run down` when you finish, but keep the volumes.
- **No Docker:** if your environment has no Docker, say so in your handoff note. The orchestrator then
  runs the gate for you.

## Done means

1. The deliverables in your brief work, with tests.
2. `dev/run test` passes for the suites your track touches, and nothing else got worse.
   `dev/run test all` only passes once every track has landed.
3. Biome is clean (`npm run check`), and the typechecks you touch pass.
4. A handoff note, `docs/media-manager/tracks/<id>-handoff.md`, is committed. It covers:
   - what works, with exact commands;
   - what's missing and why;
   - deviations from the plan or contracts;
   - change requests;
   - spike results (one-page decision notes, in `docs/media-manager/tracks/spikes/<spike>.md`);
   - open questions.
5. Your final message summarises the handoff note, the branch name and the commit list.
