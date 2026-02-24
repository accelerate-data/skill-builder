import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke, resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "sonner";

// Mock sonner
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

// Mock @tanstack/react-router
const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import SkillDialog from "@/components/skill-dialog";
import { useSettingsStore } from "@/stores/settings-store";

// Helper: open dialog
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /New Skill/i }));
}

// Helper: fill Step 1 (name + purpose + description) and advance to Step 2
async function fillStep1AndAdvance(
  user: ReturnType<typeof userEvent.setup>,
  name = "test-skill",
  purposeValue = "platform",
  description = "A test skill description",
) {
  const nameInput = screen.getByLabelText(/^Skill Name/);
  await user.type(nameInput, name);
  // Select purpose from dropdown
  const purposeSelect = screen.getByLabelText(/What are you trying to capture/);
  await user.selectOptions(purposeSelect, purposeValue);
  const descriptionInput = screen.getByLabelText(/^Description/);
  await user.type(descriptionInput, description);
  await user.click(screen.getByRole("button", { name: /Next/i }));
}

function renderDialog(props: Partial<{ onCreated: () => Promise<void>; tagSuggestions: string[]; existingNames: string[] }> = {}) {
  return render(
    <SkillDialog
      mode="create"
      workspacePath="/workspace"
      onCreated={props.onCreated ?? vi.fn<() => Promise<void>>().mockResolvedValue(undefined)}
      tagSuggestions={props.tagSuggestions}
      existingNames={props.existingNames}
    />,
  );
}

describe("SkillDialog (create mode)", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockNavigate.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    useSettingsStore.getState().reset();
  });

  // --- Trigger & dialog open ---

  it("renders trigger button", () => {
    renderDialog();
    expect(
      screen.getByRole("button", { name: /New Skill/i }),
    ).toBeInTheDocument();
  });

  it("opens dialog on Step 1 when trigger button is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    expect(screen.getByText("Create New Skill")).toBeInTheDocument();
    expect(
      screen.getByText(/Name your skill, choose its purpose/),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
  });

  // --- Step 1: Name + Purpose (dropdown) + Description + Tags + Context ---

  it("renders skill name input and purpose dropdown on Step 1", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    expect(screen.getByLabelText(/^Skill Name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/What are you trying to capture/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Description/)).toBeInTheDocument();
    expect(screen.getByLabelText("What Claude needs to know")).toBeInTheDocument();
  });

  it("enforces kebab-case on skill name input", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    const nameInput = screen.getByLabelText(/^Skill Name/);
    await user.type(nameInput, "Sales Pipeline");

    // toKebabChars strips non-[a-z0-9-] chars (spaces removed, uppercase lowered)
    expect(nameInput).toHaveValue("salespipeline");
  });

  it("disables Next button when name is empty", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    const nextButton = screen.getByRole("button", { name: /Next/i });
    expect(nextButton).toBeDisabled();
  });

  it("disables Next button when purpose is not selected", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.type(screen.getByLabelText(/^Skill Name/), "test-skill");
    await user.type(screen.getByLabelText(/^Description/), "A description");

    const nextButton = screen.getByRole("button", { name: /Next/i });
    expect(nextButton).toBeDisabled();
  });

  it("disables Next button when description is empty", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.type(screen.getByLabelText(/^Skill Name/), "test-skill");
    await user.selectOptions(screen.getByLabelText(/What are you trying to capture/), "platform");

    const nextButton = screen.getByRole("button", { name: /Next/i });
    expect(nextButton).toBeDisabled();
  });

  it("enables Next button when name, purpose, and description are all filled", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.type(screen.getByLabelText(/^Skill Name/), "test-skill");
    await user.selectOptions(screen.getByLabelText(/What are you trying to capture/), "platform");
    await user.type(screen.getByLabelText(/^Description/), "A test description");

    const nextButton = screen.getByRole("button", { name: /Next/i });
    expect(nextButton).toBeEnabled();
  });

  it("disables Next button when skill name already exists", async () => {
    const user = userEvent.setup();
    renderDialog({ existingNames: ["sales-pipeline", "my-skill"] });
    await openDialog(user);

    await user.type(screen.getByLabelText(/^Skill Name/), "sales-pipeline");
    await user.selectOptions(screen.getByLabelText(/What are you trying to capture/), "platform");
    await user.type(screen.getByLabelText(/^Description/), "A description");

    expect(screen.getByRole("button", { name: /Next/i })).toBeDisabled();
    expect(screen.getByText("A skill with this name already exists")).toBeInTheDocument();
  });

  it("shows skills output location on Step 1 when skillsPath is set", async () => {
    useSettingsStore.getState().setSettings({ skillsPath: "/my/skills" });
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.type(screen.getByLabelText(/^Skill Name/), "sales-pipeline");

    expect(screen.getByText(/\/my\/skills\/sales-pipeline\//)).toBeInTheDocument();
  });

  it("has Cancel button on Step 1 that closes dialog", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    expect(screen.getByText("Create New Skill")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Cancel/i }));

    await waitFor(() => {
      expect(screen.queryByText("Create New Skill")).not.toBeInTheDocument();
    });
  });

  // --- Step 2: Behaviour settings ---

  it("advances to Step 2 when Next is clicked", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await fillStep1AndAdvance(user);

    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText("Version")).toBeInTheDocument();
    expect(screen.getByLabelText("Model")).toBeInTheDocument();
  });

  it("shows Back and Create buttons on Step 2 (no Next or Skip)", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await fillStep1AndAdvance(user);

    expect(screen.getByRole("button", { name: /Back/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Skip/i })).not.toBeInTheDocument();
  });

  it("navigates back to Step 1 when Back is clicked on Step 2", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);
    await fillStep1AndAdvance(user);

    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Back/i }));

    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Skill Name/)).toBeInTheDocument();
  });

  // --- Submit scenarios ---

  it("can submit from Step 2 with Create button", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockInvoke.mockResolvedValue(undefined);
    renderDialog({ onCreated });

    await openDialog(user);
    await fillStep1AndAdvance(user, "sales-pipeline", "domain", "A sales pipeline skill");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", {
        workspacePath: "/workspace",
        name: "sales-pipeline",
        tags: null,
        purpose: "domain",
        intakeJson: null,
        description: "A sales pipeline skill",
        version: "1.0.0",
        model: null,
        argumentHint: null,
        userInvocable: true,
        disableModelInvocation: false,
      });
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Skill "sales-pipeline" created',
    );
  });

  it("does not show Skip button on Step 2", async () => {
    const user = userEvent.setup();
    renderDialog();

    await openDialog(user);
    await fillStep1AndAdvance(user, "sales-pipeline", "domain", "A sales pipeline skill");

    expect(screen.queryByRole("button", { name: /Skip/i })).not.toBeInTheDocument();
  });

  it("passes selected purpose to invoke on submit", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);
    renderDialog();

    await openDialog(user);
    await fillStep1AndAdvance(user, "etl-patterns", "data-engineering", "ETL patterns skill");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", expect.objectContaining({
        name: "etl-patterns",
        purpose: "data-engineering",
      }));
    });
  });

  it("passes tags to invoke when tags are added on Step 1", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);
    renderDialog();

    await openDialog(user);

    // Fill name + purpose + description on step 1
    await user.type(screen.getByLabelText(/^Skill Name/), "test-skill");
    await user.selectOptions(screen.getByLabelText(/What are you trying to capture/), "source");
    await user.type(screen.getByLabelText(/^Description/), "A source skill");

    // Add tags on step 1
    const tagInput = screen.getByRole("textbox", { name: /tag input/i });
    await user.type(tagInput, "analytics{Enter}");
    await user.type(tagInput, "salesforce{Enter}");

    // Advance to step 2 and submit
    await user.click(screen.getByRole("button", { name: /Next/i }));
    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", expect.objectContaining({
        name: "test-skill",
        tags: ["analytics", "salesforce"],
        purpose: "source",
      }));
    });
  });

  it("navigates to skill editor after successful creation", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    mockInvoke.mockResolvedValue(undefined);
    renderDialog({ onCreated });

    await openDialog(user);
    await fillStep1AndAdvance(user, "sales-pipeline", "domain", "A sales skill");

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalled();
    });

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/skill/$skillName",
      params: { skillName: "sales-pipeline" },
    });
  });

  // --- Error handling ---

  it("does not navigate on failed creation", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("Skill already exists"));
    renderDialog();

    await openDialog(user);
    await fillStep1AndAdvance(user);

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText("Skill already exists")).toBeInTheDocument();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows error message and toast on failed submit", async () => {
    const user = userEvent.setup();
    mockInvoke.mockRejectedValue(new Error("Skill already exists"));
    renderDialog();

    await openDialog(user);
    await fillStep1AndAdvance(user);

    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText("Skill already exists")).toBeInTheDocument();
    });
    expect(toast.error).toHaveBeenCalledWith("Failed to create skill", {
      duration: Infinity,
    });
  });

  // --- Tag autocomplete ---

  it("shows autocomplete dropdown and allows selecting a suggestion", async () => {
    const user = userEvent.setup();
    mockInvoke.mockResolvedValue(undefined);
    renderDialog({ tagSuggestions: ["analytics", "salesforce", "workday"] });

    await openDialog(user);

    // Fill name + purpose + description first
    await user.type(screen.getByLabelText(/^Skill Name/), "test");
    await user.selectOptions(screen.getByLabelText(/What are you trying to capture/), "platform");
    await user.type(screen.getByLabelText(/^Description/), "A platform skill");

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

    // Advance to step 2 and submit
    await user.click(screen.getByRole("button", { name: /Next/i }));
    const createButton = screen.getByRole("button", { name: /^Create$/i });
    await user.click(createButton);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_skill", expect.objectContaining({
        name: "test",
        tags: ["salesforce"],
        purpose: "platform",
      }));
    });
  });

  it("hides already-added tags from autocomplete suggestions", async () => {
    const user = userEvent.setup();
    renderDialog({ tagSuggestions: ["analytics", "anomaly"] });

    await openDialog(user);

    const tagInput = screen.getByRole("textbox", { name: /tag input/i });

    // Add "analytics" as a tag
    await user.type(tagInput, "analytics{Enter}");

    // Now type "an" -- "analytics" should NOT appear since it's already added
    await user.type(tagInput, "an");

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("anomaly");
  });
});
