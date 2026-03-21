import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize from "rehype-sanitize";
import { ArrowLeft, FileText, GitCompare } from "lucide-react";
import { markdownComponents } from "@/components/markdown-link";
import { SkillFrontmatterHeader } from "@/components/skill-frontmatter-header";
import { Button } from "@/components/ui/button";
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
      <div className="markdown-body compact max-w-none overflow-hidden p-4 pb-8">
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

  if (isLoadingFiles) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!selectedModifiedFile) {
    return (
      <div data-testid="refine-file-view-empty" className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a modified file to view it here
      </div>
    );
  }

  const activeFile = skillFiles.find((f) => f.filename === activeFileTab);
  const gitDiffFile = gitDiff?.files.find((file) => normalizeDiffPath(file.path) === activeFileTab);
  const hasDiff = !!gitDiffFile;

  return (
    <div data-testid="refine-file-view" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="refine-file-view-back"
            onClick={() => setSelectedModifiedFile(null)}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate" data-testid="refine-file-view-title">{selectedModifiedFile}</span>
          </div>
        </div>
        <Button
          data-testid="refine-diff-toggle"
          variant="outline"
          size="sm"
          disabled={!hasDiff}
          onClick={() => setDiffMode(!diffMode)}
          className="ml-2 gap-1.5"
        >
          <GitCompare className="size-3.5" />
          {diffMode ? "Preview" : "Diff"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {diffMode && gitDiffFile ? (
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
