import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { HELP_URLS, getHelpUrl, getWorkflowStepUrl } from "@/lib/help-urls";

const DOCS_ROOT = resolve(__dirname, "../../../../docs/user-guide");

/** Convert a help URL path segment to the corresponding markdown file. */
function urlToFile(url: string): string {
  const base = "https://hbanerjee74.github.io/skill-builder";
  const segment = url.replace(base, "") || "/";
  if (segment === "/") return resolve(DOCS_ROOT, "index.md");
  return resolve(DOCS_ROOT, `${segment.replace(/^\//, "")}.md`);
}

describe("help-urls", () => {
  describe("every HELP_URLS entry maps to an existing docs page", () => {
    for (const [route, url] of Object.entries(HELP_URLS)) {
      it(`${route} → ${url}`, () => {
        const file = urlToFile(url);
        expect(existsSync(file), `Missing doc file: ${file}`).toBe(true);
      });
    }
  });

  describe("every workflow step URL maps to an existing docs page", () => {
    for (const step of [0, 1, 2, 3]) {
      it(`step ${step}`, () => {
        const url = getWorkflowStepUrl(step);
        const file = urlToFile(url);
        expect(existsSync(file), `Missing doc file: ${file}`).toBe(true);
      });
    }
  });

  it("getHelpUrl falls back to base URL for unknown routes", () => {
    const url = getHelpUrl("/nonexistent-page");
    expect(url).toContain("/skill-builder/");
    const file = urlToFile(url);
    expect(existsSync(file)).toBe(true);
  });

  it("getWorkflowStepUrl falls back to overview for unknown steps", () => {
    const url = getWorkflowStepUrl(99);
    const file = urlToFile(url);
    expect(existsSync(file)).toBe(true);
  });
});
