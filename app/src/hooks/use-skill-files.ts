import { useState, useEffect, useCallback } from "react";
import { useEditorStore } from "@/stores/editor-store";
import { listSkillFiles } from "@/lib/tauri";

export function useSkillFiles(workspacePath: string | null, skillName: string) {
  const [error, setError] = useState<string | null>(null);
  const setFiles = useEditorStore((s) => s.setFiles);
  const setLoading = useEditorStore((s) => s.setLoading);
  const isLoading = useEditorStore((s) => s.isLoading);

  const load = useCallback(async () => {
    if (!workspacePath || !skillName) return;
    setLoading(true);
    setError(null);
    try {
      const files = await listSkillFiles(workspacePath, skillName);
      setFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspacePath, skillName, setFiles, setLoading]);

  useEffect(() => {
    load();
  }, [load]);

  return { isLoading, error, reload: load };
}
