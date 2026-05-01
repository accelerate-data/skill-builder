import { describe, expect, it } from "vitest";
import { createAppQueryClient } from "@/lib/query-client";

describe("query client defaults", () => {
  it("keeps backend data fresh briefly without refetching on focus", () => {
    const client = createAppQueryClient();
    const defaults = client.getDefaultOptions();

    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.mutations?.retry).toBe(0);
  });
});
