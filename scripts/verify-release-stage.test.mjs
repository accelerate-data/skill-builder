import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyReleaseStage } from "./verify-release-stage.mjs";

const WINDOWS_REQUIRED_PATHS = [
  "skill-builder.exe",
  "sidecar/dist/package.json",
  "sidecar/dist/bootstrap.js",
  "sidecar/dist/agent-runner.js",
  "sidecar/dist/openhands/openhands-runner.exe",
  "agent-sources/plugins/skill-creator/LICENSE.txt",
  "agent-sources/skills/skill-test/SKILL.md",
  "workspace/CLAUDE.md",
  "workspace/prompts/workflow-step.txt",
];

const MACOS_REQUIRED_PATHS = [
  "Skill Builder.app",
  "run.sh",
  "Skill Builder.app/Contents/Resources/sidecar/dist/package.json",
  "Skill Builder.app/Contents/Resources/sidecar/dist/bootstrap.js",
  "Skill Builder.app/Contents/Resources/sidecar/dist/agent-runner.js",
  "Skill Builder.app/Contents/Resources/sidecar/dist/openhands/openhands-runner",
  "Skill Builder.app/Contents/Resources/agent-sources/plugins/skill-creator/LICENSE.txt",
  "Skill Builder.app/Contents/Resources/agent-sources/skills/skill-test/SKILL.md",
  "Skill Builder.app/Contents/Resources/workspace/CLAUDE.md",
  "Skill Builder.app/Contents/Resources/workspace/prompts/workflow-step.txt",
];

const scriptPath = fileURLToPath(new URL("./verify-release-stage.mjs", import.meta.url));

function makeStage(requiredPaths) {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-release-"));

  for (const relativePath of requiredPaths) {
    const path = join(root, relativePath);
    if (relativePath.endsWith(".app")) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "fixture\n");
  }

  return root;
}

test("verifyReleaseStage accepts a complete Windows stage", () => {
  const root = makeStage(WINDOWS_REQUIRED_PATHS);

  try {
    assert.deepEqual(verifyReleaseStage(root, "windows"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseStage reports every missing Windows required path", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-release-missing-"));

  try {
    assert.deepEqual(verifyReleaseStage(root, "windows"), WINDOWS_REQUIRED_PATHS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseStage accepts a complete macOS stage", () => {
  const root = makeStage(MACOS_REQUIRED_PATHS);

  try {
    assert.deepEqual(verifyReleaseStage(root, "macos"), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verifyReleaseStage throws for an unknown platform", () => {
  assert.throws(
    () => verifyReleaseStage("/tmp/release-stage", "linux"),
    /Unknown release platform: linux/,
  );
});

test("CLI prints missing paths and exits 1 when the stage is incomplete", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-release-cli-missing-"));

  try {
    const result = spawnSync(process.execPath, [scriptPath, root, "macos"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Release stage is missing 10 required path\(s\):/);
    assert.match(result.stderr, /- Skill Builder\.app/);
    assert.match(result.stderr, /- run\.sh/);
    assert.match(result.stderr, /- Skill Builder\.app\/Contents\/Resources\/sidecar\/dist\/openhands\/openhands-runner/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exits 2 for bad usage", () => {
  const result = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Usage: node scripts\/verify-release-stage\.mjs <stage-dir> <windows\|macos>/,
  );
});

test("CLI prints success and exits 0 when the stage is complete", () => {
  const root = makeStage(MACOS_REQUIRED_PATHS);

  try {
    const result = spawnSync(process.execPath, [scriptPath, root, "macos"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Release stage verified for macos:/);
    assert.match(result.stdout, new RegExp(root.replaceAll("\\", "\\\\")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
