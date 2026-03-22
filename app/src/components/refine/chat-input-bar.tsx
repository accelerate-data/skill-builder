import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SendHorizontal, Square, X, Bot, FileText } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Placeholder from "@tiptap/extension-placeholder";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRefineStore } from "@/stores/refine-store";

// ── Types ────────────────────────────────────────────────────────────────────

type MentionKind = "agent" | "file";

interface MentionOption {
  kind: MentionKind;
  label: string;
  value: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, target: string): boolean {
  return target.toLowerCase().includes(query.toLowerCase());
}

// ── Suggestion dropdown ──────────────────────────────────────────────────────

interface SuggestionListProps {
  items: MentionOption[];
  command: (item: MentionOption) => void;
}

interface SuggestionListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

function SuggestionListInner(
  { items, command }: SuggestionListProps,
  ref: React.ForwardedRef<SuggestionListHandle>,
) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) command(item);
    },
    [items, command],
  );

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (event.key === "ArrowDown") {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        setSelectedIndex((prev) => (prev - 1 + items.length) % items.length);
        return true;
      }
      if (event.key === "Enter") {
        selectItem(selectedIndex);
        return true;
      }
      if (event.key === "Escape") {
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) return null;

  const agents = items.filter((i) => i.kind === "agent");
  const files = items.filter((i) => i.kind === "file");
  let flatIdx = 0;

  return (
    <div className="z-50 w-64 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <div role="listbox" aria-label="Mentions">
        {agents.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Agents</div>
            {agents.map((o) => {
              const idx = flatIdx++;
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={selectedIndex === idx}
                  data-selected={selectedIndex === idx || undefined}
                  className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectItem(idx);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <Bot className="size-3.5 shrink-0" style={{ color: "var(--color-pacific)" }} />
                  <span>{o.label}</span>
                </div>
              );
            })}
          </>
        )}
        {files.length > 0 && (
          <>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Files</div>
            {files.map((o) => {
              const idx = flatIdx++;
              return (
                <div
                  key={o.value}
                  role="option"
                  aria-selected={selectedIndex === idx}
                  data-selected={selectedIndex === idx || undefined}
                  className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectItem(idx);
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <FileText className="size-3.5 shrink-0" style={{ color: "var(--color-ocean)" }} />
                  <span>{o.label}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

import React from "react";
const SuggestionList = React.forwardRef<SuggestionListHandle, SuggestionListProps>(SuggestionListInner);

// ── Mention extension config ─────────────────────────────────────────────────

function buildSuggestion(optionsRef: React.RefObject<MentionOption[]>) {
  return {
    char: "@",
    items: ({ query }: { query: string }): MentionOption[] => {
      const all = optionsRef.current ?? [];
      if (!query) return all;
      return all.filter((o) => fuzzyMatch(query, o.label) || fuzzyMatch(query, o.value));
    },
    render: () => {
      let component: ReactRenderer<SuggestionListHandle> | null = null;
      let popup: HTMLDivElement | null = null;

      return {
        onStart: (props: SuggestionProps<MentionOption>) => {
          component = new ReactRenderer(SuggestionList, {
            props: {
              items: props.items,
              command: (item: MentionOption) => {
                props.command({ id: item.value, label: item.label, kind: item.kind });
              },
            },
            editor: props.editor,
          });

          popup = document.createElement("div");
          popup.style.position = "absolute";
          popup.style.zIndex = "50";
          popup.appendChild(component.element);

          // Position above the editor
          const editorEl = props.editor.view.dom.closest(".refine-editor") as HTMLElement | null;
          if (editorEl) {
            editorEl.parentElement?.appendChild(popup);
            popup.style.bottom = `${editorEl.offsetHeight + 4}px`;
            popup.style.left = "0";
          }
        },
        onUpdate: (props: SuggestionProps<MentionOption>) => {
          component?.updateProps({
            items: props.items,
            command: (item: MentionOption) => {
              props.command({ id: item.value, label: item.label, kind: item.kind });
            },
          });
        },
        onKeyDown: (props: SuggestionKeyDownProps) => {
          if (props.event.key === "Escape") {
            popup?.remove();
            component?.destroy();
            popup = null;
            component = null;
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popup?.remove();
          component?.destroy();
          popup = null;
          component = null;
        },
      };
    },
  };
}

// ── Extract data from editor ─────────────────────────────────────────────────

function extractFromEditor(editor: ReturnType<typeof useEditor>): {
  text: string;
  targetFiles: string[];
} {
  if (!editor) return { text: "", targetFiles: [] };

  const json = editor.getJSON();
  const targetFiles: string[] = [];
  let text = "";

  function walkNode(node: Record<string, unknown>) {
    if (node.type === "mention") {
      const attrs = node.attrs as { id?: string; label?: string; kind?: string } | undefined;
      if (attrs) {
        text += `@${attrs.id ?? attrs.label ?? ""}`;
        if (attrs.kind === "file" && attrs.id) {
          if (!targetFiles.includes(attrs.id)) targetFiles.push(attrs.id);
        }
      }
      return;
    }
    if (node.type === "text") {
      text += (node.text as string) ?? "";
      return;
    }
    if (node.type === "paragraph" && text.length > 0) {
      text += "\n";
    }
    const content = node.content as Record<string, unknown>[] | undefined;
    if (content) {
      for (const child of content) walkNode(child);
    }
  }

  walkNode(json as Record<string, unknown>);
  return { text: text.trim(), targetFiles };
}

// ── Component ────────────────────────────────────────────────────────────────

interface ChatInputBarProps {
  onSend: (text: string, targetFiles?: string[]) => void;
  onCancel?: () => void;
  isRunning: boolean;
  availableFiles: string[];
  availableAgents: string[];
  prefilledValue?: string;
}

export function ChatInputBar({
  onSend,
  onCancel,
  isRunning,
  availableFiles,
  availableAgents,
  prefilledValue,
}: ChatInputBarProps) {
  const [targetFiles, setTargetFiles] = useState<string[]>([]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Keep a ref to the current options so the suggestion plugin reads fresh data.
  const optionsRef = useRef<MentionOption[]>([]);
  const allOptions = useMemo<MentionOption[]>(() => {
    const agents: MentionOption[] = availableAgents.map((a) => {
      const parts = a.split(":");
      const label = parts.length > 1 ? parts.slice(1).join(":") : a;
      return { kind: "agent", label, value: a };
    });
    const files: MentionOption[] = availableFiles.map((f) => ({
      kind: "file",
      label: f,
      value: f,
    }));
    return [...agents, ...files];
  }, [availableAgents, availableFiles]);

  useEffect(() => {
    optionsRef.current = allOptions;
  }, [allOptions]);

  const suggestion = useMemo(() => buildSuggestion(optionsRef), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        horizontalRule: false,
        listItem: false,
      }),
      Placeholder.configure({
        placeholder: "Describe what to change...",
      }),
      Mention.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            kind: { default: null },
          };
        },
      }).configure({
        HTMLAttributes: { class: "mention" },
        suggestion,
        renderHTML: ({ options, node }) => {
          const kind = node.attrs.kind as string | undefined;
          const color =
            kind === "agent"
              ? "var(--color-pacific)"
              : kind === "file"
                ? "var(--color-ocean)"
                : "inherit";
          return [
            "span",
            {
              class: "mention",
              "data-mention-kind": kind ?? "",
              style: `color: ${color}; font-weight: 500;`,
            },
            `${options.suggestion?.char ?? "@"}${node.attrs.label ?? node.attrs.id}`,
          ];
        },
      }),
    ],
    editorProps: {
      attributes: {
        class: "outline-none min-h-10 max-h-32 overflow-y-auto px-3 py-2 text-sm leading-relaxed",
        "data-testid": "refine-chat-input",
      },
      handleKeyDown: (_, event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          // Don't intercept if the suggestion popup is handling Enter
          // The suggestion plugin returns true for Enter when active.
          return false;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      // Extract target files from mention nodes on every update
      const { targetFiles: files } = extractFromEditor(ed);
      setTargetFiles(files);
    },
  });

  // Handle Enter to send (registered as a Tiptap keyboard shortcut)
  useEffect(() => {
    if (!editor) return;

    const handleEnter = ({ editor: ed }: { editor: typeof editor }) => {
      if (!ed) return false;
      const { text, targetFiles: files } = extractFromEditor(ed);
      if (!text) return false;
      onSend(text, files.length > 0 ? files : undefined);
      ed.commands.clearContent();
      setTargetFiles([]);
      return true;
    };

    // Register Enter as a keyboard shortcut
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        handleKeyDown: (_view, event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            const popup = wrapperRef.current?.querySelector("[role='listbox']");
            if (popup) return false;
            return handleEnter({ editor });
          }
          return false;
        },
      },
    });
  }, [editor, onSend]);

  // Prefilled value
  useEffect(() => {
    if (prefilledValue && editor) {
      editor.commands.setContent(prefilledValue);
      useRefineStore.getState().setPendingInitialMessage(null);
    }
  }, [prefilledValue, editor]);

  // Disable/enable editor based on running state
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isRunning);
    }
  }, [editor, isRunning]);

  const handleSend = useCallback(() => {
    if (!editor) return;
    const { text, targetFiles: files } = extractFromEditor(editor);
    if (!text) return;
    onSend(text, files.length > 0 ? files : undefined);
    editor.commands.clearContent();
    setTargetFiles([]);
  }, [editor, onSend]);

  const removeFile = useCallback((filename: string) => {
    setTargetFiles((prev) => prev.filter((f) => f !== filename));
  }, []);

  const hasBadges = targetFiles.length > 0;

  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3">
      {hasBadges && (
        <div className="flex flex-wrap gap-1">
          {targetFiles.map((f) => (
            <Badge key={f} variant="secondary" className="gap-1 text-xs">
              @{f}
              <button
                type="button"
                onClick={() => removeFile(f)}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div ref={wrapperRef} className="relative flex items-end gap-2">
        <div className="refine-editor relative flex-1 rounded-md border bg-transparent transition-colors focus-within:ring-1 focus-within:ring-ring">
          <EditorContent editor={editor} />
        </div>
        <Button
          data-testid="refine-send-button"
          size="icon"
          type="button"
          onClick={isRunning ? onCancel : handleSend}
          disabled={isRunning ? !onCancel : !editor?.getText().trim()}
          aria-label={isRunning ? "Cancel current run" : "Send refine message"}
          title={isRunning ? "Cancel current run" : "Send refine message"}
        >
          {isRunning ? <Square className="size-4 fill-current" /> : <SendHorizontal className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
