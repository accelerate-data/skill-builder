import type { DisplayItem } from "@/lib/display-types";

export function EditViewer({ item }: { item: DisplayItem }) {
  const input = item.toolInput;
  const filePath = input?.file_path as string | undefined;
  const oldString = input?.old_string as string | undefined;
  const newString = input?.new_string as string | undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {filePath && (
        <div className="font-mono text-[11px] text-muted-foreground truncate">
          {filePath}
        </div>
      )}
      {oldString && (
        <div className="rounded-sm bg-destructive/10 px-2 py-1.5">
          <pre className="max-h-48 overflow-y-auto text-xs text-destructive/80 whitespace-pre-wrap break-words line-through">
            {oldString}
          </pre>
        </div>
      )}
      {newString && (
        <div className="rounded-sm px-2 py-1.5" style={{ backgroundColor: "color-mix(in oklch, var(--color-seafoam), transparent 85%)" }}>
          <pre className="max-h-48 overflow-y-auto text-xs whitespace-pre-wrap break-words" style={{ color: "var(--color-seafoam)" }}>
            {newString}
          </pre>
        </div>
      )}
      {item.toolResult?.content && (
        <div className="rounded-sm bg-muted/40 px-2 py-1.5">
          <pre className="max-h-48 overflow-y-auto text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {item.toolResult.content}
          </pre>
        </div>
      )}
    </div>
  );
}
