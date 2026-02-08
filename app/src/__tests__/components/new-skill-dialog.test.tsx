import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "sonner";

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

import NewSkillDialog from "@/components/new-skill-dialog";

describe("NewSkillDialog", () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("renders trigger button", () => {
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );
    expect(
      screen.getByRole("button", { name: /New Skill/i })
    ).toBeInTheDocument();
  });

  it("opens dialog when trigger button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    expect(screen.getByText("Create New Skill")).toBeInTheDocument();
    expect(
      screen.getByText("Define the functional domain for your new skill.")
    ).toBeInTheDocument();
  });

  it("renders domain and skill name inputs in dialog", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    expect(screen.getByLabelText("Domain")).toBeInTheDocument();
    expect(screen.getByLabelText("Skill Name")).toBeInTheDocument();
  });

  it("auto-generates kebab-case name from domain input", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Sales Pipeline");

    const nameInput = screen.getByLabelText("Skill Name");
    expect(nameInput).toHaveValue("sales-pipeline");
  });

  it("disables Create button when domain is empty", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    expect(createButton).toBeDisabled();
  });

  it("enables Create button when domain has text", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Test Domain");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    expect(createButton).toBeEnabled();
  });

  it("calls invoke create_skill and onCreated on successful submit", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={onCreated} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Sales Pipeline");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", {
        workspacePath: "/workspace",
        name: "sales-pipeline",
        domain: "Sales Pipeline",
      });
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Skill "sales-pipeline" created'
    );
  });

  it("shows error message on failed submit", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("Skill already exists"));

    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Test Skill");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText("Skill already exists")).toBeInTheDocument();
    });
    expect(toast.error).toHaveBeenCalledWith("Failed to create skill");
  });

  it("has Cancel button that closes dialog", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));
    expect(screen.getByText("Create New Skill")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText("Create New Skill")).not.toBeInTheDocument();
    });
  });

  it("allows editing the skill name independently", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "My Domain");

    const nameInput = screen.getByLabelText("Skill Name");
    await user.clear(nameInput);
    await user.type(nameInput, "custom-name");

    expect(nameInput).toHaveValue("custom-name");
  });
});
