/**
 * Integration tests — real sidecar + browser UI.
 *
 * These tests spawn the actual Node.js sidecar with MOCK_AGENTS=true so that:
 *  - A real JSONL sidecar process runs (no simulator fakes)
 *  - Real mock-template files are streamed through MessageProcessor
 *  - Real workspace output files are written to disk
 *  - Events flow through the bridge into window.__TAURI_EVENT_HANDLERS__
 *
 * The Tauri/Rust layer is still mocked (TAURI_E2E=true), but everything
 * from the sidecar inward is the real implementation.
 *
 * Run: npm run test:e2e:integration
 */
import { test, expect } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createSidecarBridge, type SidecarBridge } from "../helpers/sidecar-bridge.js";
import { navigateToWorkflowUpdateMode, WORKFLOW_OVERRIDES } from "../helpers/workflow-helpers.js";
import { waitForAppReady } from "../helpers/app-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pre-read bundled mock template outputs so we can seed read_file overrides
// before the sidecar runs (avoids a race between agent-exit and the UI read).
const BUNDLED_CLARIFICATIONS = fs.readFileSync(
  path.join(__dirname, "../../sidecar/mock-templates/outputs/step0/context/clarifications.json"),
  "utf-8",
);
const BUNDLED_DECISIONS = fs.readFileSync(
  path.join(__dirname, "../../sidecar/mock-templates/outputs/step2/context/decisions.json"),
  "utf-8",
);
const BUNDLED_SKILL_MD = fs.readFileSync(
  path.join(__dirname, "../../sidecar/mock-templates/outputs/step3/SKILL.md"),
  "utf-8",
);

test.describe("Sidecar Integration — Research Step", { tag: "@integration" }, () => {
  let bridge: SidecarBridge;

  test.beforeEach(async () => {
    bridge = await createSidecarBridge();
  });

  test.afterEach(async () => {
    bridge.cleanup();
  });

  test("real sidecar streams init events and clears the initializing indicator", async ({ page }) => {
    const agentId = "int-agent-research-001";
    const skillName = "test-skill";

    await navigateToWorkflowUpdateMode(page, buildOverrides(bridge, skillName, agentId));

    // Agent auto-starts in update mode — init indicator must be visible.
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 8_000 });

    // Run the real sidecar in the background so we can observe the UI as events arrive.
    const runPromise = bridge.runAgent(page, "research-orchestrator", agentId, { skillName });

    // The sidecar emits init_progress(sdk_ready) early in the template, which clears
    // the init indicator once the first display_item arrives.
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible({ timeout: 20_000 });

    // Wait for the full run to complete.
    await runPromise;
  });

  test("real sidecar writes clarifications.json to the workspace", async ({ page }) => {
    const agentId = "int-agent-research-002";
    const skillName = "test-skill";

    await navigateToWorkflowUpdateMode(page, buildOverrides(bridge, skillName, agentId));
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 8_000 });

    await bridge.runAgent(page, "research-orchestrator", agentId, { skillName });

    // The mock sidecar copies mock-templates/outputs/step0/context/clarifications.json
    // into the temp workspace. Verify it landed in the right place.
    const raw = bridge.readWorkspaceFile(`${skillName}/context/clarifications.json`);
    const clarifications = JSON.parse(raw) as Record<string, unknown>;
    expect(clarifications).toHaveProperty("sections");
    expect(clarifications).toHaveProperty("metadata");
  });

  test("real sidecar events render display output in the UI", async ({ page }) => {
    const agentId = "int-agent-research-003";
    const skillName = "test-skill";

    await navigateToWorkflowUpdateMode(page, buildOverrides(bridge, skillName, agentId));
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 8_000 });

    // Start run without awaiting so we can observe the UI mid-stream.
    const runPromise = bridge.runAgent(page, "research-orchestrator", agentId, { skillName });

    // Wait for the init indicator to clear — proves at least one display_item arrived.
    await expect(page.getByTestId("agent-initializing-indicator")).not.toBeVisible({ timeout: 20_000 });

    // Display items from the mock template should be rendered (each item has data-testid="base-item").
    await expect(page.getByTestId("base-item").first()).toBeVisible({ timeout: 5_000 });

    // Finish the run cleanly.
    await runPromise;
  });

  test("agent-exit received after sidecar completes — no error state", async ({ page }) => {
    const agentId = "int-agent-research-004";
    const skillName = "test-skill";

    await navigateToWorkflowUpdateMode(page, buildOverrides(bridge, skillName, agentId));
    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 8_000 });

    await bridge.runAgent(page, "research-orchestrator", agentId, { skillName });

    // No runtime error dialog should appear.
    await expect(page.getByTestId("runtime-error-dialog")).not.toBeVisible();
    // No agent failure indicator.
    await expect(page.getByTestId("agent-error-state")).not.toBeVisible();
  });
});

test.describe("Sidecar Integration — Generate Skill Step", { tag: "@integration" }, () => {
  let bridge: SidecarBridge;

  test.beforeEach(async () => {
    bridge = await createSidecarBridge();
  });

  test.afterEach(async () => {
    bridge.cleanup();
  });

  test("real sidecar writes SKILL.md to the workspace", async ({ page }) => {
    const agentId = "int-agent-generate-001";
    const skillName = "test-skill";

    // Step 3 (generate-skill) uses a different step id and agent name.
    await navigateToWorkflowUpdateMode(page, {
      ...buildOverrides(bridge, skillName, agentId),
      // Override get_workflow_state so the page renders as if steps 0-2 are done.
      get_workflow_state: {
        run: { step_id: 3, status: "in_progress", skill_name: skillName },
        steps: [
          { step_id: 0, status: "completed" },
          { step_id: 1, status: "completed" },
          { step_id: 2, status: "completed" },
        ],
      },
    });

    await expect(page.getByTestId("agent-initializing-indicator")).toBeVisible({ timeout: 8_000 });

    await bridge.runAgent(page, "generate-skill", agentId, { skillName, stepId: 3 });

    // The mock sidecar copies mock-templates/outputs/step3/SKILL.md.
    const skillMd = bridge.readWorkspaceFile(`${skillName}/SKILL.md`);
    expect(skillMd).toContain("# ");
    expect(skillMd.length).toBeGreaterThan(100);
  });
});

test.describe("Sidecar Integration — Dashboard Create Skill", { tag: "@integration" }, () => {
  let bridge: SidecarBridge;

  test.beforeEach(async () => {
    bridge = await createSidecarBridge();
  });

  test.afterEach(async () => {
    bridge.cleanup();
  });

  test("create skill dialog opens and submits", async ({ page }) => {
    // Set up overrides pointing to the bridge workspace so settings are valid.
    await page.addInitScript((workspaceDir: string) => {
      (window as unknown as Record<string, unknown>).__TAURI_MOCK_OVERRIDES__ = {
        get_settings: {
          anthropic_api_key: "sk-ant-test",
          workspace_path: workspaceDir,
          skills_path: workspaceDir,
          preferred_model: null,
          log_level: "info",
        },
        check_workspace_path: true,
        list_skills: [],
        get_all_tags: [],
        create_skill: undefined,
        reconcile_startup: { orphans: [], notifications: [], auto_cleaned: 0, discovered_skills: [] },
        check_startup_deps: {
          all_ok: true,
          checks: [
            { code: "node_runtime", name: "Node.js", ok: true, detail: "v20.11.0 (system)" },
            { code: "agent_sidecar_bundle", name: "Agent sidecar", ok: true, detail: "sidecar/dist/agent-runner.js" },
            { code: "claude_sdk_cli", name: "Claude SDK", ok: true, detail: "sidecar/dist/sdk/cli.js" },
            { code: "git_binary", name: "Git", ok: true, detail: "git version 2.50.1" },
          ],
        },
      };
    }, bridge.workspaceDir);

    await page.goto("/");
    await waitForAppReady(page);

    // The dashboard should show an empty state with a "New Skill" button (or similar).
    // Click it to open the create skill dialog.
    const newSkillBtn = page.getByRole("button", { name: /new skill/i }).first();
    await expect(newSkillBtn).toBeVisible({ timeout: 5_000 });
    await newSkillBtn.click();

    // Step 1: fill name, select purpose, add description, advance.
    await page.getByRole("textbox", { name: "Skill Name" }).fill("integration-test-skill");
    await page.getByRole("combobox", { name: /what are you trying to capture/i }).click();
    await page.getByRole("option", { name: /business process knowledge/i }).click();
    await page.getByRole("textbox", { name: "Description" }).fill("An integration test skill.");
    await expect(page.getByRole("button", { name: "Next" })).toBeEnabled({ timeout: 3_000 });
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2: submit.
    await expect(page.getByRole("button", { name: "Create" })).toBeEnabled({ timeout: 3_000 });
    await page.getByRole("button", { name: "Create" }).click();

    // Dialog should close after creation.
    await expect(page.getByRole("heading", { name: "Create New Skill" })).not.toBeVisible({ timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the mock overrides for an integration test, pointing workspace paths
 * at the bridge's temp dir and pre-seeding read_file with bundled template
 * content so the UI doesn't hit empty-string reads after agent-exit.
 */
function buildOverrides(
  bridge: SidecarBridge,
  skillName: string,
  agentId: string,
): Record<string, unknown> {
  const skillDir = path.join(bridge.workspaceDir, skillName);
  const contextDir = path.join(skillDir, "context");

  return {
    ...WORKFLOW_OVERRIDES,
    get_settings: {
      anthropic_api_key: "sk-ant-test",
      workspace_path: bridge.workspaceDir,
      skills_path: bridge.workspaceDir,
      preferred_model: null,
      log_level: "info",
    },
    run_workflow_step: agentId,
    // Pre-seed read_file so the UI can load clarifications/decisions/SKILL.md
    // after agent-exit without racing against the sidecar file writes.
    // Content matches what the mock sidecar will write.
    read_file: {
      [`${contextDir}/clarifications.json`]: BUNDLED_CLARIFICATIONS,
      [`${contextDir}/decisions.json`]: BUNDLED_DECISIONS,
      [`${skillDir}/SKILL.md`]: BUNDLED_SKILL_MD,
      "*": "",
    },
  };
}
