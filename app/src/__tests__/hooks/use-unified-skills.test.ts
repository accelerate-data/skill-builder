import { renderHook } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import {
  isSkillComplete,
  getStatusDot,
  mergeSkills,
  getSkillMenuState,
  useUnifiedSkills,
} from "@/hooks/use-unified-skills";
import type { SkillSummary, ImportedSkill } from "@/lib/types";

// Mock skill data for testing
const mockBuilderSkill: SkillSummary = {
  id: "123",
  name: "test-skill",
  description: "A test skill",
  purpose: "testing",
  skill_source: "skill-builder",
  last_modified: "2024-01-15T10:00:00Z",
  created_at: "2024-01-01T10:00:00Z",
  plugin_slug: "default",
  plugin_display_name: "Default Plugin",
  is_default_plugin: true,
  status: "completed",
  current_step: null,
};

const mockImportedSkill: ImportedSkill = {
  skill_id: "456",
  skill_name: "imported-skill",
  description: "An imported skill",
  purpose: "imported purposes",
  plugin_slug: "marketplace",
  plugin_display_name: "Marketplace",
  is_default_plugin: false,
  marketplace_source_url: "https://marketplace.example.com/skills/imported-skill",
  imported_at: "2024-02-01T10:00:00Z",
};

const mockBuilderSkillInProgress: SkillSummary = {
  ...mockBuilderSkill,
  id: "789",
  name: "in-progress-skill",
  status: "in-progress",
  current_step: "step 1",
};

const mockBuilderSkillNotStarted: SkillSummary = {
  ...mockBuilderSkill,
  id: "999",
  name: "not-started-skill",
  status: null,
  current_step: null,
};

describe("isSkillComplete", () => {
  it("returns true when status is 'completed'", () => {
    const skill = { ...mockBuilderSkill, status: "completed" };
    expect(isSkillComplete(skill as any)).toBe(true);
  });

  it("returns false when status is not 'completed'", () => {
    const skill = { ...mockBuilderSkill, status: "in-progress" };
    expect(isSkillComplete(skill as any)).toBe(false);
  });

  it("returns false when status is null", () => {
    const skill = { ...mockBuilderSkill, status: null };
    expect(isSkillComplete(skill as any)).toBe(false);
  });
});

describe("getStatusDot", () => {
  it("returns correct dot for marketplace skills", () => {
    const marketplaceSkill = {
      ...mockBuilderSkill,
      source: "marketplace" as const,
      status: null,
      currentStep: null,
    };
    const result = getStatusDot(marketplaceSkill as any, false);
    expect(result.className).toBe("");
    expect(result.style?.backgroundColor).toBe("var(--color-pacific)");
  });

  it("returns correct dot for imported skills", () => {
    const importedSkill = {
      ...mockBuilderSkill,
      source: "imported" as const,
      status: null,
      currentStep: null,
    };
    const result = getStatusDot(importedSkill as any, false);
    expect(result.className).toBe("");
    expect(result.style?.backgroundColor).toBe("var(--color-violet)");
  });

  it("returns seafoam for completed builder skills", () => {
    const completedSkill = {
      ...mockBuilderSkill,
      source: "builder" as const,
      status: "completed",
      currentStep: null,
    };
    const result = getStatusDot(completedSkill as any, false);
    expect(result.className).toBe("");
    expect(result.style?.backgroundColor).toBe("var(--color-seafoam)");
  });

  it("returns amber for skills on step 1 or higher", () => {
    const step1Skill = {
      ...mockBuilderSkill,
      source: "builder" as const,
      status: null,
      currentStep: "step 1",
    };
    const result = getStatusDot(step1Skill as any, false);
    expect(result.className).toContain("bg-amber-500");
  });

  it("returns red for skills not started", () => {
    const notStartedSkill = {
      ...mockBuilderSkill,
      source: "builder" as const,
      status: null,
      currentStep: null,
    };
    const result = getStatusDot(notStartedSkill as any, false);
    expect(result.className).toContain("bg-destructive");
  });

  it("adds pulse class when isRunning is true", () => {
    const skill = {
      ...mockBuilderSkill,
      source: "builder" as const,
      status: null,
      currentStep: null,
    };
    const result = getStatusDot(skill as any, true);
    expect(result.className).toContain("animate-dot-pulse");
  });
});

describe("mergeSkills", () => {
  it("returns empty array when both inputs are empty", () => {
    const result = mergeSkills([], []);
    expect(result).toHaveLength(0);
  });

  it("maps builder skills correctly", () => {
    const result = mergeSkills([mockBuilderSkill], []);
    expect(result).toHaveLength(1);
    expect(result[0].skillId).toBe("123");
    expect(result[0].name).toBe("test-skill");
    expect(result[0].source).toBe("builder");
    expect(result[0].isDefaultPlugin).toBe(true);
  });

  it("maps imported skills correctly", () => {
    const result = mergeSkills([], [mockImportedSkill]);
    expect(result).toHaveLength(1);
    expect(result[0].skillId).toBe("456");
    expect(result[0].name).toBe("imported-skill");
    expect(result[0].source).toBe("marketplace");
    expect(result[0].importedSkillId).toBe("456");
  });

  it("maps imported skills without marketplace URL as 'imported'", () => {
    const localImportedSkill: ImportedSkill = {
      ...mockImportedSkill,
      marketplace_source_url: null,
    };
    const result = mergeSkills([], [localImportedSkill]);
    expect(result[0].source).toBe("imported");
  });

  it("combines both builder and imported skills", () => {
    const result = mergeSkills([mockBuilderSkill], [mockImportedSkill]);
    expect(result).toHaveLength(2);
  });

  it("sorts by plugin slug, then by creation date descending", () => {
    const defaultSkill: SkillSummary = {
      ...mockBuilderSkill,
      id: "1",
      name: "default-skill",
      created_at: "2024-01-01T10:00:00Z",
      plugin_slug: "default",
      is_default_plugin: true,
    };
    const otherSkill: SkillSummary = {
      ...mockBuilderSkill,
      id: "2",
      name: "other-skill",
      created_at: "2024-02-01T10:00:00Z",
      plugin_slug: "other",
      is_default_plugin: false,
    };
    const result = mergeSkills([otherSkill, defaultSkill], []);
    // Default plugin should come first
    expect(result[0].pluginSlug).toBe("default");
  });
});

describe("getSkillMenuState", () => {
  it("returns correct state for builder skill not complete", () => {
    const builderSkill = {
      skillId: "1",
      key: "1",
      name: "test",
      description: "test",
      purpose: "test",
      lastModified: null,
      createdAt: null,
      source: "builder" as const,
      pluginSlug: "default",
      pluginDisplayName: "Default",
      isDefaultPlugin: true,
      importedSkillId: null,
      status: "in-progress",
      currentStep: "step 1",
    };
    const result = getSkillMenuState(builderSkill as any);
    expect(result.isBuilder).toBe(true);
    expect(result.isComplete).toBe(false);
    expect(result.showsLifecycleActions).toBe(false);
  });

  it("returns correct state for completed builder skill", () => {
    const completedSkill = {
      ...mockBuilderSkill,
      source: "builder" as const,
      status: "completed",
    };
    const result = getSkillMenuState(completedSkill as any);
    expect(result.isBuilder).toBe(true);
    expect(result.isComplete).toBe(true);
    expect(result.showsLifecycleActions).toBe(true);
  });

  it("returns correct state for imported skill", () => {
    const importedSkill = {
      skillId: "1",
      key: "1",
      name: "test",
      description: "test",
      purpose: "test",
      lastModified: null,
      createdAt: null,
      source: "imported" as const,
      pluginSlug: "default",
      pluginDisplayName: "Default",
      isDefaultPlugin: true,
      importedSkillId: "1",
      status: null,
      currentStep: null,
    };
    const result = getSkillMenuState(importedSkill as any);
    expect(result.isBuilder).toBe(false);
    expect(result.isComplete).toBe(true);
    expect(result.showsLifecycleActions).toBe(true);
  });

  it("returns correct state for marketplace skill", () => {
    const marketplaceSkill = {
      skillId: "1",
      key: "1",
      name: "test",
      description: "test",
      purpose: "test",
      lastModified: null,
      createdAt: null,
      source: "marketplace" as const,
      pluginSlug: "default",
      pluginDisplayName: "Default",
      isDefaultPlugin: true,
      importedSkillId: "1",
      status: null,
      currentStep: null,
    };
    const result = getSkillMenuState(marketplaceSkill as any);
    expect(result.isBuilder).toBe(false);
    expect(result.isComplete).toBe(true);
    expect(result.showsLifecycleActions).toBe(true);
  });
});

describe("useUnifiedSkills", () => {
  it("returns merged skills", () => {
    const { result } = renderHook(() =>
      useUnifiedSkills([mockBuilderSkill], [mockImportedSkill]),
    );
    expect(result.current).toHaveLength(2);
  });

  it("memoizes skills based on dependencies", () => {
    const { result, rerender } = renderHook(
      ({ builder, imported }) => useUnifiedSkills(builder, imported),
      {
        initialProps: {
          builder: [mockBuilderSkill],
          imported: [mockImportedSkill],
        },
      },
    );
    const firstResult = result.current;

    // Rerender with same props - memoization should return same reference
    rerender({ builder: [mockBuilderSkill], imported: [mockImportedSkill] });
    expect(result.current).toStrictEqual(firstResult);
  });
});