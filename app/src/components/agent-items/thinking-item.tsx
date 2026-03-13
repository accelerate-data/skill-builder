import { Brain } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { markdownComponents } from "@/components/markdown-link";
import { ErrorBoundary } from "@/components/error-boundary";
import { BaseItem } from "./base-item";
import type { DisplayItem } from "@/lib/display-types";

export function ThinkingItem({ item }: { item: DisplayItem }) {
  const text = item.thinkingText ?? "";
  const summary = text.length > 60 ? text.slice(0, 60) + "..." : (text || "Extended thinking...");

  return (
    <BaseItem
      icon={<Brain className="size-3.5" />}
      label="Thinking"
      summary={summary}
      tokenCount={item.tokenCount}
      borderColor="var(--chat-thinking-border)"
      headerBg="var(--chat-thinking-bg)"
      defaultExpanded={false}
    >
      <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-xs">{text}</pre>}>
        <div className="markdown-body compact agent-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {text}
          </ReactMarkdown>
        </div>
      </ErrorBoundary>
    </BaseItem>
  );
}
