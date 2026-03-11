import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { DisplayItem } from "@/lib/display-types";

export function DefaultViewer({ item }: { item: DisplayItem }) {
  const [copied, setCopied] = useState(false);

  const inputJson = item.toolInput && Object.keys(item.toolInput).length > 0
    ? JSON.stringify(item.toolInput, null, 2)
    : null;

  const resultContent = item.toolResult?.content;

  function handleCopy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-1.5">
      {inputJson && (
        <div className="relative rounded-sm bg-muted/40 px-2 py-1.5">
          <button
            type="button"
            onClick={() => handleCopy(inputJson)}
            aria-label="Copy JSON"
            className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          </button>
          <pre className="max-h-96 overflow-y-auto text-xs text-muted-foreground whitespace-pre-wrap break-words pr-5">
            {inputJson}
          </pre>
        </div>
      )}
      {resultContent && (
        <div className="rounded-sm bg-muted/40 px-2 py-1.5">
          <pre className="max-h-96 overflow-y-auto text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {resultContent}
          </pre>
        </div>
      )}
    </div>
  );
}
