import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { saveRawFile } from "@/lib/tauri";

export function useAutoSave() {
  const activeFile = useEditorStore((s) => s.activeFile);
  const activeFileContent = useEditorStore((s) => s.activeFileContent);
  const isDirty = useEditorStore((s) => s.isDirty);
  const setSaving = useEditorStore((s) => s.setSaving);
  const markSaved = useEditorStore((s) => s.markSaved);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isDirty || !activeFile || activeFile.is_readonly) return;

    timerRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await saveRawFile(activeFile.absolute_path, activeFileContent);
        markSaved();
        toast.success("Saved");
      } catch (err) {
        setSaving(false);
        toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 1500);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [activeFileContent, isDirty, activeFile, setSaving, markSaved]);
}
