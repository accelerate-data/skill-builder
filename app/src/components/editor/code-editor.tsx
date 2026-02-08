import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

const lightTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", height: "100%" },
    ".cm-content": { fontFamily: "monospace", fontSize: "14px", padding: "16px 0" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--muted-foreground)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--accent) 30%, transparent)" },
    ".cm-selectionBackground": { backgroundColor: "color-mix(in oklch, var(--accent) 40%, transparent) !important" },
    ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  },
  { dark: false }
);

const darkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", height: "100%" },
    ".cm-content": { fontFamily: "monospace", fontSize: "14px", padding: "16px 0" },
    ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--muted-foreground)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent" },
    ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--accent) 30%, transparent)" },
    ".cm-selectionBackground": { backgroundColor: "color-mix(in oklch, var(--accent) 50%, transparent) !important" },
    ".cm-cursor": { borderLeftColor: "var(--foreground)" },
  },
  { dark: true }
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
        lineNumbers(),
        history(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.lineWrapping,
        isDark ? darkTheme : lightTheme,
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
