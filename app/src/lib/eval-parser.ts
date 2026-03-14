import type React from "react";
import { createElement } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EvalDirection = "up" | "down" | "neutral" | null;

export interface EvalLine {
  direction: EvalDirection;
  text: string;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Parse an evaluator line into direction and text.
 * Strips leading markdown bullet prefixes (-, *, \u2022) before detecting direction. */
export function parseEvalLine(line: string): EvalLine {
  const trimmed = line.trim();
  if (!trimmed) return { direction: null, text: "" };
  // Strip optional markdown bullet (-, *, \u2022) so "- \u2191 text" parses correctly
  const stripped = trimmed.replace(/^[-*\u2022]\s*/, "");
  if (stripped.startsWith("\u2191")) return { direction: "up", text: stripped.slice(1).trim() };
  if (stripped.startsWith("\u2193")) return { direction: "down", text: stripped.slice(1).trim() };
  if (stripped.startsWith("\u2192")) return { direction: "neutral", text: stripped.slice(1).trim() };
  return { direction: null, text: trimmed };
}

/** Split evaluator output into directional bullet lines and a recommendations block. */
export function parseEvalOutput(text: string): { lines: EvalLine[]; recommendations: string } {
  const markerMatch = /^##\s*recommendations/im.exec(text);
  if (!markerMatch) {
    return {
      lines: text.split("\n").map(parseEvalLine).filter((l) => l.text.length > 0),
      recommendations: "",
    };
  }
  const bulletSection = text.slice(0, markerMatch.index).trim();
  const recsSection = text.slice(markerMatch.index + markerMatch[0].length).trim();
  return {
    lines: bulletSection.split("\n").map(parseEvalLine).filter((l) => l.text.length > 0),
    recommendations: recsSection,
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Return the arrow character for an eval direction. */
export function evalDirectionIcon(direction: EvalDirection): string {
  switch (direction) {
    case "up": return "\u2191";
    case "down": return "\u2193";
    case "neutral": return "\u2192";
    default: return "\u2022";
  }
}

/** Return the color class for an eval direction's icon. */
export function evalIconColor(direction: EvalDirection): string {
  switch (direction) {
    case "up": return "text-[var(--color-seafoam)]";
    case "down": return "text-destructive";
    case "neutral": return "text-muted-foreground";
    default: return "text-muted-foreground/50";
  }
}

/** Return the row background class for an eval direction. */
export function evalRowBg(direction: EvalDirection): string {
  switch (direction) {
    case "up": return "bg-[var(--color-seafoam)]/5";
    case "down": return "bg-destructive/5";
    default: return "";
  }
}

/** Render inline bold markdown (**text**) in a string as React nodes. */
export function renderInlineBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? createElement("strong", { key: i }, part) : part,
  );
}
