import { useCallback, useEffect } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FileTree } from "@/components/editor/file-tree";
import { CodeEditor } from "@/components/editor/code-editor";
import { PreviewPane } from "@/components/editor/preview-pane";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSkillFiles } from "@/hooks/use-skill-files";
import { useAutoSave } from "@/hooks/use-auto-save";
import { readFile, saveRawFile } from "@/lib/tauri";
import type { FileEntry } from "@/lib/types";

export default function EditorPage() {
  const { skillName } = useParams({ strict: false }) as { skillName: string };
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  const {
    files,
    activeFile,
    activeFileContent,
    isDirty,
    isLoading,
    isSaving,
    setActiveFile,
    setActiveFileContent,
    setOriginalContent,
    setLoading,
    setSaving,
    markSaved,
    reset,
  } = useEditorStore();

  useSkillFiles(workspacePath, skillName);
  useAutoSave();

  // Cleanup on unmount
  useEffect(() => {
    return () => reset();
  }, [reset]);

  const handleFileSelect = useCallback(
    async (file: FileEntry) => {
      if (file.is_directory) return;

      // Save current file before switching if dirty
      const store = useEditorStore.getState();
      if (store.isDirty && store.activeFile && !store.activeFile.is_readonly) {
        try {
          await saveRawFile(store.activeFile.absolute_path, store.activeFileContent);
          markSaved();
        } catch {
          // Continue switching even if save fails
        }
      }

      setLoading(true);
      setActiveFile(file);
      try {
        const content = await readFile(file.absolute_path);
        setOriginalContent(content);
      } catch (err) {
        toast.error(`Failed to load file: ${err instanceof Error ? err.message : String(err)}`);
        setOriginalContent("");
      } finally {
        setLoading(false);
      }
    },
    [setActiveFile, setOriginalContent, setLoading, markSaved]
  );

  const handleManualSave = useCallback(async () => {
    if (!activeFile || activeFile.is_readonly || !isDirty) return;
    setSaving(true);
    try {
      await saveRawFile(activeFile.absolute_path, activeFileContent);
      markSaved();
      toast.success("Saved");
    } catch (err) {
      setSaving(false);
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [activeFile, isDirty, activeFileContent, setSaving, markSaved]);

  return (
    <div className="flex h-full flex-col -m-6">
      {/* Header toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <Link to="/skill/$skillName" params={{ skillName }}>
            <Button variant="ghost" size="icon-sm">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <span className="text-sm font-medium">{skillName}</span>
          {activeFile && (
            <>
              <span className="text-muted-foreground">/</span>
              <span className="text-sm">{activeFile.relative_path}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeFile?.is_readonly && (
            <Badge variant="secondary" className="text-xs">Read-only</Badge>
          )}
          {isDirty && (
            <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600 dark:text-amber-400">
              Unsaved
            </Badge>
          )}
          {isSaving && (
            <Badge variant="outline" className="text-xs gap-1">
              <Loader2 className="size-3 animate-spin" />
              Saving
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualSave}
            disabled={!isDirty || !activeFile || activeFile.is_readonly || isSaving}
          >
            <Save className="size-3.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Three-pane layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree */}
        <div className="w-60 shrink-0 border-r bg-muted/30">
          <FileTree
            files={files.filter((f) => !f.is_directory)}
            activeFilePath={activeFile?.absolute_path ?? null}
            onFileSelect={handleFileSelect}
          />
        </div>

        {/* Code editor */}
        <div className="flex-1 overflow-hidden border-r">
          {isLoading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : activeFile ? (
            <CodeEditor
              content={activeFileContent}
              onChange={setActiveFileContent}
              readonly={activeFile.is_readonly}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a file to edit
            </div>
          )}
        </div>

        {/* Preview pane */}
        <div className="flex-1 overflow-hidden">
          <PreviewPane content={activeFileContent} />
        </div>
      </div>
    </div>
  );
}
