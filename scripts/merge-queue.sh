#!/bin/bash
# merge-queue.sh — sequential merge with conflict detection
# Usage: merge-queue.sh <branch1> [branch2 ...]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
FAILED=()

for BRANCH in "$@"; do
  echo "=== merge-queue: ${BRANCH} ==="
  if git merge --no-edit "${BRANCH}" 2>&1; then
    echo "[merge-queue] merged: ${BRANCH}"
  else
    echo "[merge-queue] CONFLICT: ${BRANCH}"
    FAILED+=("${BRANCH}")
    git merge --abort
  fi
done

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "[merge-queue] FAILED branches (conflict, requeue): ${FAILED[*]}"
  exit 1
fi

echo "[merge-queue] all clear"
