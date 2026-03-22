import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { FileText, GitCompare, X } from "lucide-react";
import { markdownComponents } from "@/components/markdown-link";
import { SkillFrontmatterHeader } from "@/components/skill-frontmatter-header";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { isSkillFile, parseFrontmatter } from "@/lib/frontmatter";
import { normalizeDiffPath } from "@/lib/path-utils";
import { useRefineStore, isAuthoredSkillFile } from "@/stores/refine-store";
import { GitPatchView } from "./git-patch-view";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight, rehypeSanitize];

const MarkdownPreview = memo(function MarkdownPreview({ content, filename }: { content: string; filename: string }) {
  const parsed = useMemo(() => {
    if (isSkillFile(filename)) return parseFrontmatter(content);
    return { frontmatter: null, body: content };
  }, [content, filename]);

  return (
    <>
      {parsed.frontmatter && <SkillFrontmatterHeader frontmatter={parsed.frontmatter} />}
      <div className="markdown-body compact max-w-none overflow-hidden break-words p-4 pb-8 [&_*]:break-words">
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={markdownComponents}>
          {parsed.body}
        </ReactMarkdown>
      </div>
    </>
  );
});

export function PreviewPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const skillFiles = useRefineStore((s) => s.skillFiles);
  const activeFileTab = useRefineStore((s) => s.activeFileTab);
  const selectedModifiedFile = useRefineStore((s) => s.selectedModifiedFile);
  const diffMode = useRefineStore((s) => s.diffMode);
  const gitDiff = useRefineStore((s) => s.gitDiff);
  const isLoadingFiles = useRefineStore((s) => s.isLoadingFiles);
  const setDiffMode = useRefineStore((s) => s.setDiffMode);
  const setActiveFileTab = useRefineStore((s) => s.setActiveFileTab);
  const setSelectedModifiedFile = useRefineStore((s) => s.setSelectedModifiedFile);

  const isOpen = !!selectedModifiedFile;

  // Tabs: all modified authored files from the current diff.
  const modifiedTabs = useMemo(() => {
    if (!gitDiff) return [];
    return gitDiff.files
      .map((f) => normalizeDiffPath(f.path))
      .filter((p) => isAuthoredSkillFile(p));
  }, [gitDiff]);

  const activeFile = skillFiles.find((f) => f.filename === activeFileTab);
  const gitDiffFile = gitDiff?.files.find((file) => normalizeDiffPath(file.path) === activeFileTab);
  const hasDiff = !!gitDiffFile;

  const close = useCallback(() => {
    setSelectedModifiedFile(null);
  }, [setSelectedModifiedFile]);

  // Escape to close.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  // Click outside to close.
  useEffect(() => {
    if (!isOpen) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        close();
      }
    };
    // Use setTimeout to avoid closing immediately from the pill click itself.
    const id = setTimeout(() => {
      document.addEventListener("mousedown", onClick);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", onClick);
    };
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      data-testid="refine-artifact-dropdown"
      className="absolute inset-y-0 right-0 z-40 flex w-[min(560px,85%)] flex-col border-l bg-background shadow-lg animate-in slide-in-from-right-4 duration-200"
    >
      {/* Header with tabs + controls */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {modifiedTabs.length > 1 ? (
            modifiedTabs.map((tab) => (
              <Button
                key={tab}
                type="button"
                size="xs"
                variant={activeFileTab === tab ? "secondary" : "ghost"}
                className="shrink-0 gap-1 text-xs"
                onClick={() => {
                  setActiveFileTab(tab);
                  setSelectedModifiedFile(tab);
                }}
              >
                <FileText className="size-3" />
                {tab}
              </Button>
            ))
          ) : (
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <FileText className="size-3.5 text-muted-foreground" />
              <span data-testid="refine-file-view-title">{selectedModifiedFile ?? activeFileTab}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            data-testid="refine-diff-toggle"
            variant="ghost"
            size="xs"
            disabled={!hasDiff}
            onClick={() => setDiffMode(!diffMode)}
            className="gap-1"
          >
            <GitCompare className="size-3" />
            {diffMode ? "Preview" : "Diff"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-testid="refine-file-view-close"
            onClick={close}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      {/* Content */}
      <div data-testid="refine-file-view" className="min-h-0 flex-1">
        {isLoadingFiles ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : diffMode && gitDiffFile ? (
          <GitPatchView patch={gitDiffFile.diff} />
        ) : diffMode ? (
          <div data-testid="git-patch-empty" className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No git diff is available for this file.
          </div>
        ) : activeFile ? (
          <ScrollArea className="h-full">
            <MarkdownPreview content={activeFile.content} filename={activeFile.filename} />
          </ScrollArea>
        ) : (
          <div data-testid="refine-preview-missing-file" className="flex h-full items-center justify-center text-sm text-muted-foreground">
            This file is only available in the git diff.
          </div>
        )}
      </div>
    </div>
  );
}
