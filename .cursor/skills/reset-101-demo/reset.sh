#!/usr/bin/env bash
# Full hard reset after a Cursor 101 demo (destructive).
# Usage: ./reset.sh [--local-only] [--prune-remote]
#
# Default: restore origin/demo-base to tag demo-reset (force-push),
# revert merged demo PRs on master, close leftover demo PRs, delete
# demo branches, then hard-reset the local checkout to origin/BASE.
set -euo pipefail

LOCAL_ONLY=0
PRUNE_REMOTE=0
for arg in "$@"; do
  case "$arg" in
    --local-only) LOCAL_ONLY=1 ;;
    --prune-remote) PRUNE_REMOTE=1 ;;
    -h | --help)
      echo "Usage: $(basename "$0") [--local-only] [--prune-remote]"
      echo "  Restores the demo fork to the pinned demo-reset tag, reverts"
      echo "  merged demo PRs on master, closes leftover demo PRs, and"
      echo "  deletes demo branches. --local-only skips GitHub rewrites."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

PIN_TAG="demo-reset"
DEMO_FORK_SUBSTR="big-chungus/excalidraw"

origin_url() {
  git remote get-url origin 2>/dev/null || true
}

origin_repo() {
  origin_url | sed -E 's#(git@github\.com:|https://github\.com/)##' | sed 's/\.git$//'
}

is_demo_fork() {
  [[ "$(origin_url)" == *"${DEMO_FORK_SUBSTR}"* ]]
}

detect_base() {
  if git rev-parse --verify "origin/demo-base" >/dev/null 2>&1; then
    echo "demo-base"
  elif git rev-parse --verify "origin/main" >/dev/null 2>&1; then
    echo "main"
  else
    echo "master"
  fi
}

is_protected_ref() {
  case "$1" in
    master | main | demo-base | HEAD | "${PIN_TAG}" | demo-reset-master) return 0 ;;
    cursor/reset-101-demo*) return 0 ;;
  esac
  return 1
}

is_demo_work_ref() {
  local b="$1"
  is_protected_ref "$b" && return 1
  [[ "$b" == demo/* || "$b" == ale-* || "$b" == adb-* ]] && return 0
  [[ "$b" == cursor/adb-* || "$b" == cursor/ale-* || "$b" == cursor/test-* ]] && return 0
  [[ "$b" == */ale-* || "$b" == */adb-* ]] && return 0
  return 1
}

ensure_pin_tag() {
  local branch="$1"
  if git rev-parse --verify "refs/tags/${PIN_TAG}" >/dev/null 2>&1; then
    return 0
  fi
  echo "==> Creating pin tag ${PIN_TAG} at origin/${branch} (first run, no rewrite)"
  git tag "${PIN_TAG}" "origin/${branch}"
  if [[ "${LOCAL_ONLY}" -eq 0 ]] && is_demo_fork; then
    git push origin "refs/tags/${PIN_TAG}"
  fi
}

restore_base_to_pin() {
  local branch="$1"
  ensure_pin_tag "${branch}"
  local pin sha
  pin="$(git rev-parse "${PIN_TAG}^{commit}")"
  sha="$(git rev-parse "origin/${branch}")"
  if [[ "${pin}" == "${sha}" ]]; then
    echo "==> origin/${branch} already matches ${PIN_TAG} (${pin:0:8})"
    return 0
  fi
  if [[ "${LOCAL_ONLY}" -eq 1 ]]; then
    echo "==> --local-only: not force-pushing origin/${branch} (ahead of ${PIN_TAG})" >&2
    return 0
  fi
  if ! is_demo_fork; then
    echo "Refusing to force-push: origin is not ${DEMO_FORK_SUBSTR}" >&2
    exit 1
  fi
  echo "==> Force-pushing origin/${branch} to ${PIN_TAG} (${pin:0:8})"
  git push --force origin "${PIN_TAG}:refs/heads/${branch}"
}

revert_merged_demo_prs() {
  local repo="$1"
  if [[ "${LOCAL_ONLY}" -eq 1 ]]; then
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "==> gh not found; skip reverting merged PRs" >&2
    return 0
  fi

  echo "==> Reverting merged demo PRs on master..."
  local rows=()
  while IFS=$'\t' read -r number head merge_oid; do
    [[ -z "${number}" ]] && continue
    is_demo_work_ref "${head}" || continue
    [[ -z "${merge_oid}" || "${merge_oid}" == "null" ]] && continue
    if ! git merge-base --is-ancestor "${merge_oid}" "origin/master" 2>/dev/null; then
      continue
    fi
    rows+=("${number}"$'\t'"${head}"$'\t'"${merge_oid}")
  done < <(
    gh pr list --repo "${repo}" --state merged --base master --limit 50 \
      --json number,headRefName,mergeCommit \
      --jq '.[] | [.number, .headRefName, (.mergeCommit.oid // "")] | @tsv'
  )

  if [[ "${#rows[@]}" -eq 0 ]]; then
    echo "    none"
    return 0
  fi

  git checkout master
  git reset --hard "origin/master"
  local row number head merge_oid
  for row in "${rows[@]}"; do
    IFS=$'\t' read -r number head merge_oid <<<"${row}"
    echo "    reverting merged PR #${number} (${merge_oid:0:8}, ${head})"
    if git rev-parse "${merge_oid}^2" >/dev/null 2>&1; then
      git revert -m 1 --no-edit "${merge_oid}"
    else
      git revert --no-edit "${merge_oid}"
    fi
  done
  git push origin master
  git fetch origin
}

close_open_demo_prs() {
  local repo="$1"
  if [[ "${LOCAL_ONLY}" -eq 1 ]]; then
    return 0
  fi
  if ! command -v gh >/dev/null 2>&1; then
    echo "==> gh not found; skip closing open PRs" >&2
    return 0
  fi

  echo "==> Closing leftover demo PRs..."
  local closed=0
  while IFS=$'\t' read -r number head; do
    [[ -z "${number}" ]] && continue
    is_demo_work_ref "${head}" || continue
    echo "    closing #${number} (${head})"
    gh pr close "${number}" --repo "${repo}" \
      --comment "Closed by reset-101-demo." \
      --delete-branch || true
    closed=1
  done < <(
    gh pr list --repo "${repo}" --state open --limit 50 \
      --json number,headRefName \
      --jq '.[] | [.number, .headRefName] | @tsv'
  )
  if [[ "${closed}" -eq 0 ]]; then
    echo "    none"
  fi
}

delete_remote_demo_branches() {
  if [[ "${LOCAL_ONLY}" -eq 1 ]]; then
    return 0
  fi
  echo "==> Deleting remote demo branches..."
  local deleted=0
  while IFS= read -r ref; do
    local branch="${ref#origin/}"
    is_demo_work_ref "${branch}" || continue
    echo "    deleting origin/${branch}"
    git push origin --delete "${branch}" || true
    deleted=1
  done < <(git for-each-ref --format='%(refname:short)' refs/remotes/origin/)
  if [[ "${deleted}" -eq 0 ]]; then
    echo "    none"
  fi
}

delete_local_demo_branches() {
  local base="$1"
  echo "==> Deleting local demo branches..."
  while IFS= read -r branch; do
    [[ -z "${branch}" || "${branch}" == "${base}" ]] && continue
    is_demo_work_ref "${branch}" || continue
    if git branch -d "${branch}" 2>/dev/null; then
      echo "    deleted (merged): ${branch}"
    elif git branch -D "${branch}" 2>/dev/null; then
      echo "    deleted (was unmerged): ${branch}"
    fi
  done < <(git for-each-ref --format='%(refname:short)' refs/heads/)
}

echo "==> Fetching origin (with tags)..."
git fetch origin --tags --prune

BASE="$(detect_base)"
REPO="$(origin_repo)"
echo "==> Demo base branch (BASE): ${BASE}"
echo "==> Origin repo: ${REPO}"

if [[ "${LOCAL_ONLY}" -eq 0 ]] && ! is_demo_fork; then
  echo "Refusing remote rewrite: origin is not ${DEMO_FORK_SUBSTR}" >&2
  echo "Re-run with --local-only for a checkout-only reset." >&2
  exit 1
fi

if git rev-parse --verify "origin/${BASE}" >/dev/null 2>&1; then
  restore_base_to_pin "${BASE}"
  git fetch origin --tags --prune
fi

if git rev-parse --verify "origin/master" >/dev/null 2>&1; then
  revert_merged_demo_prs "${REPO}"
fi

close_open_demo_prs "${REPO}"
delete_remote_demo_branches

if [[ "${PRUNE_REMOTE}" -eq 1 ]]; then
  echo "==> Pruning stale remote-tracking branches..."
  git remote prune origin
fi

echo "==> Checking out ${BASE} and hard-resetting to origin/${BASE}..."
git checkout "${BASE}"
git reset --hard "origin/${BASE}"

echo "==> Removing untracked files (keeping node_modules, .env*, credentials)..."
git clean -fd \
  -e node_modules \
  -e .env \
  -e .env.local \
  -e '.env.*' \
  -e '.npmrc' \
  -e '.yarnrc.yml'

delete_local_demo_branches "${BASE}"

echo "==> Git reset complete. On ${BASE} @ origin/${BASE}"
git status -sb
git log -1 --oneline
