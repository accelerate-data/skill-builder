import { describe, it, expect } from "vitest";
import { resolveSkill } from "@/lib/resolve-skill";
import type { SkillSummary, ImportedSkill } from "@/lib/types";

function makeBuilderSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: 1,
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
    skill_id: 101,
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
  it("returns null for falsy skillId", () => {
    expect(resolveSkill(null, [], [])).toBeNull();
    expect(resolveSkill(undefined, [], [])).toBeNull();
    expect(resolveSkill("", [], [])).toBeNull();
  });

  it("finds builder skill by id", () => {
    const skills = [makeBuilderSkill({ id: 42, name: "sales-skill" })];
    const result = resolveSkill("42", skills, []);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("sales-skill");
  });

  it("finds builder skill by id even when library_key differs from name", () => {
    const skills = [
      makeBuilderSkill({ id: 77, name: "petstore-sales-v2", library_key: "petstore-sales" }),
    ];
    const result = resolveSkill("77", skills, []);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("petstore-sales-v2");
  });

  it("prefers exact id match", () => {
    const skills = [
      makeBuilderSkill({ id: 99, name: "petstore-sales", library_key: "petstore-sales" }),
    ];
    const result = resolveSkill("99", skills, []);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("petstore-sales");
  });

  it("does not match builder skills with wrong skill_source", () => {
    const skills = [
      makeBuilderSkill({ name: "test-skill", skill_source: "marketplace" as never }),
    ];
    expect(resolveSkill("1", skills, [])).toBeNull();
  });

  it("finds imported skill by skill_id", () => {
    const skills = [
      makeImportedSkill({ skill_name: "my-import", library_key: "custom-key" }),
    ];
    const result = resolveSkill("101", [], skills);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("my-import");
  });

  it("finds imported skill by skill_id when library_key is null", () => {
    const skills = [
      makeImportedSkill({ skill_id: 123, skill_name: "my-import" }),
    ];
    const result = resolveSkill("123", [], skills);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("my-import");
  });

  it("returns null when skill is not found", () => {
    const skills = [makeBuilderSkill({ name: "existing" })];
    expect(resolveSkill("404", skills, [])).toBeNull();
  });

  it("returns EditableSkill shape for builder skills", () => {
    const skills = [makeBuilderSkill({ id: 5, name: "test" })];
    const result = resolveSkill("5", skills, []);
    expect(result).toHaveProperty("name", "test");
    expect(result).toHaveProperty("plugin_slug", "default");
  });

  it("returns EditableSkill shape for imported skills", () => {
    const skills = [makeImportedSkill({ skill_name: "imp" })];
    const result = resolveSkill("101", [], skills);
    expect(result).toHaveProperty("name", "imp");
    expect(result).toHaveProperty("plugin_slug", "default");
    expect(result).toHaveProperty("id", 101);
  });
});
