import { beforeEach, describe, expect, it } from "vitest";
import { useUsageStore } from "@/stores/usage-store";

describe("useUsageStore", () => {
  beforeEach(() => {
    useUsageStore.setState({
      hideCancelled: false,
      dateRange: "all",
      skillFilter: null,
      modelFamilyFilter: null,
    });
  });

  it("stores usage filter UI state", () => {
    useUsageStore.getState().setDateRange("30d");
    useUsageStore.getState().setSkillFilter("skill-a");
    useUsageStore.getState().setModelFamilyFilter("sonnet");
    useUsageStore.getState().toggleHideCancelled();

    expect(useUsageStore.getState()).toMatchObject({
      dateRange: "30d",
      skillFilter: "skill-a",
      modelFamilyFilter: "sonnet",
      hideCancelled: true,
    });
  });

  it("resets data filters after usage reset", () => {
    useUsageStore.setState({ skillFilter: "skill-a", modelFamilyFilter: "haiku" });
    useUsageStore.getState().resetFilters();

    expect(useUsageStore.getState().skillFilter).toBeNull();
    expect(useUsageStore.getState().modelFamilyFilter).toBeNull();
  });
});
