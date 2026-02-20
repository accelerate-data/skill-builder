import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { markdownComponents } from "@/components/markdown-link";
import { ChevronDown, FileText, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useRefineStore } from "@/stores/refine-store";
import { DiffView } from "./diff-view";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

/** Memoized markdown renderer — only re-renders when content changes. */
const MarkdownPreview = memo(function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-body compact max-w-none overflow-hidden p-4 pb-8">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
});

export function PreviewPanel() {
  const skillFiles = useRefineStore((s) => s.skillFiles);
  const activeFileTab = useRefineStore((s) => s.activeFileTab);
  const diffMode = useRefineStore((s) => s.diffMode);
  const baselineFiles = useRefineStore((s) => s.baselineFiles);
  const isLoadingFiles = useRefineStore((s) => s.isLoadingFiles);
  const setActiveFileTab = useRefineStore((s) => s.setActiveFileTab);
  const setDiffMode = useRefineStore((s) => s.setDiffMode);

  const [filePickerOpen, setFilePickerOpen] = useState(false);

  if (skillFiles.length === 0 && !isLoadingFiles) {
    return (
      <div data-testid="refine-preview-empty" className="flex h-full items-center justify-center text-muted-foreground">
        Select a skill to preview its files
      </div>
    );
  }

  if (isLoadingFiles) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const activeFile = skillFiles.find((f) => f.filename === activeFileTab);
  const baselineFile = baselineFiles.find((f) => f.filename === activeFileTab);
  const hasBaseline = baselineFiles.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <Popover open={filePickerOpen} onOpenChange={setFilePickerOpen}>
          <PopoverTrigger asChild>
            <Button data-testid="refine-file-picker" variant="outline" size="sm" className="max-w-[280px] justify-between gap-1.5">
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate">{activeFileTab}</span>
              <ChevronDown className="ml-1 size-3.5 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search files..." />
              <CommandList>
                <CommandEmpty>No files found</CommandEmpty>
                <CommandGroup>
                  {skillFiles.map((f) => (
                    <CommandItem
                      key={f.filename}
                      value={f.filename}
                      onSelect={() => {
                        setActiveFileTab(f.filename);
                        setFilePickerOpen(false);
                      }}
                    >
                      <FileText className="mr-2 size-3.5 shrink-0" />
                      <span className="truncate">{f.filename}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Button
          data-testid="refine-diff-toggle"
          variant="outline"
          size="sm"
          disabled={!hasBaseline}
          onClick={() => setDiffMode(!diffMode)}
          className="ml-2 gap-1.5"
        >
          <GitCompare className="size-3.5" />
          {diffMode ? "Preview" : "Diff"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {diffMode && baselineFile ? (
          <DiffView
            before={baselineFile.content}
            after={activeFile?.content ?? ""}
          />
        ) : (
          <ScrollArea className="h-full">
            <MarkdownPreview content={activeFile?.content ?? ""} />
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
