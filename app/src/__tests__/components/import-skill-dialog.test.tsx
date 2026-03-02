import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetTauriMocks } from "@/test/mocks/tauri";
import { toast } from "sonner";

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

// Hoist mock functions so they can be referenced in vi.mock factories
const { mockImportSkillFromFile } = vi.hoisted(() => ({
  mockImportSkillFromFile: vi.fn<(...args: unknown[]) => Promise<string>>(() =>
    Promise.resolve("ok"),
  ),
}));

vi.mock("@/lib/tauri", () => ({
  importSkillFromFile: mockImportSkillFromFile,
}));

import { ImportSkillDialog } from "@/components/import-skill-dialog";
import type { SkillFileMeta } from "@/lib/types";

const SAMPLE_META: SkillFileMeta = {
  name: "my-skill",
  description: "Does something useful",
  version: "2.1.0",
  model: "claude-sonnet-4-6",
  argument_hint: "[target-org]",
  user_invocable: true,
  disable_model_invocation: false,
};

function renderDialog(
  props: Partial<React.ComponentProps<typeof ImportSkillDialog>> = {}
) {
  const onOpenChange = vi.fn();
  const onImported = vi.fn();
  return {
    onOpenChange,
    onImported,
    ...render(
      <ImportSkillDialog
        open={true}
        onOpenChange={onOpenChange}
        filePath="/tmp/my-skill.skill"
        meta={SAMPLE_META}
        onImported={onImported}
        {...props}
      />
    ),
  };
}

describe("ImportSkillDialog", () => {
  beforeEach(() => {
    resetTauriMocks();
    mockImportSkillFromFile.mockReset().mockResolvedValue("ok");
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  // -------------------------------------------------------------------
  // Pre-fill
  // -------------------------------------------------------------------

  describe("Pre-fill from meta", () => {
    it("renders with name pre-filled from meta", () => {
      renderDialog();
      expect(screen.getByDisplayValue("my-skill")).toBeInTheDocument();
    });

    it("renders with description pre-filled from meta", () => {
      renderDialog();
      expect(screen.getByDisplayValue("Does something useful")).toBeInTheDocument();
    });

    it("renders with version pre-filled from meta", () => {
      renderDialog();
      expect(screen.getByDisplayValue("2.1.0")).toBeInTheDocument();
    });

    it("renders with model pre-selected from meta", () => {
      renderDialog();
      const modelSelect = screen.getByRole("combobox") as HTMLSelectElement;
      expect(modelSelect.value).toBe("claude-sonnet-4-6");
    });
  });

  // -------------------------------------------------------------------
  // Version defaults to 1.0.0 when null
  // -------------------------------------------------------------------

  describe("Version default", () => {
    it("shows 1.0.0 when meta.version is null", () => {
      renderDialog({ meta: { ...SAMPLE_META, version: null } });
      expect(screen.getByDisplayValue("1.0.0")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // Confirm Import button enabled/disabled
  // -------------------------------------------------------------------

  describe("Confirm Import button state", () => {
    it("is enabled when name, description, and version are all filled", () => {
      renderDialog();
      expect(
        screen.getByRole("button", { name: /Confirm Import/i })
      ).toBeEnabled();
    });

    it("is disabled when name is empty", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.clear(screen.getByLabelText(/^Name/i));

      expect(
        screen.getByRole("button", { name: /Confirm Import/i })
      ).toBeDisabled();
    });

    it("is disabled when description is empty", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.clear(screen.getByLabelText(/^Description/i));

      expect(
        screen.getByRole("button", { name: /Confirm Import/i })
      ).toBeDisabled();
    });

    it("is disabled when version is empty", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.clear(screen.getByLabelText(/^Version/i));

      expect(
        screen.getByRole("button", { name: /Confirm Import/i })
      ).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------
  // conflict_no_overwrite
  // -------------------------------------------------------------------

  describe("conflict_no_overwrite error", () => {
    it("shows inline error below Name field when importSkillFromFile rejects with conflict_no_overwrite", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(
        new Error("conflict_no_overwrite:my-skill")
      );

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/A skill named 'my-skill' already exists/)
        ).toBeInTheDocument();
      });
    });

    it("does not show overwrite confirm when conflict_no_overwrite fires", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(
        new Error("conflict_no_overwrite:my-skill")
      );

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/A skill named 'my-skill' already exists/)
        ).toBeInTheDocument();
      });

      // Overwrite confirm UI should NOT appear
      expect(screen.queryByRole("button", { name: /Overwrite/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // conflict_overwrite_required
  // -------------------------------------------------------------------

  describe("conflict_overwrite_required error", () => {
    it("shows overwrite confirmation prompt when importSkillFromFile rejects with conflict_overwrite_required", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(
        new Error("conflict_overwrite_required:my-skill")
      );

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Overwrite/i })
        ).toBeInTheDocument();
      });
    });

    it("shows skill name in overwrite confirmation text", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(
        new Error("conflict_overwrite_required:my-skill")
      );

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(screen.getByText(/is already imported/i)).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------
  // Overwrite confirm — calls importSkillFromFile with forceOverwrite:true
  // -------------------------------------------------------------------

  describe("Overwrite confirm", () => {
    it("calls importSkillFromFile with forceOverwrite:true when Overwrite is clicked", async () => {
      const user = userEvent.setup();

      // First call triggers the overwrite required prompt, second call succeeds
      mockImportSkillFromFile
        .mockRejectedValueOnce(new Error("conflict_overwrite_required:my-skill"))
        .mockResolvedValueOnce("ok");

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Overwrite/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /Overwrite/i }));

      await waitFor(() => {
        expect(mockImportSkillFromFile).toHaveBeenCalledWith(
          expect.objectContaining({ forceOverwrite: true })
        );
      });
    });

    it("hides the main form while overwrite confirmation is shown", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(
        new Error("conflict_overwrite_required:my-skill")
      );

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Overwrite/i })).toBeInTheDocument();
      });

      // The main form submit button must not be visible at the same time
      expect(screen.queryByRole("button", { name: /Confirm Import/i })).not.toBeInTheDocument();
    });

    it("returns to the main form when Cancel is clicked on the overwrite panel", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(
        new Error("conflict_overwrite_required:my-skill")
      );

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Overwrite/i })).toBeInTheDocument();
      });

      // Click Cancel on the overwrite panel
      const cancelButtons = screen.getAllByRole("button", { name: /Cancel/i });
      // The overwrite panel's Cancel is the one in the confirmation view
      await user.click(cancelButtons[cancelButtons.length - 1]);

      // Form should be visible again
      await waitFor(() => {
        expect(
          screen.getByRole("button", { name: /Confirm Import/i })
        ).toBeInTheDocument();
      });

      // Overwrite button must be gone
      expect(screen.queryByRole("button", { name: /Overwrite/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // conflict_no_overwrite — error clears on name edit
  // -------------------------------------------------------------------

  describe("conflict_no_overwrite error clears on name edit", () => {
    it("clears the inline name error when the user types in the name field", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(
        new Error("conflict_no_overwrite:my-skill")
      );

      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/A skill named 'my-skill' already exists/)
        ).toBeInTheDocument();
      });

      // Edit the name field — error should clear
      await user.type(screen.getByLabelText(/^Name/i), "-v2");

      expect(
        screen.queryByText(/A skill named 'my-skill' already exists/)
      ).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------
  // Success
  // -------------------------------------------------------------------

  describe("Success", () => {
    it("calls onImported after successful import", async () => {
      const user = userEvent.setup();
      const { onImported } = renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(onImported).toHaveBeenCalledOnce();
      });
    });

    it("calls onOpenChange(false) after successful import", async () => {
      const user = userEvent.setup();
      const { onOpenChange } = renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it("fires success toast with skill name after successful import", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Imported "my-skill"');
      });
    });
  });

  // -------------------------------------------------------------------
  // Non-conflict errors
  // -------------------------------------------------------------------

  describe("Non-conflict import error", () => {
    it("fires error toast and stays open when importSkillFromFile rejects with a generic error", async () => {
      const user = userEvent.setup();
      mockImportSkillFromFile.mockRejectedValue(new Error("disk full"));

      const { onOpenChange, onImported } = renderDialog();

      await user.click(screen.getByRole("button", { name: /Confirm Import/i }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          expect.stringContaining("disk full"),
          expect.anything()
        );
      });

      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(onImported).not.toHaveBeenCalled();
    });
  });
});
