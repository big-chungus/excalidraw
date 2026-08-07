---
name: reset-101-demo
description: Use after a Cursor 101 customer demo when the fork has dirty working trees or leftover demo branches from the identify ticket → Ask → Plan → Work → commit/merge flow. Destructively restores git to the demo base and moves Linear demo tickets back to Backlog.
---

# Reset Cursor 101 demo state

## Warning (say this first)

This is **destructive**. You will:

- Hard-reset the repo to `origin/BASE` and remove untracked files (except `node_modules`, `.env*`, and common local credential files).
- Delete **merged** local branches named `demo/*` or `ale-*` (not `BASE`). Unmerged branches are skipped unless the FE explicitly approves force-delete.
- Move Linear issues in **Excalibur 101 Demo** back to **Backlog** (issues are not deleted).

Confirm the FE wants to proceed, then execute.

## 1. Detect BASE

Prefer remote branches on `origin`:

1. `demo-base` if `origin/demo-base` exists
2. else `main` if `origin/main` exists
3. else `master`

Call this branch **BASE**.

## 2. Git reset

From the repository root, run:

```bash
bash .cursor/skills/reset-101-demo/reset.sh
```

Optional stale remote refs: add `--prune-remote`.

If the script is unavailable, run the equivalent:

- `git fetch origin`
- `git checkout BASE`
- `git reset --hard origin/BASE`
- `git clean -fd -e node_modules -e .env -e .env.local -e '.env.*'`
- Delete merged local `demo/*` and `ale-*` branches (not BASE) with `git branch -d`; for unmerged names, list them and **ask** before `git branch -D`
- Optionally `git remote prune origin`

## 3. Linear reset (best-effort)

Skip this section if Linear MCP is unavailable or errors.

- Project: **Excalibur 101 Demo**
- Always reset: **ALE-28** (CSV→table), **ALE-29** (multi-select align)
- Also reset **ALE-22** through **ALE-36** if their state was changed during the demo

For each issue: use Linear MCP `save_issue` with `id` set to the identifier (e.g. `ALE-28`) and `state` set to **Backlog**. Do **not** delete issues. Use `list_issues` / `get_issue` to verify project membership if needed.

## 4. Demo ready checklist

Print for the FE:

- [ ] On branch **BASE**, matching `origin/BASE`
- [ ] Working tree clean (`git status`)
- [ ] Suggested Plan tickets: **ALE-28** or **ALE-29**
- [ ] Start a **new Agent chat** for the next demo (do not reuse the demo thread)
