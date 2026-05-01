import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { helpLinkToMarkdownPath, findMissingHelpDocs } from "./check-help-docs.mjs";

test("helpLinkToMarkdownPath resolves root and nested guide links", () => {
  const root = resolve("/repo/docs/user-guide");

  assert.equal(helpLinkToMarkdownPath(root, "/"), resolve("/repo/docs/user-guide/index.md"));
  assert.equal(
    helpLinkToMarkdownPath(root, "/workflow/step-1-research"),
    resolve("/repo/docs/user-guide/workflow/step-1-research.md"),
  );
  assert.equal(
    helpLinkToMarkdownPath(
      root,
      "https://hbanerjee74.github.io/skill-builder/workflow/step-1-research#details",
    ),
    resolve("/repo/docs/user-guide/workflow/step-1-research.md"),
  );
});

test("findMissingHelpDocs reports missing sidebar and app help links", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-builder-help-"));
  try {
    mkdirSync(join(root, "docs/user-guide/workflow"), { recursive: true });
    mkdirSync(join(root, "docs/.vitepress"), { recursive: true });
    mkdirSync(join(root, "app/src/lib"), { recursive: true });
    writeFileSync(join(root, "docs/user-guide/index.md"), "# Home\n");
    writeFileSync(
      join(root, "app/src/lib/help-urls.ts"),
      'const BASE = "https://hbanerjee74.github.io/skill-builder";\nexport const x = `${BASE}/workflow/missing`;\n',
    );
    writeFileSync(
      join(root, "docs/.vitepress/config.ts"),
      "export default { themeConfig: { sidebar: [{ items: [{ text: 'Missing', link: '/missing' }] }] } };\n",
    );

    const missing = findMissingHelpDocs(root);

    assert.ok(missing.includes("/workflow/missing -> docs/user-guide/workflow/missing.md"));
    assert.ok(missing.includes("/missing -> docs/user-guide/missing.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
