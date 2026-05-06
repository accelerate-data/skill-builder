import { useState, useEffect } from "react";
import {
  readFile,
  listSkillFiles,
} from "@/lib/tauri";

/**
 * Load and resolve output file contents for a completed workflow step.
 * Expands directory paths (ending with "/") into individual files.
 */
export function useStepFiles(
  skillName: string | undefined,
  pluginSlug: string | undefined,
  skillsPath: string | null | undefined,
  outputFiles: string[],
) {
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  const [resolvedFiles, setResolvedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => {
    if (!skillName || outputFiles.length === 0) {
      setFileContents(new Map());
      setResolvedFiles([]);
      setSelectedFile(null);
      return;
    }

    let cancelled = false;
    setLoadingFiles(true);

    (async () => {
      const expandedFiles: string[] = [];
      const dirPaths = outputFiles.filter((f) => f.endsWith("/"));
      const filePaths = outputFiles.filter((f) => !f.endsWith("/"));
      expandedFiles.push(...filePaths);

      // Fetch the skill's file listing whenever skillsPath is set. This serves
      // two purposes: (1) directory expansion, (2) absolute-path resolution so
      // that readFile uses paths that include the plugin-slug directory component
      // (e.g. skills_root/skills/skill-name/) rather than a manually-joined path
      // that omits the plugin slug.
      const absPathMap = new Map<string, string>(); // relative_path → absolute_path
      if (skillsPath) {
        try {
          const allEntries = await listSkillFiles(skillsPath, skillName, pluginSlug);
          console.log(`[step-complete] listSkillFiles returned ${allEntries.length} entries for ${skillName}`);
          for (const entry of allEntries) {
            if (!entry.is_directory) {
              absPathMap.set(entry.relative_path, entry.absolute_path);
            }
          }
          for (const dir of dirPaths) {
            const diskPrefix = dir.startsWith("skill/") ? dir.slice("skill/".length) : dir;
            for (const [relPath] of absPathMap) {
              if (relPath.startsWith(diskPrefix)) {
                expandedFiles.push(`skill/${relPath}`);
              }
            }
          }
        } catch (err) {
          console.error("[step-complete] Failed to list skill files:", err);
          if (dirPaths.length > 0) {
            console.warn("[step-complete] Cannot expand directories: listSkillFiles failed");
          }
        }
      } else if (dirPaths.length > 0) {
        console.warn("[step-complete] Cannot expand directories: skillsPath is not set");
      }

      const results = new Map<string, string>();

      await Promise.all(
        expandedFiles.map(async (relativePath) => {
          let content: string | null = null;
          const skillsRelative = relativePath.startsWith("skill/")
            ? relativePath.slice("skill/".length)
            : relativePath;

          // Use the absolute path from the listing (correct plugin-slug layout).
          // Fall back to a direct readFile only if the listing didn't include this file.
          const absPath = absPathMap.get(skillsRelative);
          if (absPath) {
            try {
              content = await readFile(absPath);
            } catch {
              // not found at absolute path
            }
          }

          results.set(relativePath, content ?? "__NOT_FOUND__");
        })
      );

      if (!cancelled) {
        console.log(`[step-complete] Resolved ${expandedFiles.length} files:`, expandedFiles);
        setFileContents(new Map(results));
        setResolvedFiles(expandedFiles);
        setSelectedFile(expandedFiles[0] ?? null);
        setLoadingFiles(false);
      }
    })();

    return () => { cancelled = true; };
  }, [skillName, pluginSlug, skillsPath, outputFiles]);

  return { fileContents, resolvedFiles, selectedFile, setSelectedFile, loadingFiles };
}
