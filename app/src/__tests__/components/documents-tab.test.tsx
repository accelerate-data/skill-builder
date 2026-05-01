import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Document } from "@/lib/types";
import { renderWithQueryClient } from "@/test/query-test-utils";

const mocks = vi.hoisted(() => ({
  addDocumentUrl: vi.fn(),
  deleteDocument: vi.fn(),
  listDocuments: vi.fn(),
  listSkillsForDocuments: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  addDocumentFile: vi.fn(),
  addDocumentFolder: vi.fn(),
  addDocumentUrl: mocks.addDocumentUrl,
  deleteDocument: mocks.deleteDocument,
  listDocuments: mocks.listDocuments,
  listSkillsForDocuments: mocks.listSkillsForDocuments,
  updateDocument: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

import { DocumentsTab } from "@/components/documents-tab";

const now = "2026-01-01T00:00:00.000Z";
const releaseNotes: Document = {
  id: 1,
  name: "Release Notes",
  source_type: "url",
  source_url: "https://example.com/notes",
  file_path: "",
  scope: "all",
  skill_ids: [],
  created_at: now,
  updated_at: now,
};

describe("DocumentsTab", () => {
  beforeEach(() => {
    mocks.addDocumentUrl.mockReset();
    mocks.deleteDocument.mockReset();
    mocks.listDocuments.mockReset();
    mocks.listSkillsForDocuments.mockReset();
    mocks.listSkillsForDocuments.mockResolvedValue([]);
  });

  it("renders the empty state from query data", async () => {
    mocks.listDocuments.mockResolvedValue([]);

    renderWithQueryClient(<DocumentsTab />);

    expect(await screen.findByText(/No documents added yet/)).toBeInTheDocument();
  });

  it("adds a URL document and renders the returned row", async () => {
    const apiDocs = { ...releaseNotes, id: 2, name: "API Docs", source_url: "https://api.example.com/docs" };
    mocks.listDocuments.mockResolvedValue([]);
    mocks.addDocumentUrl.mockResolvedValue(apiDocs);
    const user = userEvent.setup();

    renderWithQueryClient(<DocumentsTab />);

    await user.click(await screen.findByRole("button", { name: "Add URL" }));
    await user.type(screen.getByPlaceholderText("e.g. Fabric Release Notes"), "API Docs");
    await user.type(screen.getByPlaceholderText("https://..."), "https://api.example.com/docs");
    await user.click(screen.getByRole("button", { name: "Fetch & Add" }));

    await waitFor(() => expect(screen.queryByText("Add document from URL")).not.toBeInTheDocument());
    expect(await screen.findByText("API Docs")).toBeInTheDocument();
    expect(mocks.addDocumentUrl).toHaveBeenCalledWith("API Docs", "https://api.example.com/docs", "all", []);
  });

  it("deletes a document and removes the row from query data", async () => {
    mocks.listDocuments.mockResolvedValue([releaseNotes]);
    mocks.deleteDocument.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithQueryClient(<DocumentsTab />);

    expect(await screen.findByText("Release Notes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "" }));

    await waitFor(() => expect(screen.queryByText("Release Notes")).not.toBeInTheDocument());
    expect(screen.getByText(/No documents added yet/)).toBeInTheDocument();
    expect(mocks.deleteDocument.mock.calls[0]?.[0]).toBe(1);
  });
});
