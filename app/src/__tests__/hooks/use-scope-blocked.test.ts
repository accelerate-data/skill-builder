import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useScopeBlocked } from "@/hooks/use-scope-blocked";
import type { SkillSummary } from "@/lib/types";

vi.mock("@/lib/tauri", () => ({
  getDisabledSteps: vi.fn(),
}));

import { getDisabledSteps } from "@/lib/tauri";

const mockGetDisabledSteps = getDisabledSteps as ReturnType<typeof vi.fn>;

const skill = { name: "my-skill", current_step: null, status: null, last_modified: null, tags: [], purpose: null, skill_source: null, author_login: null, author_avatar: null, intake_json: null } as unknown as SkillSummary;

describe("useScopeBlocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when selectedSkill is null", () => {
    const { result } = renderHook(() => useScopeBlocked(null));
    expect(result.current).toBe(false);
  });

  it("returns true when getDisabledSteps resolves with non-empty array", async () => {
    mockGetDisabledSteps.mockResolvedValue(["step-1"]);
    const { result } = renderHook(() => useScopeBlocked(skill));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false when getDisabledSteps resolves with empty array", async () => {
    mockGetDisabledSteps.mockResolvedValue([]);
    const { result } = renderHook(() => useScopeBlocked(skill));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("returns false when getDisabledSteps rejects", async () => {
    mockGetDisabledSteps.mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useScopeBlocked(skill));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("updates when selectedSkill changes", async () => {
    mockGetDisabledSteps.mockResolvedValue(["step-1"]);
    const { result, rerender } = renderHook(
      ({ s }: { s: SkillSummary | null }) => useScopeBlocked(s),
      { initialProps: { s: skill } }
    );
    await waitFor(() => expect(result.current).toBe(true));

    mockGetDisabledSteps.mockResolvedValue([]);
    const skill2 = { name: "other-skill", current_step: null, status: null, last_modified: null, tags: [], purpose: null, skill_source: null, author_login: null, author_avatar: null, intake_json: null } as unknown as SkillSummary;
    rerender({ s: skill2 });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
