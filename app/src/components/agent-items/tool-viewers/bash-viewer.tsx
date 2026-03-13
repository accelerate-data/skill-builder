import type { DisplayItem } from "@/lib/display-types";

export function BashViewer({ item }: { item: DisplayItem }) {
  const command = item.toolInput?.command as string | undefined;
  const output = item.toolResult?.content;

  return (
    <div className="flex flex-col gap-1.5">
      {command && (
        <div className="font-mono bg-muted/40 rounded-sm px-2 py-1 text-xs text-muted-foreground">
          $ {command}
        </div>
      )}
      {output && (
        <div className="rounded-sm bg-muted/40 px-2 py-1.5">
          <pre className="max-h-96 overflow-y-auto font-mono text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
