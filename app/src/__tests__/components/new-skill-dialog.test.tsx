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

  it("enables Create button when domain has text and skill type is selected", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    // Select a skill type
    await user.click(screen.getByRole("radio", { name: /Platform/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Test Domain");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    expect(createButton).toBeEnabled();
  });

  it("disables Create button when skill type is not selected", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Test Domain");

    // No skill type selected
    const createButton = screen.getByRole("button", { name: /^Create$/i });
    expect(createButton).toBeDisabled();
  });

  it("calls invoke create_skill and onCreated on successful submit", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={onCreated} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    // Select skill type
    await user.click(screen.getByRole("radio", { name: /Domain/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Sales Pipeline");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", {
        workspacePath: "/workspace",
        name: "sales-pipeline",
        domain: "Sales Pipeline",
        tags: null,
        skillType: "domain",
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

    await user.click(screen.getByRole("radio", { name: /Platform/i }));

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

  it("renders tag input in dialog", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.getByText("Optional tags for categorization")).toBeInTheDocument();
  });

  it("passes tags to invoke when tags are added", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    await user.click(screen.getByRole("radio", { name: /Source/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Test Domain");

    const tagInput = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(tagInput, "analytics{Enter}");
    await user.type(tagInput, "salesforce{Enter}");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", {
        workspacePath: "/workspace",
        name: "test-domain",
        domain: "Test Domain",
        tags: ["analytics", "salesforce"],
        skillType: "source",
      });
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

  it("renders skill type radio group with 4 options", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    expect(screen.getByText("Skill Type")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.getByText("Platform")).toBeInTheDocument();
    // "Domain" appears both as radio label and input label, so verify via radio count
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("Data Engineering")).toBeInTheDocument();
    // Verify the Domain radio option exists by its description
    expect(screen.getByText(/Business domain knowledge/)).toBeInTheDocument();
  });

  it("passes selected skillType to invoke on submit", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <NewSkillDialog workspacePath="/workspace" onCreated={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));
    await user.click(screen.getByRole("radio", { name: /Data Engineering/i }));

    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "ETL Patterns");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", {
        workspacePath: "/workspace",
        name: "etl-patterns",
        domain: "ETL Patterns",
        tags: null,
        skillType: "data-engineering",
      });
    });
  });

  it("forwards tagSuggestions to TagInput as suggestions", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog
        workspacePath="/workspace"
        onCreated={vi.fn()}
        tagSuggestions={["analytics", "salesforce", "workday"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const tagInput = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(tagInput, "ana");

    // Suggestion from tagSuggestions should appear
    expect(screen.getByText("analytics")).toBeInTheDocument();
    // Non-matching suggestions should not appear
    expect(screen.queryByText("workday")).not.toBeInTheDocument();
  });

  it("shows autocomplete dropdown and allows selecting a suggestion", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);

    render(
      <NewSkillDialog
        workspacePath="/workspace"
        onCreated={vi.fn()}
        tagSuggestions={["analytics", "salesforce", "workday"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    // Select skill type and fill domain so we can submit later
    await user.click(screen.getByRole("radio", { name: /Platform/i }));
    const domainInput = screen.getByLabelText("Domain");
    await user.type(domainInput, "Test");

    const tagInput = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(tagInput, "sale");

    // Autocomplete dropdown should show matching suggestion
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("salesforce")).toBeInTheDocument();
    expect(screen.queryByText("analytics")).not.toBeInTheDocument();

    // Select the suggestion via keyboard
    await user.keyboard("{ArrowDown}{Enter}");

    // Suggestion should be added as a tag badge
    expect(screen.getByText("salesforce")).toBeInTheDocument();
    // Dropdown should be dismissed
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    // Submit to verify the selected suggestion is included in the invoke call
    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", {
        workspacePath: "/workspace",
        name: "test",
        domain: "Test",
        tags: ["salesforce"],
        skillType: "platform",
      });
    });
  });

  it("autocomplete matches case-insensitively", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog
        workspacePath="/workspace"
        onCreated={vi.fn()}
        tagSuggestions={["Analytics", "Salesforce"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const tagInput = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(tagInput, "ANA");

    // Should match case-insensitively
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.queryByText("Salesforce")).not.toBeInTheDocument();
  });

  it("hides already-added tags from autocomplete suggestions", async () => {
    const user = userEvent.setup();
    render(
      <NewSkillDialog
        workspacePath="/workspace"
        onCreated={vi.fn()}
        tagSuggestions={["analytics", "anomaly"]}
      />
    );

    await user.click(screen.getByRole("button", { name: /New Skill/i }));

    const tagInput = screen.getByRole("textbox", { name: /tag input/i });

    // Add "analytics" as a tag
    await user.type(tagInput, "analytics{Enter}");

    // Now type "an" — "analytics" should NOT appear since it's already added
    await user.type(tagInput, "an");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("anomaly");
  });
});
