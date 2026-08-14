---
name: reset-101-demo
description: Use after a Cursor 101 customer demo when the fork has dirty working trees, leftover demo branches, or factory-merged PRs from the identify ticket → Ask → Plan → Work → commit/merge flow. Destructively restores git (including merged demo PRs) to the pinned demo-reset tag and moves Linear demo tickets back to Backlog.
---

# Reset Cursor 101 demo state

## Warning (say this first)

This is **destructive**. You will:

- Force-push `origin/demo-base` back to the `demo-reset` tag (this drops merged demo PRs on BASE).
- Revert merged demo PRs on `master` (ADB/ALE/factory branches) and push those reverts.
- Close leftover open demo PRs and delete matching remote/local branches.
- Hard-reset the local checkout to `origin/BASE` and remove untracked files (except `node_modules`, `.env*`, and common local credential files).
- Move Linear issues in **Excalidraw 101 Demo** back to **Backlog** (issues are not deleted).

Confirm the FE wants to proceed, then execute. Origin must be `big-chungus/excalidraw`.

## 1. Detect BASE

Prefer remote branches on `origin`:

1. `demo-base` if `origin/demo-base` exists
2. else `main` if `origin/main` exists
3. else `master`

Call this branch **BASE**.

## 2. Git + GitHub reset

From the repository root, run:

```bash
bash .cursor/skills/reset-101-demo/reset.sh
```

Optional:

- `--local-only` skips force-push, PR close/revert, and remote branch deletes
- `--prune-remote` also runs `git remote prune origin`

The script:

1. Fetches origin (with tags)
2. Creates tag `demo-reset` at `origin/BASE` on first run if missing
3. Force-pushes `origin/BASE` to `demo-reset` when they differ
4. Reverts merged PRs into `master` whose head matches demo/factory branch names (`demo/*`, `ale-*`, `adb-*`, `cursor/adb-*`, `cursor/ale-*`, `cursor/test-*`, `*/ale-*`, `*/adb-*`). Does not touch `cursor/reset-101-demo*`
5. Closes matching open PRs (`gh pr close --delete-branch`)
6. Deletes matching remote and local branches (including unmerged)
7. Checks out BASE, `git reset --hard origin/BASE`, and cleans untracked files

If `reset.sh` is unavailable, do the same steps by hand. Do not force-push unless origin is the demo fork.

### Moving the pin after an intentional seed change

After you mean to keep new commits on `demo-base` (new seed bug, skill already merged into BASE):

```bash
git tag -f demo-reset origin/demo-base
git push -f origin demo-reset
```

## 3. Linear reset (best-effort)

Skip this section if Linear MCP is unavailable or errors.

- Project: **Excalidraw 101 Demo** (not "Excalibur")
- Reset **ALE-22** through **ALE-37** if their state was changed during the demo
- Always reset the usual Plan tickets: **ALE-28** (CSV→table), **ALE-29** (multi-select align)

For each issue: use Linear MCP `save_issue` with `id` set to the identifier (e.g. `ALE-28`) and `state` set to **Backlog**. Do **not** delete issues. Use `list_issues` / `get_issue` to verify project membership if needed.

## 4. Demo ready checklist

Print for the FE:

- [ ] On branch **BASE**, matching `origin/BASE` and tag `demo-reset`
- [ ] Working tree clean (`git status`)
- [ ] No leftover open demo/factory PRs on `big-chungus/excalidraw`
- [ ] Suggested Plan tickets: **ALE-28** or **ALE-29**
- [ ] Start a **new Agent chat** for the next demo (do not reuse the demo thread)
