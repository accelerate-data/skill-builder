import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { DisplayItem } from "@/lib/display-types";

export function ResultItem({ item }: { item: DisplayItem }) {
  const status = item.resultStatus ?? "success";
  const text = item.outputText_result ?? "Agent completed";

  if (status === "error") {
    return (
      <div className="border-l-2 border-l-[var(--chat-error-border)] bg-[var(--chat-error-bg)] rounded-md px-3 py-1 flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{text}</span>
      </div>
    );
  }

  if (status === "refusal") {
    return (
      <div className="border-l-2 border-l-[var(--chat-error-border)] bg-[var(--chat-error-bg)] rounded-md px-3 py-1 flex items-start gap-2 text-sm text-destructive">
        <XCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>Agent declined this request due to safety constraints. Please revise your prompt.</span>
      </div>
    );
  }

  return (
    <div
      className="border-l-2 border-l-[var(--chat-result-border)] bg-[var(--chat-result-bg)] rounded-md px-3 py-1 flex items-start gap-2 text-sm"
      style={{ color: "var(--color-seafoam)" }}
    >
      <CheckCircle2 className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>
        <span className="font-medium">Result: </span>
        {text}
      </span>
    </div>
  );
}
