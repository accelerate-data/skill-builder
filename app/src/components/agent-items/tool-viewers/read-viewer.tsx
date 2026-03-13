import type { DisplayItem } from "@/lib/display-types";

export function ReadViewer({ item }: { item: DisplayItem }) {
  const filePath = item.toolInput?.file_path as string | undefined;
  const content = item.toolResult?.content;

  return (
    <div className="flex flex-col gap-1.5">
      {filePath && (
        <div className="font-mono text-[11px] text-muted-foreground truncate">
          {filePath}
        </div>
      )}
      {content && (
        <div className="rounded-sm bg-muted/40 px-2 py-1.5">
          <pre className="max-h-96 overflow-y-auto font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
