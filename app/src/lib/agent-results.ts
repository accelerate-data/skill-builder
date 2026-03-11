import type { DisplayItem } from "@/lib/display-types";

export function extractStructuredResultPayload(
  displayItems: DisplayItem[] | undefined,
): unknown | null {
  if (!displayItems || displayItems.length === 0) return null;
  const resultItem = [...displayItems].reverse().find((item) => item.type === "result");
  return resultItem?.structuredOutput ?? null;
}
