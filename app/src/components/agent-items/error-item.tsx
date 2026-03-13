import { XCircle } from "lucide-react";
import type { DisplayItem } from "@/lib/display-types";

export function ErrorItem({ item }: { item: DisplayItem }) {
  return (
    <div className="border-l-2 border-l-[var(--chat-error-border)] bg-[var(--chat-error-bg)] rounded-md px-3 py-1 flex items-start gap-2 text-sm text-destructive">
      <XCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{item.errorMessage ?? "Unknown error"}</span>
    </div>
  );
}
