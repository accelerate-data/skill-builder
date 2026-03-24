import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import type { AvailablePlugin } from "@/lib/types";

import GitHubImportDialog from "@/components/github-import-dialog";
import { toast } from "@/lib/toast";

const DEFAULT_REPO_INFO = { owner: "acme", repo: "skills", branch: "main", subpath: null };

const samplePlugins: AvailablePlugin[] = [
  {
    path: "plugins/analytics-pack",
    name: "analytics-pack",
    description: "Analytics and reporting tools",
    version: "1.0.0",
    skill_count: 0,
    skill_names: [],
  },
  {
    path: "plugins/hr-pack",
    name: "hr-pack",
    description: null,
    version: "2.0.0",
    skill_count: 0,
    skill_names: [],
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
      expect(screen.getByText("Loading plugins...")).toBeInTheDocument();
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
    });
  });

  describe("Empty state", () => {
    it("shows no plugin rows when list_github_plugins returns empty array", async () => {
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: [],
        list_skills: [],
      });

      renderDialog();

      await waitFor(() => {
        expect(screen.queryByText("Loading plugins...")).not.toBeInTheDocument();
      });
      expect(screen.queryByLabelText(/Install /i)).not.toBeInTheDocument();
    });
  });

  describe("Plugin list", () => {
    beforeEach(() => {
      resetTauriMocks();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: samplePlugins,
        list_skills: [],
      });
    });

    it("shows plugin name for each plugin", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("analytics-pack")).toBeInTheDocument();
      });
      expect(screen.getByText("hr-pack")).toBeInTheDocument();
    });

    it("shows description text when description is present", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Analytics and reporting tools")).toBeInTheDocument();
      });
    });

    it("shows install buttons for each plugin", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByLabelText("Install analytics-pack")).toBeInTheDocument();
      });
      expect(screen.getByLabelText("Install hr-pack")).toBeInTheDocument();
    });

    it("shows Installed badge when plugin already exists locally", async () => {
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: samplePlugins,
        list_skills: [
          {
            name: "analytics-helper",
            library_key: "skill-builder:analytics-pack:analytics-helper",
            current_step: null,
            status: null,
            last_modified: null,
            tags: [],
            purpose: "domain",
            skill_source: "marketplace",
            author_login: null,
            author_avatar: null,
            intake_json: null,
            source: null,
            description: null,
            version: "1.0.0",
            model: null,
            argumentHint: null,
            userInvocable: null,
            disableModelInvocation: null,
            plugin_slug: "analytics-pack",
            plugin_display_name: "analytics-pack",
            is_default_plugin: false,
          },
        ],
      });

      renderDialog();

      await waitFor(() => {
        expect(screen.getByText("Installed")).toBeInTheDocument();
      });
    });
  });

  describe("Import", () => {
    const onImported = vi.fn(() => Promise.resolve());

    beforeEach(() => {
      resetTauriMocks();
      onImported.mockReset().mockResolvedValue(undefined);
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: samplePlugins,
        list_skills: [],
      });
    });

    it("calls import_marketplace_plugin_to_library when install is clicked", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: samplePlugins,
        list_skills: [],
        import_marketplace_plugin_to_library: [{ skill_name: "analytics-helper", success: true, error: null }],
      });

      renderDialog({ onImported });

      await waitFor(() => {
        expect(screen.getByLabelText("Install analytics-pack")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Install analytics-pack"));

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "import_marketplace_plugin_to_library",
          expect.objectContaining({
            pluginPath: "plugins/analytics-pack",
            pluginName: "analytics-pack",
          }),
        );
      });
    });

    it("calls onImported and fires success toast on successful plugin import", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: samplePlugins,
        list_skills: [],
        import_marketplace_plugin_to_library: [{ skill_name: "analytics-helper", success: true, error: null }],
      });

      renderDialog({ onImported });

      await waitFor(() => {
        expect(screen.getByLabelText("Install analytics-pack")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Install analytics-pack"));

      await waitFor(() => {
        expect(onImported).toHaveBeenCalledOnce();
      });
      expect(toast.success).toHaveBeenCalledWith('Imported plugin "analytics-pack"');
    });

    it("shows Installed when plugin import only returns already-exists failures", async () => {
      const user = userEvent.setup();
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: samplePlugins,
        list_skills: [],
        import_marketplace_plugin_to_library: [{ skill_name: "analytics-helper", success: false, error: "already exists" }],
      });

      renderDialog({ onImported });

      await waitFor(() => {
        expect(screen.getByLabelText("Install analytics-pack")).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText("Install analytics-pack"));

      await waitFor(() => {
        expect(screen.getByText("Installed")).toBeInTheDocument();
      });
      expect(onImported).not.toHaveBeenCalled();
    });
  });

  describe("Multi-registry tabs", () => {
    it("renders one tab per registry", async () => {
      mockInvokeCommands({
        parse_github_url: DEFAULT_REPO_INFO,
        list_github_plugins: samplePlugins,
        list_skills: [],
      });

      const registries = [
        { name: "Registry A", source_url: "owner/repo-a", enabled: true },
        { name: "Registry B", source_url: "owner/repo-b", enabled: true },
      ];
      renderDialog({ registries });

      await waitFor(() => {
        expect(screen.getByText("Registry A")).toBeInTheDocument();
      });
      expect(screen.getByText("Registry B")).toBeInTheDocument();
    });
  });
});
