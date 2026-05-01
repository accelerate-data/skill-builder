import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-link";

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeSanitize];

interface MemoizedMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Memoized markdown renderer that avoids re-parsing on unrelated re-renders.
 * The `memo` wrapper prevents re-render when props haven't changed.
 */
export const MemoizedMarkdown = memo(function MemoizedMarkdown({
  content,
  className = "markdown-body compact agent-markdown",
}: MemoizedMarkdownProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
