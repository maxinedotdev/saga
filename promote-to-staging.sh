#!/usr/bin/env bash
set -euo pipefail

# Default to a sibling directory named saga-staging
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_WORKTREE="${SCRIPT_DIR%/*}/saga-staging"
STAGING_WORKTREE="${STAGING_WORKTREE:-$DEFAULT_WORKTREE}"
PUSH=false

usage() {
  echo "Usage: $0 [--worktree PATH] [--push]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worktree)
      if [[ -z "${2:-}" ]]; then
        echo "ERROR: --worktree requires a path." >&2
        usage
        exit 1
      fi
      STAGING_WORKTREE="$2"
      shift
      ;;
    --push)
      PUSH=true
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

if ! git -C "$STAGING_WORKTREE" rev-parse --git-dir > /dev/null 2>&1; then
  echo "Staging worktree not found at $STAGING_WORKTREE" >&2
  exit 1
fi

auto_stash_ref=""
if [ -n "$(git -C "$STAGING_WORKTREE" status --porcelain)" ]; then
  stash_message="auto-stash before promote-to-staging"
  git -C "$STAGING_WORKTREE" stash push -u -m "$stash_message" >/dev/null
  auto_stash_ref="$(git -C "$STAGING_WORKTREE" stash list -1 --format=%gd)"
  if [[ -z "$auto_stash_ref" ]]; then
    echo "ERROR: Failed to create stash for staging worktree changes." >&2
    exit 1
  fi
  echo "Stashed local changes as $auto_stash_ref"
fi

current_branch="$(git -C "$STAGING_WORKTREE" symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ "$current_branch" != "staging" ]]; then
  echo "Staging worktree is on '$current_branch'. Switch to 'staging' before promoting." >&2
  exit 1
fi

if ! git -C "$STAGING_WORKTREE" show-ref --verify --quiet refs/heads/develop; then
  echo "Develop branch not found in staging worktree. Fetch or create it first." >&2
  exit 1
fi

echo "Merging 'develop' into 'staging' in $STAGING_WORKTREE"
if ! git -C "$STAGING_WORKTREE" merge --no-edit develop; then
  if [[ -n "$auto_stash_ref" ]]; then
    echo "WARNING: Merge failed. Your changes remain stashed as $auto_stash_ref." >&2
  fi
  exit 1
fi

echo "Running build in staging worktree"
if ! npm --prefix "$STAGING_WORKTREE" run build; then
  if [[ -n "$auto_stash_ref" ]]; then
    echo "WARNING: Build failed. Your changes remain stashed as $auto_stash_ref." >&2
  fi
  exit 1
fi

push_failed=false
if $PUSH; then
  echo "Pushing 'staging' to origin"
  if ! git -C "$STAGING_WORKTREE" push origin staging; then
    push_failed=true
  fi
fi

if [ -n "$(git -C "$STAGING_WORKTREE" status --porcelain --untracked-files=no)" ]; then
  echo "Staging worktree has uncommitted changes after promotion. Resolve and retry." >&2
  if [[ -n "$auto_stash_ref" ]]; then
    echo "WARNING: Your original changes are stashed as $auto_stash_ref." >&2
  fi
  exit 1
fi

if [[ -n "$auto_stash_ref" ]]; then
  if ! git -C "$STAGING_WORKTREE" stash pop "$auto_stash_ref"; then
    echo "WARNING: Unable to reapply stashed changes. Resolve conflicts and run 'git stash list' to locate $auto_stash_ref." >&2
    exit 1
  fi
fi

if $push_failed; then
  echo "WARNING: Push failed. Staging was updated locally, but origin was not." >&2
  exit 1
fi

echo "Staging updated and rebuilt."
