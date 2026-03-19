import { useState, useEffect } from "react";
import {
  readFile,
  listSkillFiles,
  getContextFileContent,
} from "@/lib/tauri";
import { joinPath } from "@/lib/path-utils";

/**
 * Load and resolve output file contents for a completed workflow step.
 * Expands directory paths (ending with "/") into individual files.
 */
export function useStepFiles(
  skillName: string | undefined,
  workspacePath: string | undefined,
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

      if (dirPaths.length > 0 && skillsPath) {
        try {
          const allEntries = await listSkillFiles(skillsPath, skillName);
          console.log(`[step-complete] listSkillFiles returned ${allEntries.length} entries for ${skillName}`);
          for (const dir of dirPaths) {
            const diskPrefix = dir.startsWith("skill/") ? dir.slice("skill/".length) : dir;
            for (const entry of allEntries) {
              if (!entry.is_directory && entry.relative_path.startsWith(diskPrefix)) {
                expandedFiles.push(`skill/${entry.relative_path}`);
              }
            }
          }
        } catch (err) {
          console.error("[step-complete] Failed to expand directory paths:", err);
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

          if (relativePath.startsWith("context/") && workspacePath) {
            try {
              content = await getContextFileContent(
                skillName,
                workspacePath,
                relativePath.slice("context/".length),
              );
            } catch {
              // not found in workspace context
            }
          } else if (skillsPath) {
            try {
              content = await readFile(joinPath(skillsPath, skillName, skillsRelative));
            } catch {
              // not found in skills path
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
  }, [skillName, workspacePath, skillsPath, outputFiles]);

  return { fileContents, resolvedFiles, selectedFile, setSelectedFile, loadingFiles };
}
