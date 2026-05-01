#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://hbanerjee74.github.io/skill-builder";

export function helpLinkToMarkdownPath(docsRoot, link) {
  const normalized = normalizeHelpLink(link);
  if (normalized === "/") {
    return resolve(docsRoot, "index.md");
  }

  return resolve(docsRoot, `${normalized.replace(/^\/+/, "")}.md`);
}

export function findMissingHelpDocs(repoRoot = process.cwd()) {
  const docsRoot = resolve(repoRoot, "docs/user-guide");
  const sources = [
    "app/src/lib/help-urls.ts",
    "docs/.vitepress/config.ts",
  ];
  const missing = new Set();

  for (const source of sources) {
    const sourcePath = resolve(repoRoot, source);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const links = collectLinksFromText(readFileSync(sourcePath, "utf8"));
    for (const link of links) {
      const markdownPath = helpLinkToMarkdownPath(docsRoot, link);
      if (!existsSync(markdownPath)) {
        missing.add(`${normalizeHelpLink(link)} -> ${relative(repoRoot, markdownPath)}`);
      }
    }
  }

  return [...missing].sort();
}

function normalizeHelpLink(link) {
  const withoutBase = link.startsWith(BASE_URL) ? link.slice(BASE_URL.length) : link;
  const withoutHash = withoutBase.replace(/#.*$/, "");
  const withoutQuery = withoutHash.replace(/\?.*$/, "");
  return withoutQuery || "/";
}

function collectLinksFromText(text) {
  const links = new Set();
  const patterns = [
    /https:\/\/hbanerjee74\.github\.io\/skill-builder(\/[^`"'\s)]*)?/g,
    /\$\{BASE\}(\/[^`"'\s)]*)/g,
    /link:\s*["'](\/[^"']*)["']/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const link = match[1] ?? match[0];
      links.add(link.replace(/[`"',)]*$/, "") || "/");
    }
  }

  return [...links];
}

function main() {
  const missing = findMissingHelpDocs(process.cwd());
  if (missing.length > 0) {
    console.error("Missing help documentation targets:");
    for (const target of missing) {
      console.error(`- ${target}`);
    }
    process.exit(1);
  }

  console.log("Help documentation links verified.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
