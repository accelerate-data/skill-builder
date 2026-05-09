import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderSkillsQuery, useDeleteImportedSkillMutation, useImportedSkillsQuery } from "@/lib/queries/skills";
import type { ImportedSkill } from "@/lib/types";
import { makeSkillSummary } from "@/test/fixtures";
import { mockInvoke, mockInvokeCommands, resetTauriMocks } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/query-test-utils";

function wrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

function makeImportedSkill(overrides?: Partial<ImportedSkill>): ImportedSkill {
  return {
    skill_id: "imported-1",
    skill_name: "imported-skill",
    library_key: "imported:imported-1",
    description: "Imported skill",
    is_active: true,
    disk_path: "/skills/imported-skill",
    imported_at: "2026-01-15T10:00:00Z",
    is_bundled: false,
    purpose: null,
    version: null,
    user_invocable: null,
    disable_model_invocation: null,
    marketplace_source_url: null,
    plugin_slug: "skills",
    plugin_display_name: "Skills",
    is_default_plugin: true,
    ...overrides,
  };
}

describe("skill queries", () => {
  beforeEach(() => {
    resetTauriMocks();
  });

  it("loads builder skills through the query cache", async () => {
    const skill = makeSkillSummary({ name: "analytics-helper" });
    mockInvokeCommands({ list_skills: [skill] });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useBuilderSkillsQuery("/workspace"), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([skill]));
    expect(result.current.data).toEqual([skill]);
    expect(mockInvoke).toHaveBeenCalledWith("list_skills", {
      workspacePath: "/workspace",
      sourceUrl: null,
    });
  });

  it("does not load builder skills until workspace path exists", () => {
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useBuilderSkillsQuery(null), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockInvoke).not.toHaveBeenCalledWith("list_skills", expect.anything());
  });

  it("loads imported skills through the query cache", async () => {
    const skill = makeImportedSkill();
    mockInvokeCommands({ list_imported_skills: [skill] });
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => useImportedSkillsQuery(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([skill]));
    expect(result.current.data).toEqual([skill]);
    expect(mockInvoke).toHaveBeenCalledWith("list_imported_skills", {
      sourceUrl: null,
    });
  });

  it("invalidates imported skills after delete", async () => {
    mockInvokeCommands({ delete_imported_skill: undefined });
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useDeleteImportedSkillMutation(), {
      wrapper: Wrapper,
    });
    result.current.mutate("imported-1");

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockInvoke).toHaveBeenCalledWith("delete_imported_skill", {
      skillId: "imported-1",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["skills", "imported", null],
    });
  });
});
