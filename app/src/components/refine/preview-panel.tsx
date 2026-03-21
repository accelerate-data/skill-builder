import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { FileText, GitCompare } from "lucide-react";
import { markdownComponents } from "@/components/markdown-link";
import { SkillFrontmatterHeader } from "@/components/skill-frontmatter-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { isSkillFile, parseFrontmatter } from "@/lib/frontmatter";
import { useRefineStore } from "@/stores/refine-store";
import { GitPatchView } from "./git-patch-view";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight, rehypeSanitize];

function normalizeDiffPath(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(1).join("/") : path;
}

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
  const [drawerWidth, setDrawerWidth] = useState(920);
  const [dragging, setDragging] = useState(false);
  const pendingWidthRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const skillFiles = useRefineStore((s) => s.skillFiles);
  const activeFileTab = useRefineStore((s) => s.activeFileTab);
  const selectedModifiedFile = useRefineStore((s) => s.selectedModifiedFile);
  const diffMode = useRefineStore((s) => s.diffMode);
  const gitDiff = useRefineStore((s) => s.gitDiff);
  const isLoadingFiles = useRefineStore((s) => s.isLoadingFiles);
  const setDiffMode = useRefineStore((s) => s.setDiffMode);
  const setSelectedModifiedFile = useRefineStore((s) => s.setSelectedModifiedFile);

  const activeFile = skillFiles.find((f) => f.filename === activeFileTab);
  const gitDiffFile = gitDiff?.files.find((file) => normalizeDiffPath(file.path) === activeFileTab);
  const hasDiff = !!gitDiffFile;

  const clampWidth = useCallback((width: number) => {
    if (typeof window === "undefined") return width;
    const maxWidth = Math.min(1200, Math.floor(window.innerWidth * 0.9));
    return Math.min(maxWidth, Math.max(560, width));
  }, []);

  const onResizeStart = useCallback(() => {
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      pendingWidthRef.current = clampWidth(window.innerWidth - e.clientX);
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingWidthRef.current !== null) {
            setDrawerWidth(pendingWidthRef.current);
            pendingWidthRef.current = null;
          }
          rafIdRef.current = null;
        });
      }
    };

    const onMouseUp = () => {
      setDragging(false);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (pendingWidthRef.current !== null) {
        setDrawerWidth(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [clampWidth, dragging]);

  return (
    <Dialog
      open={!!selectedModifiedFile}
      onOpenChange={(open) => {
        if (!open) setSelectedModifiedFile(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={`left-auto right-0 top-0 h-screen translate-x-0 translate-y-0 gap-0 rounded-none border-l border-r-0 border-t-0 border-b-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right ${dragging ? "select-none" : ""}`}
        style={{ width: `${drawerWidth}px`, maxWidth: "90vw" }}
      >
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
              setDrawerWidth((prev) => clampWidth(prev + step));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setDrawerWidth((prev) => clampWidth(prev - step));
            }
          }}
        />
        <DialogHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex min-w-0 items-start gap-1.5 text-base">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="break-words text-left leading-6" data-testid="refine-file-view-title">
                  {selectedModifiedFile ?? activeFileTab}
                </span>
              </DialogTitle>
              <DialogDescription className="mt-1 break-words text-xs">
                Inspect the selected file without leaving the refine transcript.
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                data-testid="refine-diff-toggle"
                variant="outline"
                size="sm"
                disabled={!hasDiff}
                onClick={() => setDiffMode(!diffMode)}
                className="gap-1.5"
              >
                <GitCompare className="size-3.5" />
                {diffMode ? "Preview" : "Diff"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid="refine-file-view-close"
                onClick={() => setSelectedModifiedFile(null)}
              >
                Close
              </Button>
            </div>
          </div>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  );
}
