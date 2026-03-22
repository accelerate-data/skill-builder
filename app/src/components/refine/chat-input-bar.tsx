import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SendHorizontal, Square, X, Bot, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useRefineStore } from "@/stores/refine-store";

// ── Types ────────────────────────────────────────────────────────────────────

type MentionKind = "agent" | "file";

interface MentionOption {
  kind: MentionKind;
  /** Display label (e.g. "rewrite-skill" or "SKILL.md"). */
  label: string;
  /** Full qualified value inserted into the prompt (e.g. "skill-creator:rewrite-skill"). */
  value: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  return t.includes(q);
}

function cycleIndex(items: MentionOption[], currentIdx: number, direction: 1 | -1): number {
  if (items.length === 0) return -1;
  return (currentIdx + direction + items.length) % items.length;
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
  const [text, setText] = useState("");
  const [targetFiles, setTargetFiles] = useState<string[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState("");
  const pickerIndexRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Build unified mention list from agents + files.
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

  // Filter options based on query after @.
  const filteredOptions = useMemo(() => {
    if (!filterQuery) return allOptions;
    return allOptions.filter((o) => fuzzyMatch(filterQuery, o.label) || fuzzyMatch(filterQuery, o.value));
  }, [allOptions, filterQuery]);

  // Grouped display: agents first, then files.
  const groupedAgents = useMemo(() => filteredOptions.filter((o) => o.kind === "agent"), [filteredOptions]);
  const groupedFiles = useMemo(() => filteredOptions.filter((o) => o.kind === "file"), [filteredOptions]);

  // Populate text from prefilled value (e.g. navigating from Test page).
  useEffect(() => {
    if (prefilledValue) {
      setText(prefilledValue);
      useRefineStore.getState().setPendingInitialMessage(null);
    }
  }, [prefilledValue]);

  // Sync ref with state for synchronous reads in event handlers.
  useEffect(() => {
    pickerIndexRef.current = pickerIndex;
  }, [pickerIndex]);

  // Close picker on outside click.
  useEffect(() => {
    if (!showPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPicker]);

  // Sync overlay scroll with textarea.
  useEffect(() => {
    const textarea = textareaRef.current;
    const overlay = overlayRef.current;
    if (!textarea || !overlay) return;
    const syncScroll = () => {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    };
    textarea.addEventListener("scroll", syncScroll);
    return () => textarea.removeEventListener("scroll", syncScroll);
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed, targetFiles.length > 0 ? targetFiles : undefined);
    setText("");
    setTargetFiles([]);
  }, [text, targetFiles, onSend]);

  const selectOption = useCallback((option: MentionOption) => {
    if (option.kind === "file") {
      setTargetFiles((prev) => (prev.includes(option.value) ? prev : [...prev, option.value]));
    }
    setText((prev) => {
      const atIdx = prev.lastIndexOf("@");
      if (atIdx >= 0) {
        return prev.slice(0, atIdx) + `@${option.value} `;
      }
      return prev + `@${option.value} `;
    });
    setShowPicker(false);
    setFilterQuery("");
    textareaRef.current?.focus();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value;
      setText(val);

      if (showPicker) {
        // Extract filter query: text after the last @.
        const atIdx = val.lastIndexOf("@");
        if (atIdx >= 0) {
          const query = val.slice(atIdx + 1);
          // Close picker if user types space or newline after @.
          if (query.includes(" ") || query.includes("\n")) {
            setShowPicker(false);
            setFilterQuery("");
          } else {
            setFilterQuery(query);
            setPickerIndex(0);
            pickerIndexRef.current = 0;
          }
        } else {
          setShowPicker(false);
          setFilterQuery("");
        }
      }
    },
    [showPicker],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showPicker) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPickerIndex((prev) => {
            const next = cycleIndex(filteredOptions, prev, 1);
            pickerIndexRef.current = next;
            return next;
          });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPickerIndex((prev) => {
            const next = cycleIndex(filteredOptions, prev, -1);
            pickerIndexRef.current = next;
            return next;
          });
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const idx = pickerIndexRef.current;
          const option = filteredOptions[idx];
          if (option) selectOption(option);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setShowPicker(false);
          setFilterQuery("");
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "@" && allOptions.length > 0 && !showPicker) {
        setShowPicker(true);
        setPickerIndex(0);
        pickerIndexRef.current = 0;
        setFilterQuery("");
      }
    },
    [handleSend, selectOption, allOptions, filteredOptions, showPicker],
  );

  const removeFile = useCallback((filename: string) => {
    setTargetFiles((prev) => prev.filter((f) => f !== filename));
  }, []);

  // Build color overlay spans for @mentions in the textarea.
  const overlayContent = useMemo(() => {
    const mentionRegex = /@([\w:./-]+)/g;
    const parts: { text: string; color?: string }[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push({ text: text.slice(lastIdx, match.index) });
      }
      const mentionValue = match[1];
      const option = allOptions.find((o) => o.value === mentionValue || o.label === mentionValue);
      const color = option?.kind === "agent"
        ? "var(--color-pacific)"
        : option?.kind === "file"
          ? "var(--color-ocean)"
          : undefined;
      parts.push({ text: match[0], color });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < text.length) {
      parts.push({ text: text.slice(lastIdx) });
    }
    return parts;
  }, [text, allOptions]);

  const hasBadges = targetFiles.length > 0;

  // Compute flat index for rendering grouped items with a single highlight index.
  let flatIdx = 0;

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
        <div className="relative flex-1">
          {/* Color overlay layer — mirrors textarea content with colored @mentions */}
          <div
            ref={overlayRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm text-transparent"
            style={{ lineHeight: "1.5" }}
          >
            {overlayContent.map((part, i) =>
              part.color ? (
                <span key={i} style={{ color: part.color }}>{part.text}</span>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </div>
          <Textarea
            ref={textareaRef}
            data-testid="refine-chat-input"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe what to change..."
            disabled={isRunning}
            className="min-h-10 resize-none bg-transparent"
            style={{ caretColor: "var(--foreground)" }}
            rows={1}
          />
          {showPicker && filteredOptions.length > 0 && (
            <div className="absolute bottom-full left-0 z-50 mb-1 w-64 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              <div role="listbox" aria-label="Mentions">
                {groupedAgents.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Agents
                    </div>
                    {groupedAgents.map((o) => {
                      const idx = flatIdx++;
                      return (
                        <div
                          key={o.value}
                          role="option"
                          aria-selected={pickerIndex === idx}
                          data-selected={pickerIndex === idx || undefined}
                          className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectOption(o);
                          }}
                          onMouseEnter={() => {
                            setPickerIndex(idx);
                            pickerIndexRef.current = idx;
                          }}
                        >
                          <Bot className="size-3.5 shrink-0" style={{ color: "var(--color-pacific)" }} />
                          <span>{o.label}</span>
                        </div>
                      );
                    })}
                  </>
                )}
                {groupedFiles.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      Files
                    </div>
                    {groupedFiles.map((o) => {
                      const idx = flatIdx++;
                      return (
                        <div
                          key={o.value}
                          role="option"
                          aria-selected={pickerIndex === idx}
                          data-selected={pickerIndex === idx || undefined}
                          className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            selectOption(o);
                          }}
                          onMouseEnter={() => {
                            setPickerIndex(idx);
                            pickerIndexRef.current = idx;
                          }}
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
          )}
        </div>
        <Button
          data-testid="refine-send-button"
          size="icon"
          type="button"
          onClick={isRunning ? onCancel : handleSend}
          disabled={isRunning ? !onCancel : !text.trim()}
          aria-label={isRunning ? "Cancel current run" : "Send refine message"}
          title={isRunning ? "Cancel current run" : "Send refine message"}
        >
          {isRunning ? <Square className="size-4 fill-current" /> : <SendHorizontal className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
