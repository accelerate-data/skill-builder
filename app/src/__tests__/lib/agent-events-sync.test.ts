import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("AgentEvent type sync", () => {
  const frontendPath = path.resolve(__dirname, "../../lib/agent-events.ts");
  const rustPath = path.resolve(
    __dirname,
    "../../../src-tauri/src/contracts/agent_events.rs",
  );

  function extractVersion(filePath: string): number {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/AGENT_EVENTS_VERSION[^=]*=\s*(\d+)/);
    if (!match) throw new Error(`No AGENT_EVENTS_VERSION found in ${filePath}`);
    return parseInt(match[1], 10);
  }

  it("frontend and Rust expose the same version marker", () => {
    expect(extractVersion(frontendPath)).toBeGreaterThan(0);
    expect(extractVersion(frontendPath)).toBe(extractVersion(rustPath));
  });

  it("frontend imports from generated contracts", () => {
    const content = fs.readFileSync(frontendPath, "utf8");
    expect(content).toContain("@/generated/contracts");
  });

  it("frontend re-exports AgentEvent", () => {
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(frontendContent).toMatch(/export\s+type\s*\{[^}]*AgentEvent/);
  });

  it("frontend re-exports AgentEventEnvelope", () => {
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    expect(frontendContent).toMatch(/AgentEventEnvelope/);
  });
});
