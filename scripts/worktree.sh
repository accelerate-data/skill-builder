#!/usr/bin/env bash
set -euo pipefail

# Maintainer helper for this repository only.
# Use this from the Skill Builder repo root to create contributor development
# worktrees. Promptfoo state is exported by the eval runtime when evals run.

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <branch-name>" >&2
  exit 1
fi

branch="$1"

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
worktree_base="${WORKTREE_BASE_DIR:-$repo_root/../worktrees}"
worktree_path="$worktree_base/$branch"

retry_command() {
  printf '%s %s' "$0" "$branch"
}

json_error() {
  local code="$1"
  local step="$2"
  local message="$3"
  local can_retry="$4"
  local retry_command="$5"
  local suggested_fix="$6"
  local existing_worktree_path="${7:-}"
  BRANCH="$branch" \
  REQUESTED_WORKTREE_PATH="$worktree_path" \
  CODE="$code" \
  STEP="$step" \
  MESSAGE="$message" \
  CAN_RETRY="$can_retry" \
  RETRY_COMMAND="$retry_command" \
  SUGGESTED_FIX="$suggested_fix" \
  EXISTING_WORKTREE_PATH="$existing_worktree_path" \
  python3 - <<'PY' >&2
import json
import os

payload = {
    "code": os.environ["CODE"],
    "step": os.environ["STEP"],
    "message": os.environ["MESSAGE"],
    "branch": os.environ["BRANCH"],
    "requested_worktree_path": os.environ["REQUESTED_WORKTREE_PATH"],
    "can_retry": os.environ["CAN_RETRY"].lower() == "true",
    "retry_command": os.environ["RETRY_COMMAND"],
    "suggested_fix": os.environ["SUGGESTED_FIX"],
}
existing = os.environ.get("EXISTING_WORKTREE_PATH")
if existing:
    payload["existing_worktree_path"] = existing
print(json.dumps(payload))
PY
  exit 1
}

run_in_dir() {
  local dir="$1"
  shift
  (
    cd "$dir" &&
      "$@"
  )
}

link_env_file() {
  local env_src="$repo_root/.env"
  local env_dst="$worktree_path/.env"

  if [[ ! -f "$env_src" ]]; then
    echo "ENV: skipped (no .env in $repo_root)"
    return
  fi

  rm -f "$env_dst"
  ln -s "$env_src" "$env_dst"
  echo "ENV: symlink $env_dst -> $env_src"
}

bootstrap_app_dependencies() {
  local app_dir="$worktree_path/app"
  local npm_command=(
    install
    --no-audit
    --no-fund
  )
  local npm_command_str="npm install --no-audit --no-fund"

  if [[ ! -f "$app_dir/package.json" ]]; then
    echo "npm: skipped app dependencies (no package.json in app)"
    return
  fi

  if [[ -f "$app_dir/package-lock.json" ]]; then
    npm_command=(
      ci
      --no-audit
      --no-fund
    )
    npm_command_str="npm ci --no-audit --no-fund"
  fi

  echo "npm: ensuring app dependencies in $app_dir with $npm_command_str"
  run_in_dir "$app_dir" npm "${npm_command[@]}" || json_error \
    "WORKTREE_APP_NPM_INSTALL_FAILED" \
    "app_npm_install" \
    "npm dependency bootstrap failed for app dependencies." \
    "true" \
    "$(retry_command)" \
    "Run 'cd $app_dir && $npm_command_str' to repair app dependencies, then rerun the worktree command."
}

existing_branch_worktree() {
  local target_branch="$1"
  local current_path=""
  local current_branch=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$line" ]]; then
      if [[ "$current_branch" == "refs/heads/$target_branch" ]]; then
        printf '%s\n' "$current_path"
        return 0
      fi
      current_path=""
      current_branch=""
      continue
    fi
    case "$line" in
      worktree\ *) current_path="${line#worktree }" ;;
      branch\ *) current_branch="${line#branch }" ;;
    esac
  done < <(git worktree list --porcelain)

  if [[ "$current_branch" == "refs/heads/$target_branch" ]]; then
    printf '%s\n' "$current_path"
  fi
}

bootstrap_worktree() {
  link_env_file
  bootstrap_app_dependencies
}

ensure_worktree_base() {
  mkdir -p "$(dirname "$worktree_path")"
}

branch_exists() {
  git show-ref --verify --quiet "refs/heads/$branch"
}

handle_existing_worktree() {
  local checked_out_path="$1"

  if [[ -n "$checked_out_path" && "$checked_out_path" != "$worktree_path" ]]; then
    json_error \
      "WORKTREE_BRANCH_ALREADY_CHECKED_OUT" \
      "branch_conflict" \
      "Branch is already checked out in another worktree." \
      "false" \
      "" \
      "Use the existing worktree or remove it before requesting a new worktree for this branch." \
      "$checked_out_path"
  fi

  if [[ -n "$checked_out_path" ]]; then
    echo "worktree: branch already attached at $worktree_path; rerunning bootstrap"
    bootstrap_worktree
    echo "worktree: ready $worktree_path"
    exit 0
  fi
}

main() {
  local checked_out_path=""
  local branch_present=false

  ensure_worktree_base
  if branch_exists; then
    branch_present=true
  fi
  checked_out_path="$(existing_branch_worktree "$branch")"
  handle_existing_worktree "$checked_out_path"
  if $branch_present; then
    git worktree add "$worktree_path" "$branch"
  else
    git worktree add -b "$branch" "$worktree_path" HEAD
  fi
  echo "worktree: created worktree at $worktree_path"
  bootstrap_worktree
  echo "worktree: ready $worktree_path"
}

main "$@"
