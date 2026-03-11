import { MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-link";
import { ErrorBoundary } from "@/components/error-boundary";
import { BaseItem } from "./base-item";
import type { DisplayItem } from "@/lib/display-types";

export function OutputItem({ item }: { item: DisplayItem }) {
  const text = item.outputText ?? "";
  const summary = text.length > 60 ? text.slice(0, 60) + "..." : text;

  return (
    <BaseItem
      icon={<MessageSquare className="size-3.5" />}
      label="Output"
      summary={summary}
      tokenCount={item.tokenCount}
      borderColor="var(--color-pacific)"
      defaultExpanded={true}
    >
      <ErrorBoundary fallback={<pre className="whitespace-pre-wrap text-sm">{text}</pre>}>
        <div className="markdown-body compact">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {text}
          </ReactMarkdown>
        </div>
      </ErrorBoundary>
    </BaseItem>
  );
}
