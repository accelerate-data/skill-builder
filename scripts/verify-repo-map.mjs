#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHECKS = [
  {
    section: "rust_commands.flat",
    moduleKey: "rust_commands",
    dir: "app/src-tauri/src/commands",
    extension: ".rs",
    parser: parseRustFlatFiles,
  },
  {
    section: "rust_commands.workflow",
    moduleKey: "rust_commands",
    dir: "app/src-tauri/src/commands/workflow",
    extension: ".rs",
    exclude: new Set(["mod"]),
    parser: (description) => parseRustSubmoduleFiles(description, "workflow"),
  },
  {
    section: "rust_commands.imported_skills",
    moduleKey: "rust_commands",
    dir: "app/src-tauri/src/commands/imported_skills",
    extension: ".rs",
    exclude: new Set(["mod"]),
    parser: (description) => parseRustSubmoduleFiles(description, "imported_skills"),
  },
  {
    section: "rust_commands.github_import",
    moduleKey: "rust_commands",
    dir: "app/src-tauri/src/commands/github_import",
    extension: ".rs",
    exclude: new Set(["mod"]),
    parser: (description) => parseRustSubmoduleFiles(description, "github_import"),
  },
  {
    section: "frontend_stores",
    moduleKey: "frontend_stores",
    dir: "app/src/stores",
    extension: ".ts",
    exclude: new Set(["index"]),
    parser: parseHyphenatedColonList,
  },
  {
    section: "frontend_pages",
    moduleKey: "frontend_pages",
    dir: "app/src/pages",
    extension: ".tsx",
    parser: parseColonList,
  },
];

export function auditRepoMap(repoRoot = process.cwd()) {
  const root = resolve(repoRoot);
  const repoMap = JSON.parse(readFileSync(join(root, "repo-map.json"), "utf8"));
  const findings = [];

  for (const check of CHECKS) {
    const description = repoMap.modules?.[check.moduleKey]?.description;
    if (typeof description !== "string") {
      findings.push({
        section: check.section,
        kind: "missing",
        entry: `repo-map modules.${check.moduleKey}.description`,
      });
      continue;
    }

    const actual = listModuleFiles(root, check);
    const documented = check.parser(description);

    for (const entry of difference(actual, documented)) {
      findings.push({ section: check.section, kind: "missing", entry });
    }

    for (const entry of difference(documented, actual)) {
      findings.push({ section: check.section, kind: "stale", entry });
    }
  }

  return findings;
}

function listModuleFiles(root, check) {
  return readdirSync(join(root, check.dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(check.extension))
    .map((entry) => entry.name.slice(0, -check.extension.length))
    .filter((entry) => !check.exclude?.has(entry))
    .sort();
}

function parseRustFlatFiles(description) {
  const match = description.match(/Flat files:\s*([^.]*)\./);
  if (!match) {
    return [];
  }

  return splitList(match[1].replace(/\s*\([^)]*\)/g, ""));
}

function parseRustSubmoduleFiles(description, moduleName) {
  const escapedModule = moduleName.replaceAll("_", "[_-]");
  const regex = new RegExp(`${escapedModule}/ \\(([^)]*)\\)`);
  const match = description.match(regex);
  if (!match) {
    return [];
  }

  return splitList(match[1]);
}

function parseColonList(description) {
  const list = description.split(":").slice(1).join(":");
  if (!list) {
    return [];
  }

  return splitList(list);
}

function splitList(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .map((entry) => entry.replace(/\s*\([^)]*\)/g, ""))
    .map((entry) => entry.replace(/\s+.*$/, ""))
    .map((entry) => entry.replace(/[.)]+$/, ""))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .sort();
}

function parseHyphenatedColonList(description) {
  const list = description.split(":").slice(1).join(":");
  if (!list) {
    return [];
  }

  return Array.from(new Set(list.match(/[a-z0-9]+(?:-[a-z0-9]+)+/g) ?? [])).sort();
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((entry) => !rightSet.has(entry));
}

function main() {
  const [repoRoot = process.cwd()] = process.argv.slice(2);
  const findings = auditRepoMap(repoRoot);

  if (findings.length > 0) {
    console.error(`repo-map audit found ${findings.length} issue(s):`);
    for (const finding of findings) {
      console.error(`${finding.section} ${finding.kind} ${finding.entry}`);
    }
    process.exit(1);
  }

  console.log(`repo-map audit passed: ${resolve(repoRoot)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
