const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const EVAL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(EVAL_ROOT, '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'worktree.sh');

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function createBaseEnv(tmpDir) {
  const binDir = path.join(tmpDir, 'bin');
  const logPath = path.join(tmpDir, 'calls.log');
  const worktreeBase = path.join(tmpDir, 'worktrees');
  const fakeGitCommonDir = path.join(tmpDir, 'repo-common', '.git');

  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(fakeGitCommonDir, { recursive: true });
  writeExecutable(
    path.join(binDir, 'git'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "git $*" >> "${logPath}"

if [[ "$1" == "-C" && "$3" == "rev-parse" && "$4" == "--git-common-dir" ]]; then
  printf '%s\\n' "${fakeGitCommonDir}"
  exit 0
fi

if [[ "$1" == "show-ref" ]]; then
  exit 1
fi

if [[ "$1" == "worktree" && "$2" == "list" ]]; then
  exit 0
fi

if [[ "$1" == "worktree" && "$2" == "add" ]]; then
  if [[ "$3" == "-b" ]]; then
    path="$5"
  else
    path="$3"
  fi
  mkdir -p "$path/app" "$path/tests/evals"
  printf '{"private":true}\\n' > "$path/app/package.json"
  printf '{"lockfileVersion":3}\\n' > "$path/app/package-lock.json"
  printf '{"private":true}\\n' > "$path/tests/evals/package.json"
  printf '{"lockfileVersion":3}\\n' > "$path/tests/evals/package-lock.json"
  exit 0
fi

echo "unexpected git invocation: $*" >&2
exit 99
`,
  );
  writeExecutable(
    path.join(binDir, 'npm'),
    `#!/usr/bin/env bash
set -euo pipefail
echo "npm $*" >> "${logPath}"
exit 0
`,
  );

  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      WORKTREE_BASE_DIR: worktreeBase,
    },
    logPath,
    worktreeBase,
  };
}

test('worktree helper leaves Promptfoo state setup to the eval runtime', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-builder-worktree-'));
  const promptfooRoot = path.join(REPO_ROOT, 'tests', 'evals', '.promptfoo');
  const promptfooWasPresent = fs.existsSync(promptfooRoot);
  const promptfooWasSymlink = promptfooWasPresent && fs.lstatSync(promptfooRoot).isSymbolicLink();

  assert.equal(fs.existsSync(SCRIPT_PATH), true);

  try {
    const { env, logPath, worktreeBase } = createBaseEnv(tmpDir);
    const result = spawnSync(SCRIPT_PATH, ['feature/eval-state-link'], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);

    const worktreePath = path.join(worktreeBase, 'feature', 'eval-state-link');
    const worktreePromptfoo = path.join(worktreePath, 'tests', 'evals', '.promptfoo');

    assert.equal(fs.existsSync(worktreePromptfoo), false);
    assert.doesNotMatch(result.stdout, /PROMPTFOO_DB:/);
    // Only app/ deps are bootstrapped by worktree.sh; eval deps are self-managed by the eval framework.
    const npmCalls = fs.readFileSync(logPath, 'utf8').match(/npm ci --no-audit --no-fund/g) ?? [];
    assert.equal(npmCalls.length, 1);
  } finally {
    if (!promptfooWasPresent && fs.existsSync(promptfooRoot)) {
      fs.rmSync(promptfooRoot, { recursive: true, force: true });
    } else if (
      promptfooWasPresent &&
      promptfooWasSymlink &&
      fs.existsSync(promptfooRoot) &&
      !fs.lstatSync(promptfooRoot).isSymbolicLink()
    ) {
      fs.rmSync(promptfooRoot, { recursive: true, force: true });
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('worktree helper does not create legacy sidecar dist content in the created worktree', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-builder-worktree-'));

  try {
    const { env, worktreeBase } = createBaseEnv(tmpDir);
    const result = spawnSync(SCRIPT_PATH, ['feature/no-sidecar-dist-bootstrap'], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);

    const worktreeSidecarDist = path.join(
      worktreeBase,
      'feature',
      'no-sidecar-dist-bootstrap',
      'app',
      'sidecar',
      'dist',
    );

    assert.equal(fs.existsSync(worktreeSidecarDist), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
