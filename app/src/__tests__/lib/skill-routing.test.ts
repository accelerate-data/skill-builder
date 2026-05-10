import { describe, it, expect } from "vitest";
import { getSkillSurface } from "@/lib/skill-routing";

describe("getSkillSurface", () => {
  it("returns workflow for a builder skill with status null", () => {
    expect(getSkillSurface({ skill_source: "skill-builder", status: null })).toBe("workflow");
  });

  it("returns workflow for a builder skill with status pending", () => {
    expect(getSkillSurface({ skill_source: "skill-builder", status: "pending" })).toBe("workflow");
  });

  it("returns workflow for a builder skill with status in_progress", () => {
    expect(getSkillSurface({ skill_source: "skill-builder", status: "in_progress" })).toBe("workflow");
  });

  it("returns workspace for a builder skill with status completed", () => {
    expect(getSkillSurface({ skill_source: "skill-builder", status: "completed" })).toBe("workspace");
  });

  it("returns workspace for a skill with skill_source marketplace", () => {
    expect(getSkillSurface({ skill_source: "marketplace", status: "completed" })).toBe("workspace");
  });

  it("returns workspace for an ImportedSkill (no skill_source field)", () => {
    expect(getSkillSurface({ skill_id: 1, skill_name: "test", library_key: null, description: null, is_active: true, disk_path: "", imported_at: "", is_bundled: false, purpose: null, version: null, user_invocable: null, disable_model_invocation: null, marketplace_source_url: null, plugin_slug: "skills", plugin_display_name: "Skills", is_default_plugin: true })).toBe("workspace");
  });

  it("returns workspace when skill_source is null", () => {
    expect(getSkillSurface({ skill_source: null, status: "pending" })).toBe("workspace");
  });
});
