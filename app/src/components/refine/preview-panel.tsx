import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { ChevronDown, FileText, GitCompare, X } from "lucide-react";
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

const MIN_WIDTH = 360;
const MAX_WIDTH_RATIO = 0.85;
const DEFAULT_WIDTH = 560;

export function PreviewPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const pendingWidthRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

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

  // Tabs: modified files from the diff, or all authored skill files when browsing.
  const fileTabs = useMemo(() => {
    if (gitDiff && gitDiff.files.length > 0) {
      return gitDiff.files
        .map((f) => normalizeDiffPath(f.path))
        .filter((p) => isAuthoredSkillFile(p));
    }
    return skillFiles
      .map((f) => f.filename)
      .filter((f) => isAuthoredSkillFile(f));
  }, [gitDiff, skillFiles]);

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
      const target = e.target as HTMLElement;
      // Skip if clicking the toggle button (it handles open/close itself).
      if (target.closest("[data-file-viewer-toggle]")) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
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

  // Clamp width to container bounds.
  const clampWidth = useCallback((w: number) => {
    const containerWidth = panelRef.current?.parentElement?.clientWidth ?? window.innerWidth;
    const max = Math.floor(containerWidth * MAX_WIDTH_RATIO);
    return Math.min(max, Math.max(MIN_WIDTH, w));
  }, []);

  // Drag-to-resize from left edge.
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent) => {
      const container = panelRef.current?.parentElement;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      pendingWidthRef.current = clampWidth(containerRect.right - e.clientX);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(() => {
          if (pendingWidthRef.current !== null) {
            setWidth(pendingWidthRef.current);
            pendingWidthRef.current = null;
          }
          rafRef.current = null;
        });
      }
    };
    const onMouseUp = () => {
      setDragging(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (pendingWidthRef.current !== null) {
        setWidth(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [dragging, clampWidth]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      data-testid="refine-artifact-dropdown"
      className={`absolute inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-lg animate-in slide-in-from-right-4 duration-200 ${dragging ? "select-none" : ""}`}
      style={{ width: `${width}px`, maxWidth: "85%" }}
    >
      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file viewer"
        tabIndex={0}
        data-testid="refine-file-view-resize-handle"
        className="absolute left-0 top-0 bottom-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors duration-150 hover:bg-primary/30 before:absolute before:-left-1 before:-right-1 before:top-0 before:bottom-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={onResizeStart}
        onKeyDown={(e) => {
          const step = 32;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setWidth((prev) => clampWidth(prev + step));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setWidth((prev) => clampWidth(prev - step));
          }
        }}
      />
      {/* Header with tabs + controls */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          {fileTabs.length > 1 ? (
            <div className="relative">
              <select
                data-testid="refine-file-view-title"
                value={activeFileTab}
                onChange={(e) => {
                  setActiveFileTab(e.target.value);
                  setSelectedModifiedFile(e.target.value);
                }}
                className="appearance-none bg-transparent pr-5 text-sm font-medium outline-none cursor-pointer"
              >
                {fileTabs.map((tab) => (
                  <option key={tab} value={tab}>{tab}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          ) : (
            <span data-testid="refine-file-view-title" className="text-sm font-medium">
              {selectedModifiedFile ?? activeFileTab}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {hasDiff && (
            <Button
              data-testid="refine-diff-toggle"
              variant="ghost"
              size="xs"
              onClick={() => setDiffMode(!diffMode)}
              className="gap-1"
            >
              <GitCompare className="size-3" />
              {diffMode ? "Preview" : "Diff"}
            </Button>
          )}
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
