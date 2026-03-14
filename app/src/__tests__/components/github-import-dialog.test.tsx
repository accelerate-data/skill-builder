import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import type { AvailableSkill } from "@/lib/types";

import GitHubImportDialog from "@/components/github-import-dialog";
import { toast } from "@/lib/toast";

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
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: [],
        get_dashboard_skill_names: [],
        list_skills: [],
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
      expect(screen.queryByText("No description")).not.toBeInTheDocument();
    });

    it("shows description in edit form when edit button is clicked", async () => {
      const user = userEvent.setup();
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByText("Edit & Import Skill")).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue("Analyze your sales pipeline")).toBeInTheDocument();
    });

    it("does not show skills filtered out by typeFilter", async () => {
      const mixed: AvailableSkill[] = [
        { path: "skills/a", name: "Skill A", plugin_name: null, description: null, purpose: "skill-builder", version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
        { path: "skills/b", name: "Skill B", plugin_name: null, description: null, purpose: "domain", version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
        { path: "skills/c", name: "Skill C", plugin_name: null, description: null, purpose: null, version: null, model: null, argument_hint: null, user_invocable: null, disable_model_invocation: null },
      ];
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: mixed,
        get_dashboard_skill_names: [],
        list_skills: [],
      });

      renderDialog({ typeFilter: ["skill-builder"] });

      await waitFor(() => {
        expect(screen.getByText("Skill A")).toBeInTheDocument();
      });
      expect(screen.queryByText("Skill B")).not.toBeInTheDocument();
      expect(screen.queryByText("Skill C")).not.toBeInTheDocument();
    });

    it("shows edit buttons for each skill", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });

      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      const editButtons = allButtons.filter((btn) => !btn.textContent?.trim());
      expect(editButtons).toHaveLength(2);
    });
  });

  describe("Import", () => {
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

    async function waitForSkillEditButtons(): Promise<HTMLElement[]> {
      await waitFor(() => {
        expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
      });
      const allButtons = screen.getAllByRole("button") as HTMLElement[];
      return allButtons.filter((btn) => !btn.textContent?.trim());
    }

    it("shows an edit button for each skill", async () => {
      renderDialog({ onImported });

      const editButtons = await waitForSkillEditButtons();
      expect(editButtons).toHaveLength(2);
    });

    it("opens edit form when skill edit button is clicked", async () => {
      const user = userEvent.setup();
      renderDialog({ onImported });

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

      renderDialog({ onImported });

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

    it("calls onImported and fires success toast on successful import", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
        import_marketplace_to_library: [{ skill_name: "Sales Analytics", success: true, error: null }],
      });

      renderDialog({ onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(onImported).toHaveBeenCalledOnce();
      });
      expect(toast.success).toHaveBeenCalledWith('Imported "Sales Analytics"');
    });

    it("shows 'Already installed' when result has 'already exists' error", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
        import_marketplace_to_library: [{ skill_name: "Sales Analytics", success: false, error: "already exists" }],
      });

      renderDialog({ onImported });

      const editButtons = await waitForSkillEditButtons();
      await user.click(editButtons[0]);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Confirm Import/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(screen.getByText("Already installed")).toBeInTheDocument();
      });
      expect(onImported).not.toHaveBeenCalled();
    });

    it("closes edit form without importing when Cancel is clicked", async () => {
      const user = userEvent.setup();
      renderDialog({ onImported });

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

  describe("Multi-registry tabs", () => {
    it("renders one tab per registry", async () => {
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_skills: sampleSkills,
        get_dashboard_skill_names: [],
        list_skills: [],
      });

      const registries = [
        { name: "Registry A", source_url: "owner/repo-a", enabled: true },
        { name: "Registry B", source_url: "owner/repo-b", enabled: true },
      ];
      renderDialog({ registries, workspacePath: "/workspace" });

      await waitFor(() => {
        expect(screen.getByText("Registry A")).toBeInTheDocument();
      });
      expect(screen.getByText("Registry B")).toBeInTheDocument();
    });

    it("shows no-registries message when registries array is empty", () => {
      renderDialog({ registries: [] });
      expect(screen.getByText(/No enabled registries/)).toBeInTheDocument();
    });
  });
});
