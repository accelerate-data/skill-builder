import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@/lib/types";
import { createTestQueryClient } from "@/test/query-test-utils";

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listSkillsForDocuments: vi.fn(),
  addDocumentFile: vi.fn(),
  addDocumentUrl: vi.fn(),
  addDocumentFolder: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  listDocuments: mocks.listDocuments,
  listSkillsForDocuments: mocks.listSkillsForDocuments,
  addDocumentFile: mocks.addDocumentFile,
  addDocumentUrl: mocks.addDocumentUrl,
  addDocumentFolder: mocks.addDocumentFolder,
  updateDocument: mocks.updateDocument,
  deleteDocument: mocks.deleteDocument,
}));

import {
  useAddDocumentFileMutation,
  useAddDocumentFolderMutation,
  useAddDocumentUrlMutation,
  useDeleteDocumentMutation,
  useDocumentSkillOptionsQuery,
  useDocumentsQuery,
  useUpdateDocumentMutation,
} from "@/lib/queries/documents";

function wrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const document: Document = {
  id: 1,
  name: "Release notes",
  source_type: "url",
  source_url: "https://example.com/release",
  file_path: "/tmp/release.md",
  scope: "all",
  skill_ids: [],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("document query hooks", () => {
  beforeEach(() => {
    mocks.listDocuments.mockReset();
    mocks.listSkillsForDocuments.mockReset();
    mocks.addDocumentFile.mockReset();
    mocks.addDocumentUrl.mockReset();
    mocks.addDocumentFolder.mockReset();
    mocks.updateDocument.mockReset();
    mocks.deleteDocument.mockReset();
  });

  it("loads documents and document skill options", async () => {
    mocks.listDocuments.mockResolvedValue([document]);
    mocks.listSkillsForDocuments.mockResolvedValue([
      {
        id: 7,
        name: "Skill",
        plugin_slug: "default",
        plugin_display_name: "Default",
        is_default_plugin: true,
      },
    ]);
    const { Wrapper } = wrapper();

    const docs = renderHook(() => useDocumentsQuery(), { wrapper: Wrapper });
    const skills = renderHook(() => useDocumentSkillOptionsQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(docs.result.current.data).toEqual([document]));
    await waitFor(() => expect(skills.result.current.data).toHaveLength(1));
  });

  it("updates cached documents after adding or deleting a document", async () => {
    mocks.addDocumentUrl.mockResolvedValue(document);
    mocks.deleteDocument.mockResolvedValue(undefined);
    const { Wrapper, queryClient } = wrapper();
    queryClient.setQueryData(["documents", "list"], []);

    const add = renderHook(() => useAddDocumentUrlMutation(), { wrapper: Wrapper });
    add.result.current.mutate({
      name: "Release notes",
      url: "https://example.com/release",
      scope: "all",
      skillIds: [],
    });
    await waitFor(() => expect(add.result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["documents", "list"])).toEqual([document]);

    const remove = renderHook(() => useDeleteDocumentMutation(), { wrapper: Wrapper });
    remove.result.current.mutate(1);
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(["documents", "list"])).toEqual([]);
  });

  it("updates cached documents after file, folder, and assignment mutations", async () => {
    const fileDocument = { ...document, id: 2, name: "Uploaded file", source_type: "file" as const };
    const folderDocuments = [
      { ...document, id: 3, name: "Folder doc", source_type: "folder" as const },
    ];
    const assignedDocument = { ...fileDocument, scope: "skill" as const, skill_ids: [7] };
    mocks.addDocumentFile.mockResolvedValue(fileDocument);
    mocks.addDocumentFolder.mockResolvedValue(folderDocuments);
    mocks.updateDocument.mockResolvedValue(assignedDocument);
    const { Wrapper, queryClient } = wrapper();
    queryClient.setQueryData(["documents", "list"], []);

    const addFile = renderHook(() => useAddDocumentFileMutation(), { wrapper: Wrapper });
    addFile.result.current.mutate({
      name: "Uploaded file",
      content: "hello",
      scope: "all",
      skillIds: [],
    });
    await waitFor(() => expect(addFile.result.current.isSuccess).toBe(true));

    const addFolder = renderHook(() => useAddDocumentFolderMutation(), { wrapper: Wrapper });
    addFolder.result.current.mutate({
      name: "Folder",
      folderPath: "/tmp/folder",
      scope: "all",
      skillIds: [],
    });
    await waitFor(() => expect(addFolder.result.current.isSuccess).toBe(true));

    const update = renderHook(() => useUpdateDocumentMutation(), { wrapper: Wrapper });
    update.result.current.mutate({ id: 2, scope: "skill", skillIds: [7] });
    await waitFor(() => expect(update.result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["documents", "list"])).toEqual([
      assignedDocument,
      folderDocuments[0],
    ]);
  });
});
