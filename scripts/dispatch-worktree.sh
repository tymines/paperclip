#!/bin/bash
# dispatch-worktree.sh — create isolated git worktree for a task
# Usage: dispatch-worktree.sh <task-id> [base-ref]
set -euo pipefail

TASK="${1:?usage: dispatch-worktree.sh <task-id> [base-ref]}"
BASE="${2:-master}"
WT_ROOT=".paperclip/worktrees"
BRANCH="feat/${TASK}"
WT_PATH="${WT_ROOT}/${TASK}"

cd "$(git rev-parse --show-toplevel)"

# Idempotent: clean up stale worktree if exists
if git worktree list | grep -q " ${WT_PATH} "; then
  echo "[dispatch] removing stale worktree: ${WT_PATH}"
  git worktree remove --force "${WT_PATH}" 2>/dev/null || true
  git branch -D "${BRANCH}" 2>/dev/null || true
fi

echo "[dispatch] creating worktree: ${WT_PATH} (base=${BASE})"
git worktree add "${WT_PATH}" -b "${BRANCH}" "${BASE}"

echo "[dispatch] ready: ${WT_PATH}"
echo "WT_PATH=${WT_PATH}"
echo "BRANCH=${BRANCH}"
