import { memo, useMemo } from "react";
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

  return (
    <Dialog
      open={!!selectedModifiedFile}
      onOpenChange={(open) => {
        if (!open) setSelectedModifiedFile(null);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="left-auto right-0 top-0 h-screen max-w-[min(920px,100vw)] translate-x-0 translate-y-0 gap-0 rounded-none border-l border-r-0 border-t-0 border-b-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
      >
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
