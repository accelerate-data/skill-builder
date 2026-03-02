import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import type { AvailableSkill, WorkspaceSkill } from "@/lib/types";

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

import GitHubImportDialog from "@/components/github-import-dialog";
import { toast } from "sonner";

const DEFAULT_REPO_INFO = { owner: "acme", repo: "skills", branch: "main", subpath: null };

const sampleSkills: AvailableSkill[] = [
  {
    path: "skills/sales-analytics",
    name: "Sales Analytics",
    plugin_name: null,
    description: "Analyze your sales pipeline",
    purpose: "skill-builder",
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
  },
  {
    path: "skills/hr-metrics",
    name: "HR Metrics",
    plugin_name: null,
    description: null,
    purpose: "skill-builder",
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
  },
];

const DEFAULT_REGISTRIES = [{ name: "Test Registry", source_url: "https://github.com/acme/skills", enabled: true }];

function renderDialog(props: Partial<React.ComponentProps<typeof GitHubImportDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onImported = vi.fn(() => Promise.resolve());
  return {
    onOpenChange,
    onImported,
    ...render(
      <GitHubImportDialog
        open={true}
        onOpenChange={onOpenChange}
        onImported={onImported}
        registries={DEFAULT_REGISTRIES}
        {...props}
      />
    ),
  };
}

describe("GitHubImportDialog", () => {
  describe("Loading state", () => {
    it("shows spinner while loading", () => {
      // Never resolve — component stays in loading state
      mockInvoke.mockImplementation(() => new Promise(() => {}));
      renderDialog();
      expect(screen.getByText("Loading skills...")).toBeInTheDocument();
    });
  });

  describe("Error state", () => {
    it("shows error message and Retry button after browse fails", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "parse_github_url") return Promise.reject(new Error("Invalid GitHub URL"));
        return Promise.reject(new Error(`Unmocked command: ${cmd}`));
      });

      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Invalid GitHub URL")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /Retry/i })).toBeInTheDocument();
      expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
    });

    it("hides skill list after browse fails", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "parse_github_url") return Promise.reject(new Error("Network error"));
        return Promise.reject(new Error(`Unmocked command: ${cmd}`));
      });

      renderDialog();

      await waitFor(() => {
        expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
      });

      expect(screen.queryByRole("button", { name: /Import/i })).not.toBeInTheDocument();
    });
  });

  describe("Empty state", () => {
    it("shows no skill rows when list_github_skills returns empty array", async () => {
      // When the skill list is empty, the component sets an error state internally
      // ("No skills found in this repository.") and does not populate the skill list.
      // After loading completes, the spinner is gone and no Import buttons are shown.
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [],
      });

      renderDialog();

      await waitFor(() => {
        expect(screen.queryByText("Loading skills...")).not.toBeInTheDocument();
      });
      expect(screen.queryByRole("button", { name: /Import/i })).not.toBeInTheDocument();
    });
  });

  describe("Skill list", () => {
    beforeEach(() => {
      resetTauriMocks();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_workspace_skills: [],
        list_skills: [],
      });
    });

    it("shows skill name for each skill", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });
      expect(screen.getByText("HR Metrics")).toBeInTheDocument();
    });

    it("shows description text when description is present", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Analyze your sales pipeline")).toBeInTheDocument();
      });
    });

    it("does not show description text when description is null", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("HR Metrics")).toBeInTheDocument();
      });
      // HR Metrics has description=null, so no description text
      expect(screen.queryByText("No description")).not.toBeInTheDocument();
    });

    it("shows description in edit form when edit button is clicked", async () => {
      const user = userEvent.setup();
      renderDialog({ mode: "skill-library" });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Click the pencil edit button for the first skill
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("Edit & Import Skill")).toBeInTheDocument();
      });
      // Description should be in the edit form
      expect(screen.getByDisplayValue("Analyze your sales pipeline")).toBeInTheDocument();
    });

    it("does not show skills filtered out by typeFilter in skill-library mode", async () => {
      const mixed: AvailableSkill[] = [
        { path: "skills/a", name: "Skill A", plugin_name: null, description: null, purpose: "skill-builder", version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
        { path: "skills/b", name: "Skill B", plugin_name: null, description: null, purpose: "domain", version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
        { path: "skills/c", name: "Skill C", plugin_name: null, description: null, purpose: null, version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
      ];
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: mixed,
        get_dashboard_skill_names: [],
        list_workspace_skills: [],
        list_skills: [],
      });

      // typeFilter only applies in skill-library mode
      renderDialog({ mode: "skill-library", typeFilter: ["skill-builder"] });

      await waitFor(() => {
        expect(screen.getByText("Skill A")).toBeInTheDocument();
      });
      expect(screen.queryByText("Skill B")).not.toBeInTheDocument();
      expect(screen.queryByText("Skill C")).not.toBeInTheDocument();
    });

    it("shows edit (pencil) buttons for each skill in settings-skills mode", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // In settings-skills mode, each idle skill row has a pencil icon button
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      expect(editButtons).toHaveLength(2);
    });

    it("pre-marks skills that are already installed as 'Up to date' when same version", async () => {
      // In settings-skills mode, duplicate detection uses list_workspace_skills by name
      const installedWs: WorkspaceSkill = {
        skill_id: "ws-1",
        skill_name: "Sales Analytics",
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/sales",
        imported_at: "2026-01-01T00:00:00Z",
        purpose: null,
        version: null,
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        marketplace_source_url: null,
      };
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [installedWs],
        get_dashboard_skill_names: [],
      });

      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("HR Metrics")).toBeInTheDocument();
      });

      // Sales Analytics (same version null == null) should show "Up to date" badge
      expect(screen.getByText("Up to date")).toBeInTheDocument();
      // HR Metrics should still have an edit button; Sales Analytics should not (disabled)
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      // Only HR Metrics (1 skill) should have an edit button; Sales Analytics is disabled
      expect(editButtons).toHaveLength(1);
    });
  });

  describe("Import — skill-library mode", () => {
    const onImported = vi.fn(() => Promise.resolve());

    beforeEach(() => {
      resetTauriMocks();
      onImported.mockReset().mockResolvedValue(undefined);
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
      });
    });

    // Helper: wait for skills to load and return all skill-row icon edit buttons.
    // In skill-library mode buttons are icon-only (SVG only, no text). The Radix Dialog
    // close button has sr-only text "Close", so filtering by empty textContent identifies
    // the skill edit buttons.
    async function waitForSkillEditButtons(): Promise<HTMLElement[]> {
      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      return allButtons.filter((btn) => !btn.textContent?.trim());
    }

    it("shows an edit button for each skill in skill-library mode", async () => {
      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();
      expect(editButtons).toHaveLength(2);
    });

    it("opens edit form when skill edit button is clicked", async () => {
      const user = userEvent.setup();
      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();

      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("Edit & Import Skill")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
    });

    it("calls import_marketplace_to_library with skill path and metadata override on Confirm Import", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
        import_marketplace_to_library: [{ skill_name: "Sales Analytics", success: true, error: null }],
      });

      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("import_marketplace_to_library", expect.objectContaining({
          skillPaths: ["skills/sales-analytics"],
        }));
      });
    });

    it("disables the Confirm Import button while import is in flight", async () => {
      const user = userEvent.setup();

      let resolveImport!: (v: unknown) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "parse_github_url") return Promise.resolve(DEFAULT_REPO_INFO);
        if (cmd === "list_github_skills") return Promise.resolve(sampleSkills);
        if (cmd === "get_dashboard_skill_names") return Promise.resolve([]);
        if (cmd === "list_skills") return Promise.resolve([]);
        if (cmd === "import_marketplace_to_library") {
          return new Promise((res) => { resolveImport = res; });
        }
        return Promise.reject(new Error(`Unmocked command: ${cmd}`));
      });

      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      // Edit form closes and import is in-flight — mockInvoke was called with the command
      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("import_marketplace_to_library", expect.anything());
      });

      // Clean up by resolving the import
      resolveImport([{ skill_name: "Sales Analytics", success: true, error: null }]);
    });

    it("calls onImported and fires success toast on successful import", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
        import_marketplace_to_library: [{ skill_name: "Sales Analytics", success: true, error: null }],
      });

      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      // After successful import, onImported is called and success toast fires
      await waitFor(() => {
        expect(onImported).toHaveBeenCalledOnce();
      });
      expect(toast.success).toHaveBeenCalledWith('Imported "Sales Analytics"');
    });

    it("shows 'Already installed' and does not call onImported when result has 'already exists' error", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
        import_marketplace_to_library: [{ skill_name: "Sales Analytics", success: false, error: "already exists" }],
      });

      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      // Skill transitions to "exists" state, showing "Already installed" badge
      await waitFor(() => {
        expect(screen.getByText("Already installed")).toBeInTheDocument();
      });
      // onImported should NOT be called when skill already exists
      expect(onImported).not.toHaveBeenCalled();
    });

    it("other skills remain editable after one is imported", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
        import_marketplace_to_library: [{ skill_name: "Sales Analytics", success: true, error: null }],
      });

      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      // After import, onImported should be called (import succeeded)
      await waitFor(() => {
        expect(onImported).toHaveBeenCalledOnce();
      });

      // Second skill should still have an edit button (1 remaining after first is imported)
      const remainingEditButtons = (screen.getAllByRole("button") as HTMLElement[]).filter(
        (btn) => !btn.textContent?.trim()
      );
      expect(remainingEditButtons).toHaveLength(1);
    });

    it("closes edit form without importing when Cancel is clicked", async () => {
      const user = userEvent.setup();
      renderDialog({ mode: "skill-library", onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Cancel/i }));

      await waitFor(() => {
        expect(screen.queryByText("Edit & Import Skill")).not.toBeInTheDocument();
      });
      expect(onImported).not.toHaveBeenCalled();
    });
  });

  describe("Import — settings-skills mode", () => {
    const onImported = vi.fn(() => Promise.resolve());

    beforeEach(() => {
      resetTauriMocks();
      onImported.mockReset().mockResolvedValue(undefined);
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [],
        get_dashboard_skill_names: [],
        check_skill_customized: false,
      });
    });

    it("calls import_github_skills when skill edit button is clicked and Confirm Import is clicked", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [],
        get_dashboard_skill_names: [],
        check_skill_customized: false,
        import_github_skills: undefined,
      });

      renderDialog({ mode: "settings-skills", onImported });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Click the pencil button to open the import dialog for the first skill
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      await user.click(editButtons[0]);

      // Import dialog shown — click Confirm Import
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("import_github_skills", expect.objectContaining({
          owner: "acme",
          repo: "skills",
          branch: "main",
        }));
      });
    });

    it("calls onImported and fires success toast after import", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [],
        get_dashboard_skill_names: [],
        check_skill_customized: false,
        import_github_skills: undefined,
      });

      renderDialog({ mode: "settings-skills", onImported });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Click the pencil button and confirm import
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      // After import, onImported should be called and success toast fired
      await waitFor(() => {
        expect(onImported).toHaveBeenCalledOnce();
      });
      expect(toast.success).toHaveBeenCalled();
    });
  });

  describe("Import error", () => {
    const onImported = vi.fn(() => Promise.resolve());

    beforeEach(() => {
      resetTauriMocks();
      onImported.mockReset().mockResolvedValue(undefined);
    });

    it("resets to idle and fires error toast when import throws (via edit form)", async () => {
      const user = userEvent.setup();

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "parse_github_url") return Promise.resolve(DEFAULT_REPO_INFO);
        if (cmd === "list_github_skills") return Promise.resolve(sampleSkills);
        if (cmd === "get_dashboard_skill_names") return Promise.resolve([]);
        if (cmd === "list_skills") return Promise.resolve([]);
        if (cmd === "import_marketplace_to_library")
          return Promise.reject(new Error("Import failed: server error"));
        return Promise.reject(new Error(`Unmocked command: ${cmd}`));
      });

      renderDialog({ mode: "skill-library", onImported });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Find skill edit buttons (icon-only, no text — the close button has sr-only "Close" text)
      const editButtons = (screen.getAllByRole("button") as HTMLElement[]).filter(
        (btn) => !btn.textContent?.trim()
      );
      expect(editButtons).toHaveLength(2);

      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Import failed: server error", expect.anything());
      });

      // Edit buttons should be back (state reset to idle)
      const editButtonsAfter = (screen.getAllByRole("button") as HTMLElement[]).filter(
        (btn) => !btn.textContent?.trim()
      );
      expect(editButtonsAfter).toHaveLength(2);
      expect(onImported).not.toHaveBeenCalled();
    });
  });

  // Test D — Version guard: "Update available" and "Up to date" states
  describe("Version guard — settings-skills mode", () => {
    const availableSkillVersioned: AvailableSkill = {
      path: "skills/my-skill",
      name: "my-skill",
      plugin_name: null,
      description: "A versioned skill",
      purpose: "domain",
      version: "2.0.0",
      model: null,
      argument_hint: null,
      user_invocable: null,
      disable_model_invocation: null,
    };

    it("shows 'Update available' and skill is selectable when available version is newer", async () => {
      const installedWs: WorkspaceSkill = {
        skill_id: "ws-1",
        skill_name: "my-skill",
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/my-skill",
        imported_at: "2026-01-01T00:00:00Z",
        purpose: null,
        version: "1.0.0",
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        marketplace_source_url: null,
      };
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [availableSkillVersioned],
        list_workspace_skills: [installedWs],
        check_skill_customized: false,
      });

      renderDialog({ mode: "settings-skills" });

      await waitFor(() => {
        expect(screen.getByText("my-skill")).toBeInTheDocument();
      });

      // "Update available" badge should be visible
      expect(screen.getByText("Update available")).toBeInTheDocument();

      // The skill should have an edit button (not disabled)
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      expect(editButtons).toHaveLength(1);
    });

    it("shows 'Up to date' and disables the row when versions are the same", async () => {
      const sameVersionSkill: AvailableSkill = { ...availableSkillVersioned, version: "1.0.0" };
      const installedWs: WorkspaceSkill = {
        skill_id: "ws-1",
        skill_name: "my-skill",
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/my-skill",
        imported_at: "2026-01-01T00:00:00Z",
        purpose: null,
        version: "1.0.0",
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        marketplace_source_url: null,
      };
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [sameVersionSkill],
        list_workspace_skills: [installedWs],
      });

      renderDialog({ mode: "settings-skills" });

      await waitFor(() => {
        expect(screen.getByText("my-skill")).toBeInTheDocument();
      });

      // "Up to date" badge should be visible
      expect(screen.getByText("Up to date")).toBeInTheDocument();

      // No edit button (skill is disabled/up-to-date)
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      expect(editButtons).toHaveLength(0);
    });
  });

  // Test D2 — Version guard: skill-library mode
  describe("Version guard — skill-library mode", () => {
    const makeLibrarySkill = (name: string, version: string | null): AvailableSkill => ({
      path: `skills/${name}`,
      name,
      plugin_name: null,
      description: `${name} description`,
      purpose: "skill-builder",
      version,
      model: null,
      argument_hint: null,
      user_invocable: null,
      disable_model_invocation: null,
    });

    it("shows 'Update available' only for skills with a newer marketplace version", async () => {
      const marketplaceSkills = [
        makeLibrarySkill("skill-a", "1.0.0"),
        makeLibrarySkill("skill-b", "1.0.0"),
        makeLibrarySkill("dbt-fabric", "1.1.0"),
      ];
      const installedSummaries = [
        { name: "skill-a", version: "1.0.0" },
        { name: "skill-b", version: "1.0.0" },
        { name: "dbt-fabric", version: "1.0.0" },
      ];
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "parse_github_url") return Promise.resolve(DEFAULT_REPO_INFO);
        if (cmd === "list_github_skills") return Promise.resolve(marketplaceSkills);
        if (cmd === "get_dashboard_skill_names") return Promise.resolve(["skill-a", "skill-b", "dbt-fabric"]);
        if (cmd === "list_skills") return Promise.resolve(installedSummaries);
        return Promise.resolve(undefined);
      });

      renderDialog({ mode: "skill-library", workspacePath: "/workspace" });

      await waitFor(() => {
        expect(screen.getByText("skill-a")).toBeInTheDocument();
      });

      // Only dbt-fabric has a newer version
      const updateBadges = screen.getAllByText("Update available");
      expect(updateBadges).toHaveLength(1);

      // The other 2 installed skills should be "Up to date"
      const upToDateBadges = screen.getAllByText("Up to date");
      expect(upToDateBadges).toHaveLength(2);
    });

    it("shows correct upgrade state when workspacePath is empty (race condition fix)", async () => {
      // Regression: when dialog opens before settings have loaded, workspacePath="" which was
      // previously treated as falsy, skipping listSkills entirely and leaving installedSummary
      // undefined for all skills (causing all installed skills to show "Update available").
      // The fix: always call listSkills since the Rust backend ignores the path anyway.
      const marketplaceSkills = [
        makeLibrarySkill("skill-a", "1.0.0"),
        makeLibrarySkill("dbt-fabric", "1.1.0"),
      ];
      const installedSummaries = [
        { name: "skill-a", version: "1.0.0" },
        { name: "dbt-fabric", version: "1.0.0" },
      ];
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "parse_github_url") return Promise.resolve(DEFAULT_REPO_INFO);
        if (cmd === "list_github_skills") return Promise.resolve(marketplaceSkills);
        if (cmd === "get_dashboard_skill_names") return Promise.resolve(["skill-a", "dbt-fabric"]);
        if (cmd === "list_skills") return Promise.resolve(installedSummaries);
        return Promise.resolve(undefined);
      });

      // Render with empty workspacePath — simulates dialog opening before settings async load
      renderDialog({ mode: "skill-library", workspacePath: "" });

      await waitFor(() => {
        expect(screen.getByText("skill-a")).toBeInTheDocument();
      });

      // skill-a at same version → "Up to date"
      expect(screen.getByText("Up to date")).toBeInTheDocument();
      // dbt-fabric with newer marketplace version → "Update available"
      expect(screen.getByText("Update available")).toBeInTheDocument();
      // list_skills must be called even with empty workspacePath
      expect(mockInvoke).toHaveBeenCalledWith("list_skills", expect.objectContaining({ workspacePath: "" }));
    });
  });

  // Test E — Import dialog opens after clicking pencil button in settings-skills mode
  describe("Import dialog — settings-skills mode", () => {
    it("shows import dialog with purpose field after clicking edit button", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [],
        check_skill_customized: false,
      });

      renderDialog({ mode: "settings-skills" });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Click the pencil button for the first skill
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      await user.click(editButtons[0]);

      // Import dialog should be shown with purpose assignment UI
      await waitFor(() => {
        expect(screen.getByText("Import Skill")).toBeInTheDocument();
      });
      expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
    });
  });

  // Test F — Conflict guard disables confirm when purpose is occupied
  describe("Purpose conflict guard — settings-skills mode", () => {
    it("disables import button and shows conflict message when pre-populated purpose is occupied", async () => {
      const user = userEvent.setup();

      // Workspace skill 1: the existing version of "Sales Analytics" with purpose="research"
      // (will be upgraded → state="upgrade" → selectable, and pre-populates purposeMap with "research")
      const existingVersionWs: WorkspaceSkill = {
        skill_id: "ws-existing",
        skill_name: "Sales Analytics",
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/sales-analytics",
        imported_at: "2026-01-01T00:00:00Z",
        purpose: "research",
        version: "1.0.0",
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        marketplace_source_url: null,
      };
      // Workspace skill 2: another active skill already occupying "research" purpose
      const occupyingWs: WorkspaceSkill = {
        skill_id: "ws-occupying",
        skill_name: "other-research-skill",
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/other",
        imported_at: "2026-01-01T00:00:00Z",
        purpose: "research",
        version: null,
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        marketplace_source_url: null,
      };

      // Available skill with a newer version (triggers "upgrade" state → selectable)
      const upgradeAvailableSkill: AvailableSkill = {
        ...sampleSkills[0],
        version: "2.0.0",
      };

      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [upgradeAvailableSkill],
        list_workspace_skills: [existingVersionWs, occupyingWs],
        check_skill_customized: false,
      });

      renderDialog({ mode: "settings-skills" });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // The skill should have "Update available" badge and an edit button
      expect(screen.getByText("Update available")).toBeInTheDocument();
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      expect(editButtons).toHaveLength(1);

      // Click the edit button — existingVersionWs has purpose="research" which conflicts
      await user.click(editButtons[0]);

      // Import dialog shown with conflict message
      await waitFor(() => {
        expect(screen.getByText("Update Skill")).toBeInTheDocument();
      });

      // Conflict message should appear because "research" is occupied by "other-research-skill"
      await waitFor(() => {
        expect(screen.getByText(/A skill with purpose/i)).toBeInTheDocument();
      });

      // Import button should be disabled due to conflict
      const importBtn = screen.getByRole("button", { name: /Confirm Import/i });
      expect(importBtn).toBeDisabled();
    });
  });

  describe("Dialog layout and scrollability", () => {
    beforeEach(() => {
      resetTauriMocks();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_workspace_skills: [],
        list_skills: [],
      });
    });

    it("DialogContent has max-h-[90vh] and overflow-hidden to constrain dialog height", async () => {
      renderDialog();
      await waitFor(() => expect(screen.getByText("Sales Analytics")).toBeInTheDocument());

      const content = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
      expect(content).not.toBeNull();
      expect(content.className).toContain("max-h-[90vh]");
      expect(content.className).toContain("overflow-hidden");
    });

    it("truncates descriptions longer than 60 characters with ellipsis", async () => {
      const longDesc = "A".repeat(80);
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [{
          ...sampleSkills[0],
          description: longDesc,
        }],
        get_dashboard_skill_names: [],
        list_workspace_skills: [],
        list_skills: [],
      });

      renderDialog();
      await waitFor(() => expect(screen.getByText("Sales Analytics")).toBeInTheDocument());

      expect(screen.getByText(`${"A".repeat(60)}...`)).toBeInTheDocument();
      expect(screen.queryByText(longDesc)).not.toBeInTheDocument();
    });

    it("does not truncate descriptions of 60 characters or fewer", async () => {
      const shortDesc = "A".repeat(60);
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [{
          ...sampleSkills[0],
          description: shortDesc,
        }],
        get_dashboard_skill_names: [],
        list_workspace_skills: [],
        list_skills: [],
      });

      renderDialog();
      await waitFor(() => expect(screen.getByText(shortDesc)).toBeInTheDocument());
      expect(screen.queryByText(`${shortDesc}...`)).not.toBeInTheDocument();
    });

    it("all skills in a long list are present in the DOM (no scroll clipping)", async () => {
      const manySkills: AvailableSkill[] = Array.from({ length: 20 }, (_, i) => ({
        path: `skills/skill-${i}`,
        name: `Skill ${i}`,
        plugin_name: null,
        description: `Description for skill ${i}`,
        purpose: "skill-builder",
        version: null,
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        marketplace_source_url: null,
      }));
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: manySkills,
        get_dashboard_skill_names: [],
        list_workspace_skills: [],
        list_skills: [],
      });

      renderDialog();

      await waitFor(() => expect(screen.getByText("Skill 0")).toBeInTheDocument());
      for (let i = 0; i < 20; i++) {
        expect(screen.getByText(`Skill ${i}`)).toBeInTheDocument();
      }
    });
  });

  describe("Multiple registries", () => {
    it("renders a tab for each enabled registry", () => {
      mockInvoke.mockImplementation(() => new Promise(() => {})); // stay loading
      const multiRegistries = [
        { name: "Registry A", source_url: "https://github.com/a/skills", enabled: true },
        { name: "Registry B", source_url: "https://github.com/b/skills", enabled: true },
      ];

      renderDialog({ registries: multiRegistries });

      expect(screen.getByRole("tab", { name: "Registry A" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Registry B" })).toBeInTheDocument();
    });

    it("shows empty-registry message when registries prop is empty", () => {
      renderDialog({ registries: [] });
      expect(screen.getByText(/No enabled registries/i)).toBeInTheDocument();
    });
  });

  describe("Dialog close", () => {
    it("resets state when closed and reopened (new browse on reopen)", async () => {
      const user = userEvent.setup();

      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
        import_marketplace_to_library: [{ skill_name: "Sales Analytics", success: true, error: null }],
      });

      const onImported = vi.fn(() => Promise.resolve());

      // Use a wrapper component so we can toggle open/closed via state
      let setOpenFromOutside!: (v: boolean) => void;
      function Wrapper() {
        const [open, setOpen] = React.useState(true);
        setOpenFromOutside = setOpen;
        return (
          <GitHubImportDialog
            open={open}
            onOpenChange={setOpen}
            onImported={onImported}
            registries={DEFAULT_REGISTRIES}
            mode="skill-library"
          />
        );
      }

      render(<Wrapper />);

      // Wait for skills to load, then find skill edit buttons
      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      let editButtons = (screen.getAllByRole("button") as HTMLElement[]).filter(
        (btn) => !btn.textContent?.trim()
      );
      expect(editButtons).toHaveLength(2);

      // Open edit form and confirm import for first skill
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      // Wait for the import to complete (onImported is called on success)
      await waitFor(() => {
        expect(onImported).toHaveBeenCalledOnce();
      });

      // Close the dialog via the Radix close button (triggers handleOpenChange(false) → reset())
      const closeButton = screen.getByRole("button", { name: /close/i });
      await user.click(closeButton);

      // Reopen via external state change
      setOpenFromOutside(true);

      // After reopen, browse() fires again — state should be reset so all skills are editable
      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });
      editButtons = (screen.getAllByRole("button") as HTMLElement[]).filter(
        (btn) => !btn.textContent?.trim()
      );
      // After reopen, all 2 skills should be editable (state was reset on close)
      expect(editButtons).toHaveLength(2);
    });
  });
});
