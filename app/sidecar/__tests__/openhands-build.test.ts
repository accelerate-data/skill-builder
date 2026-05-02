import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sidecarDir = path.resolve(__dirname, "..");
const buildScriptPath = path.join(sidecarDir, "openhands", "build.sh");

describe("openhands PyInstaller build script", () => {
  it("bundles SDK dependency data and metadata needed by packaged imports", () => {
    const script = fs.readFileSync(buildScriptPath, "utf8");

    expect(script).toContain('--collect-data "binaryornot"');
    expect(script).toContain('--collect-data "litellm"');
    expect(script).toContain('--copy-metadata "binaryornot"');
    expect(script).toContain('--copy-metadata "browser-use"');
    expect(script).toContain('--copy-metadata "fastmcp"');
    expect(script).toContain('--copy-metadata "litellm"');
    expect(script).toContain('--copy-metadata "mcp"');
  });
});
