import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import {
  syntaxHighlighting,
  HighlightStyle,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";

// MarkEdit-inspired highlight style — headings are bigger, emphasis is styled inline
const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.6em", fontWeight: "700", lineHeight: "1.3" },
  { tag: tags.heading2, fontSize: "1.35em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading3, fontSize: "1.15em", fontWeight: "600", lineHeight: "1.3" },
  { tag: tags.heading4, fontSize: "1.05em", fontWeight: "600" },
  { tag: tags.heading5, fontSize: "1em", fontWeight: "600" },
  { tag: tags.heading6, fontSize: "1em", fontWeight: "600", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.link, color: "var(--primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--muted-foreground)", fontSize: "0.9em" },
  { tag: tags.monospace, fontFamily: "monospace", fontSize: "0.9em", backgroundColor: "color-mix(in oklch, var(--muted) 50%, transparent)", borderRadius: "3px", padding: "1px 4px" },
  { tag: tags.quote, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--muted-foreground)" },
  { tag: tags.processingInstruction, color: "var(--muted-foreground)", fontSize: "0.85em" }, // markdown markers like # ** etc
]);

const baseTheme = (dark: boolean) =>
  EditorView.theme(
    {
      "&": {
        backgroundColor: "transparent",
        height: "100%",
      },
      ".cm-content": {
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontSize: "15px",
        lineHeight: "1.7",
        padding: "24px 16px",
        maxWidth: "48em",
      },
      ".cm-line": {
        padding: "1px 0",
      },
      ".cm-gutters": {
        display: "none",
      },
      ".cm-activeLine": {
        backgroundColor: dark
          ? "color-mix(in oklch, var(--accent) 20%, transparent)"
          : "color-mix(in oklch, var(--accent) 15%, transparent)",
      },
      ".cm-selectionBackground": {
        backgroundColor: dark
          ? "color-mix(in oklch, var(--accent) 50%, transparent) !important"
          : "color-mix(in oklch, var(--accent) 35%, transparent) !important",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--foreground)",
        borderLeftWidth: "2px",
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "var(--primary)",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
    },
    { dark }
  );

interface CodeEditorProps {
  content: string;
  onChange: (value: string) => void;
  readonly?: boolean;
}

export function CodeEditor({ content, onChange, readonly = false }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const isExternalUpdate = useRef(false);
  const { resolvedTheme } = useTheme();

  // Keep callback ref in sync
  onChangeRef.current = onChange;

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = resolvedTheme === "dark";

    const state = EditorState.create({
      doc: content,
      extensions: [
        history(),
        markdown(),
        syntaxHighlighting(markdownHighlightStyle),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.lineWrapping,
        baseTheme(isDark),
        EditorState.readOnly.of(readonly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isExternalUpdate.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only recreate on theme or readonly change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, readonly]);

  // Update content when it changes externally (e.g. switching files)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      isExternalUpdate.current = true;
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: content },
      });
      isExternalUpdate.current = false;
    }
  }, [content]);

  return (
    <div ref={containerRef} className="h-full overflow-auto" />
  );
}
