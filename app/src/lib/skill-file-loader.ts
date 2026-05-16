import { getSelectedSkillContent, getSkillContentAtPath } from "@/lib/tauri";
import type { SkillFile } from "@/stores/workspace-store";

export interface SkillFileSource {
  type: "builder";
  skillName: string;
  workspacePath: string;
  pluginSlug: string;
}

export interface ImportedSkillFileSource {
  type: "imported";
  diskPath: string;
}

/** Load skill files from disk, returning null on failure. */
export async function loadSkillFiles(
  source: SkillFileSource | ImportedSkillFileSource,
): Promise<SkillFile[] | null> {
  try {
    let contents: Awaited<ReturnType<typeof getSelectedSkillContent>>;
    if (source.type === "builder") {
      contents = await getSelectedSkillContent(
        source.skillName,
        source.workspacePath,
        source.pluginSlug,
      );
    } else {
      contents = await getSkillContentAtPath(source.diskPath);
    }
    return contents
      .map((c): SkillFile => ({ filename: c.path, content: c.content }))
      .sort((a, b) => {
        if (a.filename === "SKILL.md") return -1;
        if (b.filename === "SKILL.md") return 1;
        return a.filename.localeCompare(b.filename);
      });
  } catch (err) {
    console.error("[skill-file-loader] Failed to load skill files:", err);
    return null;
  }
}
