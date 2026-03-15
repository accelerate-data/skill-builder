import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "@/lib/toast";
import SkillDialog from "@/components/skill-dialog";
import { useSettingsStore } from "@/stores/settings-store";
import type { SkillSummary } from "@/lib/types";

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

const updateSkillMetadataMock = vi.fn();
const renameSkillMock = vi.fn();
const generateSuggestionsMock = vi.fn();

vi.mock("@/lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tauri")>("@/lib/tauri");
  return {
    ...actual,
    updateSkillMetadata: (...args: unknown[]) => updateSkillMetadataMock(...args),
    renameSkill: (...args: unknown[]) => renameSkillMock(...args),
    generateSuggestions: (...args: unknown[]) => generateSuggestionsMock(...args),
  };
});

const SelectCtx = React.createContext<{
  value: string;
  onValueChange?: (v: string) => void;
  disabled?: boolean;
  idRef: React.MutableRefObject<string | undefined>;
} | null>(null);

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => {
    const idRef = React.useRef<string | undefined>(undefined);
    return (
      <SelectCtx.Provider value={{ value, onValueChange, disabled, idRef }}>
        {children}
      </SelectCtx.Provider>
    );
  },
  SelectTrigger: ({ id }: { id?: string; children?: React.ReactNode }) => {
    const ctx = React.useContext(SelectCtx);
    if (ctx && id) ctx.idRef.current = id;
    return null;
  },
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => {
    const ctx = React.useContext(SelectCtx);
    return (
      <select
        id={ctx?.idRef.current}
        value={ctx?.value ?? ""}
        onChange={(e) => ctx?.onValueChange?.(e.target.value)}
        disabled={ctx?.disabled}
      >
        {children}
      </select>
    );
  },
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
  SelectGroup: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectLabel: () => null,
  SelectSeparator: () => null,
}));

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "sales-pipeline",
    current_step: "step 2",
    status: "in_progress",
    last_modified: null,
    tags: ["analytics"],
    purpose: "platform",
    skill_source: null,
    author_login: null,
    author_avatar: null,
    intake_json: JSON.stringify({ context: "Original context" }),
    description: "Original description",
    version: "1.2.3",
    model: null,
    argumentHint: "[org-url]",
    userInvocable: true,
    disableModelInvocation: false,
    ...overrides,
  };
}

describe("SkillDialog (edit mode)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockNavigate.mockReset();
    updateSkillMetadataMock.mockReset().mockResolvedValue(undefined);
    renameSkillMock.mockReset().mockResolvedValue(undefined);
    generateSuggestionsMock.mockReset().mockResolvedValue({});
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useSettingsStore.getState().reset();
    useSettingsStore.getState().setSettings({ workspacePath: "/workspace", skillsPath: "/skills" });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("prepopulates edit fields and locks built skill identity fields", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={makeSkill({ status: "completed", current_step: "step 5 completed" })}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText("Edit Skill")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Skill Name/)).toHaveValue("sales-pipeline");
    expect(screen.getByLabelText(/^Skill Name/)).toBeDisabled();
    expect(screen.getByLabelText(/What are you trying to capture/)).toBeDisabled();
    expect(screen.getByLabelText("Tag input")).toBeDisabled();
    expect(screen.getByLabelText("What Claude needs to know")).toHaveValue("Original context");
  });

  it("locks imported skill fields that should not be edited", async () => {
    const user = userEvent.setup({ delay: null });

    render(
      <SkillDialog
        mode="edit"
        skill={makeSkill({ skill_source: "imported" })}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/What are you trying to capture/)).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Next/i }));

    expect(screen.getByLabelText(/^Version/)).toBeDisabled();
    expect(screen.getByLabelText(/^Argument Hint/)).toBeEnabled();
  });

  it("renames the skill before saving updated metadata", async () => {
    const user = userEvent.setup({ delay: null });
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <SkillDialog
        mode="edit"
        skill={makeSkill()}
        open={true}
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        existingNames={["other-skill"]}
      />,
    );

    const nameInput = screen.getByLabelText(/^Skill Name/);
    await user.clear(nameInput);
    await user.type(nameInput, "sales-pipeline-renamed");
    await user.clear(screen.getByLabelText(/^Description/));
    await user.type(screen.getByLabelText(/^Description/), "Updated description");
    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(renameSkillMock).toHaveBeenCalledWith(
        "sales-pipeline",
        "sales-pipeline-renamed",
        "/workspace",
      );
    }, { timeout: 10000 });

    expect(updateSkillMetadataMock).toHaveBeenCalledWith(
      "sales-pipeline-renamed",
      "platform",
      ["analytics"],
      JSON.stringify({ context: "Original context" }),
      "Updated description",
      "1.2.3",
      null,
      "[org-url]",
      true,
      false,
    );
    expect(toast.success).toHaveBeenCalledWith("Skill updated");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
  }, 15000);

  it("shows the locked banner and prevents advancing when externally locked", () => {
    render(
      <SkillDialog
        mode="edit"
        skill={makeSkill()}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
        isLocked={true}
      />,
    );

    expect(screen.getByText("This skill is being edited in another window")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next/i })).toBeDisabled();
  });

  it("shows a persistent toast when updating the skill fails", async () => {
    const user = userEvent.setup({ delay: null });
    updateSkillMetadataMock.mockRejectedValue(new Error("DB locked"));

    render(
      <SkillDialog
        mode="edit"
        skill={makeSkill()}
        open={true}
        onOpenChange={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Next/i }));
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Failed to update skill: DB locked", {
        duration: Infinity,
      });
    });
  });
});
