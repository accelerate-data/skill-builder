import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("AgentEvent type sync", () => {
  const sidecarPath = path.resolve(__dirname, "../../../sidecar/agent-events.ts");
  const frontendPath = path.resolve(__dirname, "../../lib/agent-events.ts");

  function extractVersion(filePath: string): number {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/AGENT_EVENTS_VERSION\s*=\s*(\d+)/);
    if (!match) throw new Error(`No AGENT_EVENTS_VERSION found in ${filePath}`);
    return parseInt(match[1], 10);
  }

  it("version numbers match", () => {
    expect(extractVersion(frontendPath)).toBe(extractVersion(sidecarPath));
  });

  it("frontend imports from generated contracts", () => {
    const content = fs.readFileSync(frontendPath, "utf8");
    expect(content).toContain("@/generated/contracts");
  });

  it("sidecar imports from generated contracts", () => {
    const content = fs.readFileSync(sidecarPath, "utf8");
    expect(content).toContain("./generated/contracts");
  });

  it("both files re-export AgentEvent", () => {
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    expect(frontendContent).toMatch(/export\s+type\s*\{[^}]*AgentEvent/);
    expect(sidecarContent).toMatch(/export\s+type\s+AgentEvent\b/);
  });

  it("both files re-export AgentEventEnvelope", () => {
    const frontendContent = fs.readFileSync(frontendPath, "utf8");
    const sidecarContent = fs.readFileSync(sidecarPath, "utf8");
    expect(frontendContent).toMatch(/AgentEventEnvelope/);
    expect(sidecarContent).toMatch(/AgentEventEnvelope/);
  });
});
