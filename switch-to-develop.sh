#!/usr/bin/env bash
set -euo pipefail

DEFAULT_WORKTREE="/Users/cvntress/Documents/git/mcp-documentation-server"
DEV_WORKTREE="${DEV_WORKTREE:-$DEFAULT_WORKTREE}"

usage() {
  echo "Usage: $0 [--worktree PATH]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worktree)
      if [[ -z "${2:-}" ]]; then
        echo "ERROR: --worktree requires a path." >&2
        usage
        exit 1
      fi
      DEV_WORKTREE="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument '$1'." >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if ! git -C "$DEV_WORKTREE" rev-parse --git-dir > /dev/null 2>&1; then
  echo "Dev worktree not found at $DEV_WORKTREE" >&2
  exit 1
fi

auto_stash_ref=""
if [ -n "$(git -C "$DEV_WORKTREE" status --porcelain)" ]; then
  stash_message="auto-stash before switch-to-develop"
  git -C "$DEV_WORKTREE" stash push -u -m "$stash_message" >/dev/null
  auto_stash_ref="$(git -C "$DEV_WORKTREE" stash list -1 --format=%gd)"
  if [[ -z "$auto_stash_ref" ]]; then
    echo "ERROR: Failed to create stash for dev worktree changes." >&2
    exit 1
  fi
  echo "Stashed local changes as $auto_stash_ref"
fi

if ! git -C "$DEV_WORKTREE" show-ref --verify --quiet refs/heads/develop; then
  echo "Develop branch not found in dev worktree. Fetch or create it first." >&2
  exit 1
fi

echo "Switching dev worktree to 'develop' in $DEV_WORKTREE"
if ! git -C "$DEV_WORKTREE" checkout develop; then
  if [[ -n "$auto_stash_ref" ]]; then
    echo "WARNING: Checkout failed. Your changes remain stashed as $auto_stash_ref." >&2
  fi
  exit 1
fi

if [[ -n "$auto_stash_ref" ]]; then
  if ! git -C "$DEV_WORKTREE" stash pop "$auto_stash_ref"; then
    echo "WARNING: Unable to reapply stashed changes. Resolve conflicts and run 'git stash list' to locate $auto_stash_ref." >&2
    exit 1
  fi
fi

echo "Dev worktree ready at $DEV_WORKTREE"
