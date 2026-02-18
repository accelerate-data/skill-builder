import { ScrollArea } from "@/components/ui/scroll-area";
import { computeLineDiff, type DiffLine } from "@/lib/skill-diff";

const DIFF_STYLES: Record<DiffLine["type"], { className: string; prefix: string }> = {
  added: { className: "bg-green-500/10 text-green-700 dark:text-green-400", prefix: "+ " },
  removed: { className: "bg-red-500/10 text-red-700 dark:text-red-400", prefix: "- " },
  unchanged: { className: "text-muted-foreground", prefix: "  " },
};

interface DiffViewProps {
  before: string;
  after: string;
}

export function DiffView({ before, after }: DiffViewProps) {
  const lines = computeLineDiff(before, after);

  return (
    <ScrollArea className="h-full">
      <pre className="font-mono text-sm">
        {lines.map((line, i) => {
          const { className, prefix } = DIFF_STYLES[line.type];
          return (
            <div key={i} className={`flex ${className}`}>
              <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground/50">
                {i + 1}
              </span>
              <span className="whitespace-pre-wrap break-all">
                {prefix}
                {line.content}
              </span>
            </div>
          );
        })}
      </pre>
    </ScrollArea>
  );
}
