import { describe, it, expect } from "vitest";
import { resolveSkill } from "@/lib/resolve-skill";
import type { SkillSummary, ImportedSkill } from "@/lib/types";

function makeBuilderSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "test-skill",
    library_key: null,
    skill_source: "skill-builder",
    plugin_slug: "default",
    plugin_display_name: "Default",
    is_default_plugin: true,
    status: "completed",
    current_step: null,
    last_modified: null,
    created_at: null,
    purpose: null,
    tags: [],
    intake_json: null,
    ...overrides,
  };
}

function makeImportedSkill(overrides: Partial<ImportedSkill> = {}): ImportedSkill {
  return {
    skill_id: "uuid-1",
    skill_name: "imported-skill",
    library_key: null,
    plugin_slug: "default",
    plugin_display_name: "Default",
    is_default_plugin: true,
    description: null,
    purpose: null,
    version: null,
    user_invocable: null,
    disable_model_invocation: null,
    disk_path: "/some/path",
    imported_at: "2026-01-01T00:00:00Z",
    marketplace_source_url: null,
    ...overrides,
  };
}

describe("resolveSkill", () => {
  it("returns null for falsy skillName", () => {
    expect(resolveSkill(null, [], [])).toBeNull();
    expect(resolveSkill(undefined, [], [])).toBeNull();
    expect(resolveSkill("", [], [])).toBeNull();
  });

  it("finds builder skill by name when library_key is null", () => {
    const skills = [makeBuilderSkill({ name: "sales-skill" })];
    const result = resolveSkill("sales-skill", skills, []);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("sales-skill");
  });

  it("finds builder skill by library_key when it differs from name", () => {
    const skills = [
      makeBuilderSkill({ name: "petstore-sales-v2", library_key: "petstore-sales" }),
    ];
    const result = resolveSkill("petstore-sales", skills, []);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("petstore-sales-v2");
  });

  it("prefers library_key match over name match", () => {
    const skills = [
      makeBuilderSkill({ name: "petstore-sales", library_key: "petstore-sales" }),
    ];
    const result = resolveSkill("petstore-sales", skills, []);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("petstore-sales");
  });

  it("does not match builder skills with wrong skill_source", () => {
    const skills = [
      makeBuilderSkill({ name: "test-skill", skill_source: "marketplace" as never }),
    ];
    expect(resolveSkill("test-skill", skills, [])).toBeNull();
  });

  it("finds imported skill by library_key", () => {
    const skills = [
      makeImportedSkill({ skill_name: "my-import", library_key: "custom-key" }),
    ];
    const result = resolveSkill("custom-key", [], skills);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("my-import");
  });

  it("finds imported skill by generated key when library_key is null", () => {
    const skills = [
      makeImportedSkill({ skill_id: "abc-123", skill_name: "my-import" }),
    ];
    const result = resolveSkill("imported:abc-123", [], skills);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("my-import");
  });

  it("returns null when skill is not found", () => {
    const skills = [makeBuilderSkill({ name: "existing" })];
    expect(resolveSkill("nonexistent", skills, [])).toBeNull();
  });

  it("returns EditableSkill shape for builder skills", () => {
    const skills = [makeBuilderSkill({ name: "test" })];
    const result = resolveSkill("test", skills, []);
    expect(result).toHaveProperty("name", "test");
    expect(result).toHaveProperty("plugin_slug", "default");
  });

  it("returns EditableSkill shape for imported skills", () => {
    const skills = [makeImportedSkill({ skill_name: "imp" })];
    const result = resolveSkill("imported:uuid-1", [], skills);
    expect(result).toHaveProperty("name", "imp");
    expect(result).toHaveProperty("plugin_slug", "default");
  });
});
