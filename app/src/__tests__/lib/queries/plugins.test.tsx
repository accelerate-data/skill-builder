import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryPlugin } from "@/lib/types";
import { createTestQueryClient } from "@/test/query-test-utils";

const mocks = vi.hoisted(() => ({
  listPlugins: vi.fn(),
  createPluginFromSkills: vi.fn(),
  deletePlugin: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  listPlugins: mocks.listPlugins,
  createPluginFromSkills: mocks.createPluginFromSkills,
  deletePlugin: mocks.deletePlugin,
}));

import {
  useCreatePluginMutation,
  useDeletePluginMutation,
  usePluginsQuery,
} from "@/lib/queries/plugins";

function wrapper() {
  const queryClient = createTestQueryClient();
  return {
    queryClient,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

const plugin: LibraryPlugin = {
  id: 1,
  slug: "analytics",
  display_name: "Analytics",
  version: null,
  source_type: "local",
  source_url: null,
  is_default: false,
  upgrade_locked: false,
};

describe("plugin query hooks", () => {
  beforeEach(() => {
    mocks.listPlugins.mockReset();
    mocks.createPluginFromSkills.mockReset();
    mocks.deletePlugin.mockReset();
  });

  it("loads plugins", async () => {
    mocks.listPlugins.mockResolvedValue([plugin]);
    const { Wrapper } = wrapper();

    const { result } = renderHook(() => usePluginsQuery(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.data).toEqual([plugin]));
  });

  it("invalidates plugins after create or delete mutations", async () => {
    mocks.createPluginFromSkills.mockResolvedValue("analytics");
    mocks.deletePlugin.mockResolvedValue(undefined);
    const { Wrapper, queryClient } = wrapper();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const create = renderHook(() => useCreatePluginMutation(), { wrapper: Wrapper });
    create.result.current.mutate({ pluginName: "Analytics", skillKeys: ["skill-builder:default:one"] });
    await waitFor(() => expect(create.result.current.isSuccess).toBe(true));

    const remove = renderHook(() => useDeletePluginMutation(), { wrapper: Wrapper });
    remove.result.current.mutate("analytics");
    await waitFor(() => expect(remove.result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });
});
