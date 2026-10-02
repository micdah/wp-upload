---
name: issue
description: Read a GitHub issue from this repository and produce a reviewed implementation plan for resolving it, asking the user about anything ambiguous. Use when the user runs /issue <number> or asks to plan work for a specific issue.
argument-hint: <issue-number>
---

# Plan the resolution of a GitHub issue

The user wants a **plan** for resolving GitHub issue `$ARGUMENTS` in this repository. Do not implement anything until the user has approved the plan.

## 1. Validate the argument

- Strip a leading `#` from `$ARGUMENTS`. If what's left isn't a positive integer (or is empty), ask the user for the issue number and stop until they answer.

## 2. Enter plan mode

- Call `EnterPlanMode` (load it with `ToolSearch` `select:EnterPlanMode,ExitPlanMode` if needed) so the investigation stays read-only and the plan ends in an approve/adjust prompt.
- If plan mode is unavailable or declined, continue anyway but stay read-only: no edits, no branches, no commits.

## 3. Gather the issue context

Run these (in parallel where possible):

```bash
gh issue view <N> --json number,title,state,author,labels,assignees,milestone,url,body,comments
gh pr list --state all --search "<N> in:body" --json number,title,state,headRefName,url
```

- Read the full body **and every comment** — later comments often refine or change the request.
- If the body links to other issues/PRs, view those too (`gh issue view` / `gh pr view`).
- If the body contains images/screenshots, note them; fetch them with `WebFetch` only if they're needed to understand the request.
- **Stop and ask** (via `AskUserQuestion`) before planning if:
  - the issue is `CLOSED`, or
  - an open PR already appears to address it,
  - the issue can't be found (wrong number / wrong repo).

## 4. Investigate the codebase

Ground the plan in the actual code — don't plan from the issue text alone.

- Skim `README.md` and any `CLAUDE.md` for architecture and conventions.
- Locate the code the issue touches. For broad searches, launch `Explore` agents (in parallel, one per area); for targeted lookups, search directly.
- Understand the current behaviour and, for bugs, identify the likely root cause with `file:line` references.
- Check `git log` for recent related changes, and note existing patterns the solution should follow.
- Identify how the change will be verified: existing tests (`npm test`), `npm run typecheck`, `npm run check` (Biome), and whether a manual run of the app is needed.
- Check memory for relevant project notes (e.g. WordPress processing latency when timeouts are involved).

## 5. Resolve open questions with the user

Collect everything that is genuinely the user's call, then ask with `AskUserQuestion`:

- Ambiguous or underspecified requirements in the issue.
- Design decisions with real trade-offs (UX behaviour, API shape, new dependencies, config/env vars, backwards compatibility, scope boundaries).
- Anything where the issue and the code disagree.

Guidelines:
- Don't ask things you can answer by reading the code or that have an obvious conventional default — decide, and state the assumption in the plan.
- Batch related questions (up to 4 per call), give 2–4 concrete options each, and put your recommendation first with `(Recommended)`.
- Use `preview` for options that are easiest compared visually (UI mockups, code shapes).
- If answers raise new questions, investigate further and ask again. Repeat until nothing blocking remains.

## 6. Write the plan

Present the plan (as the `ExitPlanMode` plan if in plan mode) with this structure:

```markdown
# Plan: #<N> <issue title>

<issue URL>

## Summary
What the issue asks for, in 2–4 sentences, including your interpretation.

## Current state
How the relevant code works today / root cause for bugs, with `file:line` references.

## Decisions
Answers from the user and assumptions you made (marked as assumptions).

## Approach
The chosen solution and why; briefly note rejected alternatives if relevant.

## Steps
1. Concrete, ordered changes — each naming the files/functions touched.
2. ...

## Verification
Tests to add/update, commands to run (`npm test`, `npm run typecheck`, `npm run check`), and any manual checks.

## Risks & out of scope
Edge cases, regressions to watch for, and anything deliberately left out (candidates for follow-up issues).

## Delivery
- Branch: `<type>/<short-slug>` off `master` (e.g. `feat/filebird-support`)
- Commits: conventional-commit style (`feat:`, `fix:`, ...)
- PR title: `<type>: <summary>`, body references `Closes #<N>`
```

Keep it proportional: a small bug fix needs a short plan, not every section padded out.

## 7. Hand off

- Call `ExitPlanMode` so the user can approve, adjust, or reject the plan. If not in plan mode, present the plan and stop, asking whether to adjust it or start executing.
- When the user approves and execution starts: create the branch from an up-to-date `master`, implement the steps, run the verification, and commit locally. **Never push or open a PR without the user's explicit go-ahead.**
