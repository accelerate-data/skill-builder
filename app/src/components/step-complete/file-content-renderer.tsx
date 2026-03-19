import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { markdownComponents } from "@/components/markdown-link";
import { SkillFrontmatterHeader } from "@/components/skill-frontmatter-header";
import { ClarificationsEditor } from "@/components/clarifications-editor";
import { parseClarifications } from "@/lib/clarifications-types";
import { isSkillFile, parseFrontmatter } from "@/lib/frontmatter";

export function FileContentRenderer({ file, content }: { file: string; content: string }) {
  const parsed = useMemo(() => {
    if (isSkillFile(file)) return parseFrontmatter(content);
    return { frontmatter: null, body: content };
  }, [file, content]);

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

  // Default: render as markdown with optional frontmatter header
  return (
    <div className="rounded-md border">
      {parsed.frontmatter && <SkillFrontmatterHeader frontmatter={parsed.frontmatter} />}
      <div className="markdown-body compact max-w-none p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
          {parsed.body}
        </ReactMarkdown>
      </div>
    </div>
  );
}
