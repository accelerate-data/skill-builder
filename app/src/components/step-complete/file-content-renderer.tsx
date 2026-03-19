import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-link";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import { parseClarifications } from "@/lib/clarifications-types";

export function FileContentRenderer({ file, content }: { file: string; content: string }) {
  // Detect clarifications.json — render with the structured editor in read-only mode
  if (file.endsWith("clarifications.json")) {
    const data = parseClarifications(content);
    if (data?.version && data.sections) {
      return (
        <div className="rounded-md border" style={{ height: "min(600px, 60vh)" }}>
          <ClarificationsEditor data={data} onChange={() => {}} readOnly />
        </div>
      );
    }
  }

  // Default: render as markdown
  return (
    <div className="rounded-md border">
      <div className="markdown-body compact max-w-none p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
