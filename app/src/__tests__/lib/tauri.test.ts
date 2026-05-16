import { beforeEach, describe, expect, it } from "vitest";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import {
  checkMarketplaceUpdates,
  checkMarketplaceUrl,
  checkSkillCustomized,
  createPluginFromSkills,
  deleteImportedSkill,
  deletePlugin,
  deleteSkill,
  exportSkillAsFile,
  getDashboardSkillNames,
  importMarketplacePluginToLibrary,
  importMarketplaceToLibrary,
  importSkillFromFile,
  listGitHubPlugins,
  listImportedSkills,
  listPlugins,
  listSkills,
  moveSkillToPlugin,
  parseGitHubUrl,
  pauseOpenHandsSession,
  parseSkillFile,
  removeSkillFromPlugin,
  renameSkill,
  reviewSkillScope,
  selectSkillOpenHandsSession,
  setPluginUpgradeLock,
  updateSkillMetadata,
} from "@/lib/tauri";

interface WrapperContractCase {
  name: string;
  call: () => unknown;
  command: string;
  args: Record<string, unknown>;
}

describe("VU-1138 typed Tauri wrapper contracts", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  it.each<WrapperContractCase>([
    {
      name: "deleteSkill",
      call: () => deleteSkill("/tmp/skills", "demo-skill"),
      command: "delete_skill",
      args: { workspacePath: "/tmp/skills", name: "demo-skill" },
    },
    {
      name: "updateSkillMetadata",
      call: () =>
        updateSkillMetadata(
          "demo-skill",
          "analytics-pack",
          "purpose",
          ["finance", "analytics"],
          "{\"source\":\"test\"}",
          "description",
          "1.2.3",
          true,
          false
        ),
      command: "update_skill_metadata",
      args: {
        skillName: "demo-skill",
        pluginSlug: "analytics-pack",
        purpose: "purpose",
        tags: ["finance", "analytics"],
        intakeJson: "{\"source\":\"test\"}",
        description: "description",
        version: "1.2.3",
        userInvocable: true,
        disableModelInvocation: false,
      },
    },
    {
      name: "renameSkill",
      call: () => renameSkill("old-skill", "new-skill", "/tmp/skills"),
      command: "rename_skill",
      args: { oldName: "old-skill", newName: "new-skill", workspacePath: "/tmp/skills" },
    },
    {
      name: "exportSkillAsFile",
      call: () => exportSkillAsFile("demo-skill", "analytics-pack", "/tmp/demo.md"),
      command: "export_skill_as_file",
      args: { skillName: "demo-skill", pluginSlug: "analytics-pack", destPath: "/tmp/demo.md" },
    },
    {
      name: "reviewSkillScope",
      call: () => reviewSkillScope("demo-skill", "description", "purpose", null, null),
      command: "review_skill_scope",
      args: {
        skillName: "demo-skill",
        description: "description",
        purpose: "purpose",
        contextQuestions: null,
        industry: null,
      },
    },
    {
      name: "selectSkillOpenHandsSession",
      call: () => selectSkillOpenHandsSession(42),
      command: "select_skill_openhands_session",
      args: {
        skillId: 42,
      },
    },
    {
      name: "pauseOpenHandsSession",
      call: () =>
        pauseOpenHandsSession(
          "demo-skill",
          "analytics-pack",
          "conv-123",
          "agent-123",
          42,
        ),
      command: "pause_openhands_session",
      args: {
        input: {
          skillName: "demo-skill",
          pluginSlug: "analytics-pack",
          conversationId: "conv-123",
          agentId: "agent-123",
          skillId: 42,
        },
      },
    },
    {
      name: "getDashboardSkillNames",
      call: () => getDashboardSkillNames(),
      command: "get_dashboard_skill_names",
      args: {},
    },
    {
      name: "listSkills",
      call: () => listSkills(),
      command: "list_skills",
      args: { sourceUrl: null },
    },
    {
      name: "listImportedSkills",
      call: () => listImportedSkills(),
      command: "list_imported_skills",
      args: { sourceUrl: null },
    },
    {
      name: "deleteImportedSkill",
      call: () => deleteImportedSkill("skill-123"),
      command: "delete_imported_skill",
      args: { skillId: "skill-123" },
    },
    {
      name: "listPlugins",
      call: () => listPlugins(),
      command: "list_plugins",
      args: {},
    },
    {
      name: "deletePlugin",
      call: () => deletePlugin("analytics-pack"),
      command: "delete_plugin",
      args: { pluginSlug: "analytics-pack" },
    },
    {
      name: "setPluginUpgradeLock",
      call: () => setPluginUpgradeLock("analytics-pack", true),
      command: "set_plugin_upgrade_lock",
      args: { pluginSlug: "analytics-pack", locked: true },
    },
    {
      name: "createPluginFromSkills",
      call: () => createPluginFromSkills("Analytics Pack", ["bundled:demo", "imported:abc"]),
      command: "create_plugin_from_skills",
      args: { pluginName: "Analytics Pack", skillKeys: ["bundled:demo", "imported:abc"] },
    },
    {
      name: "moveSkillToPlugin",
      call: () => moveSkillToPlugin("imported:abc", "analytics-pack"),
      command: "move_skill_to_plugin",
      args: { skillKey: "imported:abc", pluginSlug: "analytics-pack" },
    },
    {
      name: "removeSkillFromPlugin",
      call: () => removeSkillFromPlugin("imported:abc"),
      command: "remove_skill_from_plugin",
      args: { skillKey: "imported:abc" },
    },
    {
      name: "parseGitHubUrl",
      call: () => parseGitHubUrl("https://github.com/acme/skills/tree/main/plugins"),
      command: "parse_github_url",
      args: { url: "https://github.com/acme/skills/tree/main/plugins" },
    },
    {
      name: "checkMarketplaceUrl",
      call: () => checkMarketplaceUrl("https://github.com/acme/skills"),
      command: "check_marketplace_url",
      args: { url: "https://github.com/acme/skills" },
    },
    {
      name: "listGitHubPlugins",
      call: () => listGitHubPlugins("acme", "skills", "main"),
      command: "list_github_plugins",
      args: { owner: "acme", repo: "skills", branch: "main", subpath: null },
    },
    {
      name: "importMarketplaceToLibrary",
      call: () => importMarketplaceToLibrary(["plugins/analytics/skills/demo"], "https://github.com/acme/skills"),
      command: "import_marketplace_to_library",
      args: {
        sourceUrl: "https://github.com/acme/skills",
        skillPaths: ["plugins/analytics/skills/demo"],
        metadataOverrides: null,
      },
    },
    {
      name: "importMarketplacePluginToLibrary",
      call: () => importMarketplacePluginToLibrary("plugins/analytics", "Analytics Pack", "https://github.com/acme/skills"),
      command: "import_marketplace_plugin_to_library",
      args: {
        sourceUrl: "https://github.com/acme/skills",
        pluginPath: "plugins/analytics",
        pluginName: "Analytics Pack",
      },
    },
    {
      name: "checkMarketplaceUpdates",
      call: () => checkMarketplaceUpdates(),
      command: "check_marketplace_updates",
      args: {},
    },
    {
      name: "checkSkillCustomized",
      call: () => checkSkillCustomized("demo-skill"),
      command: "check_skill_customized",
      args: { skillName: "demo-skill" },
    },
    {
      name: "parseSkillFile",
      call: () => parseSkillFile("/tmp/demo.md"),
      command: "parse_skill_file",
      args: { filePath: "/tmp/demo.md" },
    },
    {
      name: "importSkillFromFile",
      call: () =>
        importSkillFromFile({
          filePath: "/tmp/demo.md",
          name: "demo-skill",
          description: "description",
          version: "1.0.0",
        }),
      command: "import_skill_from_file",
      args: {
        filePath: "/tmp/demo.md",
        name: "demo-skill",
        description: "description",
        version: "1.0.0",
        userInvocable: null,
        disableModelInvocation: null,
      },
    },
  ])("$name invokes $command with the typed wrapper contract", async ({ call, command, args }) => {
    await call();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(command, args);
  });
});
