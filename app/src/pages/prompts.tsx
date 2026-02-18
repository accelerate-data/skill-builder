import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { SKILL_TYPES, SKILL_TYPE_LABELS } from "@/lib/types";
import { getAgentPrompt } from "@/lib/tauri";

const PHASES = [
  { label: "Research", value: "research" },
  { label: "Detailed Research", value: "detailed-research" },
  { label: "Confirm Decisions", value: "confirm-decisions" },
  { label: "Generate Skill", value: "generate-skill" },
  { label: "Validate Skill", value: "validate-skill" },
];

export default function PromptsPage() {
  const [skillType, setSkillType] = useState("");
  const [phase, setPhase] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!skillType || !phase) {
      setContent(null);
      setError(null);
      return;
    }

    setContent(null);
    setLoading(true);
    setError(null);
    getAgentPrompt(skillType, phase)
      .then((result) => {
        setContent(result);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setContent(null);
        setLoading(false);
      });
  }, [skillType, phase]);

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <select
          value={skillType}
          onChange={(e) => setSkillType(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          aria-label="Skill Type"
        >
          <option value="">Select skill type...</option>
          {SKILL_TYPES.map((t) => (
            <option key={t} value={t}>
              {SKILL_TYPE_LABELS[t]}
            </option>
          ))}
        </select>

        <select
          value={phase}
          onChange={(e) => setPhase(e.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          aria-label="Phase"
        >
          <option value="">Select phase...</option>
          {PHASES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {!skillType || !phase ? (
        <p className="text-muted-foreground">
          Select a skill type and phase to view the agent prompt.
        </p>
      ) : loading ? (
        <p className="text-muted-foreground">Loading prompt...</p>
      ) : error ? (
        <p className="text-destructive">Failed to load prompt: {error}</p>
      ) : content ? (
        <div className="bg-muted/50 rounded-lg border p-6 select-text overflow-y-auto max-h-[calc(100vh-16rem)]">
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
              {content}
            </ReactMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
}
