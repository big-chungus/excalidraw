#!/usr/bin/env bash
# Reset local git state after a Cursor 101 demo (destructive).
# Usage: ./reset.sh [--prune-remote]
set -euo pipefail

PRUNE_REMOTE=0
for arg in "$@"; do
  case "$arg" in
    --prune-remote) PRUNE_REMOTE=1 ;;
    -h | --help)
      echo "Usage: $(basename "$0") [--prune-remote]"
      echo "  Resets checkout to origin/BASE, cleans untracked files (with safe excludes),"
      echo "  and deletes merged local demo branches (demo/*, ale-*)."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

detect_base() {
  if git rev-parse --verify "origin/demo-base" >/dev/null 2>&1; then
    echo "demo-base"
  elif git rev-parse --verify "origin/main" >/dev/null 2>&1; then
    echo "main"
  else
    echo "master"
  fi
}

echo "==> Fetching origin..."
git fetch origin

BASE="$(detect_base)"
echo "==> Demo base branch (BASE): ${BASE}"

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

echo "==> Removing merged local demo branches (demo/*, ale-*)..."
while IFS= read -r branch; do
  [[ -z "${branch}" ]] && continue
  [[ "${branch}" == "${BASE}" ]] && continue
  if [[ "${branch}" == demo/* ]] || [[ "${branch}" == ale-* ]]; then
    if git branch -d "${branch}" 2>/dev/null; then
      echo "    deleted (merged): ${branch}"
    else
      echo "    SKIP unmerged: ${branch} (ask before: git branch -D ${branch})" >&2
    fi
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads/)

if [[ "${PRUNE_REMOTE}" -eq 1 ]]; then
  echo "==> Pruning stale remote-tracking branches..."
  git remote prune origin
fi

echo "==> Git reset complete. On ${BASE} @ origin/${BASE}"
git status -sb
