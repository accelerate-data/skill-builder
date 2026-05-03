import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditRepoMap } from "./verify-repo-map.mjs";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const scriptPath = fileURLToPath(new URL("./verify-repo-map.mjs", import.meta.url));

function copyRepoMapFixture() {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-repo-map-"));
  const source = [
    "repo-map.json",
    "app/src-tauri/src/commands",
    "app/src-tauri/src/commands/workflow",
    "app/src-tauri/src/commands/imported_skills",
    "app/src-tauri/src/commands/github_import",
    "app/src/stores",
    "app/src/pages",
  ];

  for (const relativePath of source) {
    const from = join(repoRoot, relativePath);
    const to = join(root, relativePath);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }

  return root;
}

function rewriteRepoMap(root, edit) {
  const path = join(root, "repo-map.json");
  const repoMap = JSON.parse(readFileSync(path, "utf8"));
  edit(repoMap);
  writeFileSync(path, `${JSON.stringify(repoMap, null, 2)}\n`);
}

test("auditRepoMap accepts the current checkout", () => {
  assert.deepEqual(auditRepoMap(repoRoot), []);
});

test("auditRepoMap reports filesystem entries missing from repo-map", () => {
  const root = copyRepoMapFixture();

  try {
    writeFileSync(
      join(root, "app/src-tauri/src/commands/workflow/new_step.rs"),
      "pub fn new_step() {}\n",
    );

    assert.deepEqual(auditRepoMap(root), [
      {
        section: "rust_commands.workflow",
        kind: "missing",
        entry: "new_step",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("auditRepoMap reports stale repo-map entries absent from the filesystem", () => {
  const root = copyRepoMapFixture();

  try {
    rewriteRepoMap(root, (repoMap) => {
      repoMap.modules.frontend_pages.description += ", stale_page";
    });

    assert.deepEqual(auditRepoMap(root), [
      {
        section: "frontend_pages",
        kind: "stale",
        entry: "stale_page",
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exits 1 and prints audit findings when repo-map is stale", () => {
  const root = copyRepoMapFixture();

  try {
    rewriteRepoMap(root, (repoMap) => {
      repoMap.modules.rust_commands.description =
        repoMap.modules.rust_commands.description.replace("workflow_session, ", "");
    });

    const result = spawnSync(process.execPath, [scriptPath, root], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /repo-map audit found 1 issue/);
    assert.match(result.stderr, /rust_commands\.flat missing workflow_session/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI exits 0 when repo-map matches the filesystem", () => {
  const result = spawnSync(process.execPath, [scriptPath, repoRoot], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /repo-map audit passed/);
});
