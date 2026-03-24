import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    dismiss: vi.fn(),
  },
}));

import { CreatePluginDialog } from "@/components/create-plugin-dialog";
import { toast } from "@/lib/toast";

function renderDialog(props: Partial<React.ComponentProps<typeof CreatePluginDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <CreatePluginDialog
      open={true}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      {...props}
    />
  );
  return { onOpenChange, onCreated };
}

describe("CreatePluginDialog", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
  });

  it("renders dialog with heading and input", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Create Plugin" })).toBeInTheDocument();
    expect(screen.getByLabelText("Plugin name")).toBeInTheDocument();
  });

  it("Create button is disabled when name is empty", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("Create button is disabled for invalid name", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Plugin name"), "My Plugin");
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("shows validation error for invalid name", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Plugin name"), "INVALID");
    expect(screen.getByText(/lowercase letters, numbers, and hyphens/)).toBeInTheDocument();
  });

  it("Create button is enabled for valid kebab-case name", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText("Plugin name"), "my-plugin");
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
  });

  it("calls createPluginFromSkills with correct args on submit", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue("my-plugin");
    const { onOpenChange, onCreated } = renderDialog();

    await user.type(screen.getByLabelText("Plugin name"), "my-plugin");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_plugin_from_skills", {
        pluginName: "my-plugin",
        skillKeys: [],
      });
    });
    expect(toast.success).toHaveBeenCalledWith('Created plugin "my-plugin"', expect.anything());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).toHaveBeenCalled();
  });

  it("passes initialSkillKey in skillKeys when provided", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue("my-plugin");
    renderDialog({ initialSkillKey: "skill-builder:skills:my-skill" });

    await user.type(screen.getByLabelText("Plugin name"), "my-plugin");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_plugin_from_skills", {
        pluginName: "my-plugin",
        skillKeys: ["skill-builder:skills:my-skill"],
      });
    });
  });

  it("shows error toast on failure and does not close dialog", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("A plugin named 'my-plugin' already exists"));
    const { onOpenChange } = renderDialog();

    await user.type(screen.getByLabelText("Plugin name"), "my-plugin");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("already exists"),
        expect.anything(),
      );
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("shows initial-skill description when initialSkillKey is set", () => {
    renderDialog({ initialSkillKey: "skill:foo" });
    expect(screen.getByText(/move the selected skill/)).toBeInTheDocument();
  });

  it("shows empty-plugin description when no initialSkillKey", () => {
    renderDialog();
    expect(screen.getByText(/Create a new empty plugin/)).toBeInTheDocument();
  });
});
