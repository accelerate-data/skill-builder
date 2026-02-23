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
    domain: "sales",
    description: "Analyze your sales pipeline",
    skill_type: "skill-builder",
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
  },
  {
    path: "skills/hr-metrics",
    name: "HR Metrics",
    domain: null,
    description: null,
    skill_type: "skill-builder",
    version: null,
    model: null,
    argument_hint: null,
    user_invocable: null,
    disable_model_invocation: null,
  },
];

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
        url="https://github.com/acme/skills"
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
        get_installed_skill_names: [],
        list_workspace_skills: [],
      });
    });

    it("shows skill name for each skill", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });
      expect(screen.getByText("HR Metrics")).toBeInTheDocument();
    });

    it("shows domain badge when domain is present", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("sales")).toBeInTheDocument();
      });
    });

    it("does not show domain badge when domain is null", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("HR Metrics")).toBeInTheDocument();
      });
      // HR Metrics has no domain — only "sales" badge should appear
      const badges = screen.getAllByText("sales");
      expect(badges).toHaveLength(1);
    });

    it("shows description when present", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Analyze your sales pipeline")).toBeInTheDocument();
      });
    });

    it("does not show skills filtered out by typeFilter in skill-library mode", async () => {
      const mixed: AvailableSkill[] = [
        { path: "skills/a", name: "Skill A", domain: null, description: null, skill_type: "skill-builder", version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
        { path: "skills/b", name: "Skill B", domain: null, description: null, skill_type: "domain", version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
        { path: "skills/c", name: "Skill C", domain: null, description: null, skill_type: null, version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
      ];
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: mixed,
        get_installed_skill_names: [],
        list_workspace_skills: [],
      });

      // typeFilter only applies in skill-library mode
      renderDialog({ mode: "skill-library", typeFilter: ["skill-builder"] });

      await waitFor(() => {
        expect(screen.getByText("Skill A")).toBeInTheDocument();
      });
      expect(screen.queryByText("Skill B")).not.toBeInTheDocument();
      expect(screen.queryByText("Skill C")).not.toBeInTheDocument();
    });

    it("shows checkboxes for each skill initially in settings-skills mode", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // In settings-skills mode, each skill row has a checkbox (not an Import button)
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(2);
    });

    it("pre-marks skills that are already installed as 'Already installed'", async () => {
      // In settings-skills mode, duplicate detection uses list_workspace_skills by name
      const installedWs: WorkspaceSkill = {
        skill_id: "ws-1",
        skill_name: "Sales Analytics",
        domain: "sales",
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/sales",
        imported_at: "2026-01-01T00:00:00Z",
        skill_type: null,
        version: null,
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        purpose: null,
      };
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [installedWs],
        get_installed_skill_names: [],
      });

      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("HR Metrics")).toBeInTheDocument();
      });

      // Sales Analytics should show "Already installed" badge
      expect(screen.getByText("Already installed")).toBeInTheDocument();
      // HR Metrics checkbox should be enabled; Sales Analytics checkbox disabled
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(2);
      // The first skill (Sales Analytics) is disabled
      expect(checkboxes[0]).toBeDisabled();
      // The second skill (HR Metrics) is enabled
      expect(checkboxes[1]).not.toBeDisabled();
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
        get_installed_skill_names: [],
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
        get_installed_skill_names: [],
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
        if (cmd === "get_installed_skill_names") return Promise.resolve([]);
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
        get_installed_skill_names: [],
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
        get_installed_skill_names: [],
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
        get_installed_skill_names: [],
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
        get_installed_skill_names: [],
      });
    });

    it("calls import_github_skills when skill is selected and Next + Import is clicked", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [],
        get_installed_skill_names: [],
        import_github_skills: [],
      });

      renderDialog({ mode: "settings-skills", onImported });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Select first skill via checkbox row click
      const row = screen.getByText("Sales Analytics").closest("div[class*='flex']");
      await user.click(row!);

      // Click Next: Assign Purpose
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Next: Assign Purpose/i })).toBeEnabled();
      });
      await user.click(screen.getByRole("button", { name: /Next: Assign Purpose/i }));

      // Purpose step shown — click Import
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Import 1 skill/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /Import 1 skill/i }));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("import_github_skills", expect.objectContaining({
          owner: "acme",
          repo: "skills",
          branch: "main",
        }));
      });
    });

    it("calls onImported and fires success toast after bulk import", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [],
        get_installed_skill_names: [],
        import_github_skills: [],
      });

      renderDialog({ mode: "settings-skills", onImported });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Select first skill and proceed to import
      const row = screen.getByText("Sales Analytics").closest("div[class*='flex']");
      await user.click(row!);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Next: Assign Purpose/i })).toBeEnabled();
      });
      await user.click(screen.getByRole("button", { name: /Next: Assign Purpose/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Import 1 skill/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole("button", { name: /Import 1 skill/i }));

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
        if (cmd === "get_installed_skill_names") return Promise.resolve([]);
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
        expect(toast.error).toHaveBeenCalledWith("Import failed: server error");
      });

      // Edit buttons should be back (state reset to idle)
      const editButtonsAfter = (screen.getAllByRole("button") as HTMLElement[]).filter(
        (btn) => !btn.textContent?.trim()
      );
      expect(editButtonsAfter).toHaveLength(2);
      expect(onImported).not.toHaveBeenCalled();
    });
  });

  // Test D — Version guard: "Upgrade available" and "Already installed" states
  describe("Version guard — settings-skills mode", () => {
    const availableSkillVersioned: AvailableSkill = {
      path: "skills/my-skill",
      name: "my-skill",
      domain: null,
      description: "A versioned skill",
      skill_type: "domain",
      version: "2.0.0",
      model: null,
      argument_hint: null,
      user_invocable: null,
      disable_model_invocation: null,
    };

    it("shows 'Upgrade available' and skill is selectable when available version is newer", async () => {
      const installedWs: WorkspaceSkill = {
        skill_id: "ws-1",
        skill_name: "my-skill",
        domain: null,
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/my-skill",
        imported_at: "2026-01-01T00:00:00Z",
        skill_type: null,
        version: "1.0.0",
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        purpose: null,
      };
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [availableSkillVersioned],
        list_workspace_skills: [installedWs],
      });

      renderDialog({ mode: "settings-skills" });

      await waitFor(() => {
        expect(screen.getByText("my-skill")).toBeInTheDocument();
      });

      // "Upgrade available" badge should be visible
      expect(screen.getByText("Upgrade available")).toBeInTheDocument();

      // The checkbox should be enabled (skill is selectable, not disabled)
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).not.toBeDisabled();
    });

    it("shows 'Already installed' and disables the row when versions are the same", async () => {
      const sameVersionSkill: AvailableSkill = { ...availableSkillVersioned, version: "1.0.0" };
      const installedWs: WorkspaceSkill = {
        skill_id: "ws-1",
        skill_name: "my-skill",
        domain: null,
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/my-skill",
        imported_at: "2026-01-01T00:00:00Z",
        skill_type: null,
        version: "1.0.0",
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        purpose: null,
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

      // "Already installed" badge should be visible
      expect(screen.getByText("Already installed")).toBeInTheDocument();

      // The checkbox should be disabled
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeDisabled();
    });
  });

  // Test E — Purpose step appears after selecting a skill and clicking Next
  describe("Purpose step — settings-skills mode", () => {
    it("shows purpose assignment UI after selecting a skill and clicking Next", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        list_workspace_skills: [],
      });

      renderDialog({ mode: "settings-skills" });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // Click the row to select the first skill
      const row = screen.getByText("Sales Analytics").closest("div[class*='flex']");
      await user.click(row!);

      // Wait for the checkbox to be checked
      await waitFor(() => {
        const checkboxes = screen.getAllByRole("checkbox");
        const salesCheckbox = checkboxes[0];
        expect(salesCheckbox).toBeChecked();
      });

      // Click Next: Assign Purpose
      const nextBtn = screen.getByRole("button", { name: /Next: Assign Purpose/i });
      await user.click(nextBtn);

      // Purpose assignment step should be shown
      await waitFor(() => {
        expect(screen.getByText("Assign Purpose (Optional)")).toBeInTheDocument();
      });
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
        domain: "sales",
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/sales-analytics",
        imported_at: "2026-01-01T00:00:00Z",
        skill_type: null,
        version: "1.0.0",
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        purpose: "research",
      };
      // Workspace skill 2: another active skill already occupying "research" purpose
      const occupyingWs: WorkspaceSkill = {
        skill_id: "ws-occupying",
        skill_name: "other-research-skill",
        domain: null,
        description: null,
        is_active: true,
        is_bundled: false,
        disk_path: "/skills/other",
        imported_at: "2026-01-01T00:00:00Z",
        skill_type: null,
        version: null,
        model: null,
        argument_hint: null,
        user_invocable: null,
        disable_model_invocation: null,
        purpose: "research",
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
      });

      renderDialog({ mode: "settings-skills" });

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      // The skill should have "Upgrade available" badge and a selectable checkbox
      expect(screen.getByText("Upgrade available")).toBeInTheDocument();
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).not.toBeDisabled();

      // Select the skill by clicking the row
      const row = screen.getByText("Sales Analytics").closest("div[class*='flex']");
      await user.click(row!);

      await waitFor(() => {
        expect(screen.getByRole("checkbox")).toBeChecked();
      });

      // Click Next — purposeMap is pre-populated with "research" from existingVersionWs
      await user.click(screen.getByRole("button", { name: /Next: Assign Purpose/i }));

      // Purpose step shown; "research" is pre-populated and conflicts with occupyingWs
      await waitFor(() => {
        expect(screen.getByText("Assign Purpose (Optional)")).toBeInTheDocument();
      });

      // Conflict message should appear because "research" is occupied by "other-research-skill"
      await waitFor(() => {
        expect(screen.getByText(/Purpose occupied by/i)).toBeInTheDocument();
      });

      // Import button should be disabled due to conflict
      const importBtn = screen.getByRole("button", { name: /Import 1 skill/i });
      expect(importBtn).toBeDisabled();
    });
  });

  describe("Dialog close", () => {
    it("resets state when closed and reopened (new browse on reopen)", async () => {
      const user = userEvent.setup();

      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_installed_skill_names: [],
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
            url="https://github.com/acme/skills"
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
