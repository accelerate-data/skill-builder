import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Document } from "@/lib/types";
import { createTestQueryClient } from "@/test/query-test-utils";

const mocks = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  listSkillsForDocuments: vi.fn(),
  addDocumentUrl: vi.fn(),
  deleteDocument: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  listDocuments: mocks.listDocuments,
  listSkillsForDocuments: mocks.listSkillsForDocuments,
  addDocumentUrl: mocks.addDocumentUrl,
  deleteDocument: mocks.deleteDocument,
}));

import {
  useAddDocumentUrlMutation,
  useDeleteDocumentMutation,
  useDocumentSkillOptionsQuery,
  useDocumentsQuery,
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
    mocks.addDocumentUrl.mockReset();
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

  it("invalidates documents after adding or deleting a document", async () => {
    mocks.addDocumentUrl.mockResolvedValue(document);
    mocks.deleteDocument.mockResolvedValue(undefined);
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const add = renderHook(() => useAddDocumentUrlMutation(), { wrapper: Wrapper });
    add.result.current.mutate({
      name: "Release notes",
      url: "https://example.com/release",
      scope: "all",
      skillIds: [],
    });
    await waitFor(() => expect(add.result.current.isSuccess).toBe(true));

    const remove = renderHook(() => useDeleteDocumentMutation(), { wrapper: Wrapper });
    remove.result.current.mutate(1);
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});
