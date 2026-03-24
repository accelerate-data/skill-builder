import { useMemo } from "react";
import type { SkillSummary, ImportedSkill } from "@/lib/types";

export interface UnifiedSkill {
  key: string;
  name: string;
  description: string | null;
  purpose: string | null;
  lastModified: Date | null;
  createdAt: Date | null;
  source: "builder" | "imported" | "marketplace";
  pluginSlug: string;
  pluginDisplayName: string;
  isDefaultPlugin: boolean;
  importedSkillId: string | null;
  status: string | null;
  currentStep: string | null;
}

export interface DotStyle {
  className: string;
  style?: React.CSSProperties;
}

export interface SkillMenuState {
  isBuilder: boolean;
  isComplete: boolean;
  showsLifecycleActions: boolean;
}

export function isSkillComplete(skill: UnifiedSkill): boolean {
  return skill.status === "completed";
}

export function getStatusDot(skill: UnifiedSkill, isRunning: boolean): DotStyle {
  const pulse = isRunning ? " animate-dot-pulse" : "";

  if (skill.source === "marketplace") {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-pacific)" } };
  }

  if (skill.source === "imported") {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-violet)" } };
  }

  // Completed builder skill -> seafoam
  if (isSkillComplete(skill)) {
    return { className: pulse.trim(), style: { backgroundColor: "var(--color-seafoam)" } };
  }

  const stepMatch = skill.currentStep?.match(/step\s*(\d+)/i);
  const step = stepMatch ? Number(stepMatch[1]) : null;

  // Step 1+ (step 1+ in 0-indexed, i.e. past Research) -> amber
  if (step !== null && step >= 1) {
    return { className: `bg-amber-500 dark:bg-amber-400${pulse}` };
  }

  // Never started or on Step 1 (step 0 in 0-indexed) -> red
  return { className: `bg-destructive${pulse}` };
}

export function mergeSkills(
  builderSkills: SkillSummary[],
  importedSkills: ImportedSkill[],
): UnifiedSkill[] {
  const fromBuilder: UnifiedSkill[] = builderSkills
    .filter((s) => s.skill_source === "skill-builder")
    .map((s) => ({
      key: s.library_key ?? s.name,
      name: s.name,
      description: s.description ?? null,
      purpose: s.purpose,
      lastModified: s.last_modified ? new Date(s.last_modified) : null,
      createdAt: s.created_at ? new Date(s.created_at) : null,
      source: "builder" as const,
      pluginSlug: s.plugin_slug,
      pluginDisplayName: s.plugin_display_name,
      isDefaultPlugin: s.is_default_plugin,
      importedSkillId: null,
      status: s.status,
      currentStep: s.current_step,
    }));

  const fromImported: UnifiedSkill[] = importedSkills.map((s) => ({
    key: s.library_key ?? `imported:${s.skill_id}`,
    name: s.skill_name,
    description: s.description,
    purpose: s.purpose,
    lastModified: new Date(s.imported_at),
    createdAt: new Date(s.imported_at),
    source: s.marketplace_source_url ? ("marketplace" as const) : ("imported" as const),
    pluginSlug: s.plugin_slug,
    pluginDisplayName: s.plugin_display_name,
    isDefaultPlugin: s.is_default_plugin,
    importedSkillId: s.skill_id,
    status: null,
    currentStep: null,
  }));

  // Sort by plugin slug (groups skills by plugin), then by creation date descending within each plugin
  return [...fromBuilder, ...fromImported].sort((a, b) => {
    if (a.pluginSlug !== b.pluginSlug) {
      if (a.isDefaultPlugin !== b.isDefaultPlugin) return a.isDefaultPlugin ? -1 : 1;
      return a.pluginSlug.localeCompare(b.pluginSlug);
    }
    const at = a.createdAt?.getTime() ?? 0;
    const bt = b.createdAt?.getTime() ?? 0;
    return bt - at;
  });
}

export function getSkillMenuState(skill: UnifiedSkill): SkillMenuState {
  return {
    isBuilder: skill.source === "builder",
    isComplete: isSkillComplete(skill) || skill.source !== "builder",
    showsLifecycleActions: isSkillComplete(skill) || skill.source !== "builder",
  };
}

export function useUnifiedSkills(
  builderSkills: SkillSummary[],
  importedSkills: ImportedSkill[],
): UnifiedSkill[] {
  return useMemo(
    () => mergeSkills(builderSkills, importedSkills),
    [builderSkills, importedSkills],
  );
}
