import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  mockInvoke,
  mockInvokeCommands,
  resetTauriMocks,
} from "@/test/mocks/tauri";
import { open as mockOpen } from "@tauri-apps/plugin-dialog";
import type { ImportedSkill } from "@/stores/imported-skills-store";

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

// Mock react-markdown (avoid complex rendering in tests)
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: () => {},
}));

import SkillsPage from "@/pages/skills";

const sampleSkills: ImportedSkill[] = [
  {
    skill_id: "id-1",
    skill_name: "sales-analytics",
    domain: "sales",
    description: "Analytics skill for sales pipelines",
    is_active: true,
    disk_path: "/skills/sales-analytics",
    imported_at: new Date().toISOString(),
  },
  {
    skill_id: "id-2",
    skill_name: "hr-metrics",
    domain: "HR",
    description: null,
    is_active: false,
    disk_path: "/skills/hr-metrics",
    imported_at: new Date().toISOString(),
  },
];

describe("SkillsPage", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("shows loading skeletons while fetching", async () => {
    mockInvoke.mockImplementation(() => new Promise(() => {}));
    render(<SkillsPage />);

    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders page title and upload button", async () => {
    mockInvokeCommands({ list_imported_skills: sampleSkills });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText("Skills Library")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Upload Skill/i })).toBeInTheDocument();
  });

  it("renders skill cards when skills exist", async () => {
    mockInvokeCommands({ list_imported_skills: sampleSkills });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText("sales-analytics")).toBeInTheDocument();
    });
    expect(screen.getByText("hr-metrics")).toBeInTheDocument();
  });

  it("shows empty state when no skills", async () => {
    mockInvokeCommands({ list_imported_skills: [] });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText("No imported skills")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Upload a .skill package to add it to your library.")
    ).toBeInTheDocument();
  });

  it("shows domain badge on skill card", async () => {
    mockInvokeCommands({ list_imported_skills: sampleSkills });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText("sales")).toBeInTheDocument();
    });
    expect(screen.getByText("HR")).toBeInTheDocument();
  });

  it("shows description on skill card", async () => {
    mockInvokeCommands({ list_imported_skills: sampleSkills });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(
        screen.getByText("Analytics skill for sales pipelines")
      ).toBeInTheDocument();
    });
  });

  it("shows 'No description' for skills without description", async () => {
    mockInvokeCommands({ list_imported_skills: sampleSkills });
    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText("No description")).toBeInTheDocument();
    });
  });

  it("calls upload_skill when file is selected", async () => {
    const user = userEvent.setup();
    const newSkill: ImportedSkill = {
      skill_id: "id-3",
      skill_name: "new-skill",
      domain: null,
      description: "A new skill",
      is_active: true,
      disk_path: "/skills/new-skill",
      imported_at: new Date().toISOString(),
    };

    mockInvokeCommands({
      list_imported_skills: [],
      upload_skill: newSkill,
    });
    (mockOpen as ReturnType<typeof vi.fn>).mockResolvedValue("/path/to/file.skill");

    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText("No imported skills")).toBeInTheDocument();
    });

    // Click the upload button in empty state
    const uploadButtons = screen.getAllByRole("button", { name: /Upload Skill/i });
    await user.click(uploadButtons[0]);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("upload_skill", {
        filePath: "/path/to/file.skill",
      });
    });
  });

  it("does not call upload_skill when dialog is cancelled", async () => {
    const user = userEvent.setup();

    mockInvokeCommands({ list_imported_skills: [] });
    (mockOpen as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(<SkillsPage />);

    await waitFor(() => {
      expect(screen.getByText("No imported skills")).toBeInTheDocument();
    });

    const uploadButtons = screen.getAllByRole("button", { name: /Upload Skill/i });
    await user.click(uploadButtons[0]);

    // upload_skill should never be called
    await new Promise((r) => setTimeout(r, 50));
    expect(mockInvoke).not.toHaveBeenCalledWith("upload_skill", expect.anything());
  });
});
