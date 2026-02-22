import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, SendHorizontal, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { RefineCommand } from "@/stores/refine-store";

const COMMANDS: { value: RefineCommand; label: string; icon: typeof RefreshCw }[] = [
  { value: "rewrite", label: "Rewrite skill", icon: RefreshCw },
  { value: "validate", label: "Validate skill", icon: ShieldCheck },
];

/** Cycle to the next/previous item in a list, wrapping around. */
function cycleValue(items: string[], current: string, direction: 1 | -1): string {
  if (items.length === 0) return "";
  const idx = items.indexOf(current);
  if (idx === -1) return items[0];
  return items[(idx + direction + items.length) % items.length];
}

interface ChatInputBarProps {
  onSend: (text: string, targetFiles?: string[], command?: RefineCommand) => void;
  isRunning: boolean;
  availableFiles: string[];
  prefilledValue?: string;
}

export function ChatInputBar({ onSend, isRunning, availableFiles, prefilledValue }: ChatInputBarProps) {
  const [text, setText] = useState("");
  const [targetFiles, setTargetFiles] = useState<string[]>([]);
  const [activeCommand, setActiveCommand] = useState<RefineCommand | undefined>();
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [showCommandPicker, setShowCommandPicker] = useState(false);
  const [pickerValue, setPickerValue] = useState("");
  const pickerValueRef = useRef("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Populate text from prefilled value (e.g. navigating from Test page)
  useEffect(() => {
    if (prefilledValue) {
      setText(prefilledValue);
    }
  }, [prefilledValue]);

  // Keep ref in sync with state for synchronous reads in event handlers
  useEffect(() => {
    pickerValueRef.current = pickerValue;
  }, [pickerValue]);

  const pickerOpen = showFilePicker || showCommandPicker;

  // Item values for the currently open picker (used for arrow key cycling)
  const pickerItems = useMemo(() => {
    if (showCommandPicker) return COMMANDS.map((c) => c.value);
    if (showFilePicker) return availableFiles;
    return [];
  }, [showCommandPicker, showFilePicker, availableFiles]);

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowFilePicker(false);
        setShowCommandPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [pickerOpen]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !activeCommand) return;
    onSend(
      trimmed,
      targetFiles.length > 0 ? targetFiles : undefined,
      activeCommand,
    );
    setText("");
    setTargetFiles([]);
    setActiveCommand(undefined);
  }, [text, targetFiles, activeCommand, onSend]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    // Close file picker if user deletes the @ trigger
    if (!val.includes("@")) {
      setShowFilePicker(false);
    }
    // Close command picker if user deletes the / trigger
    if (!val.includes("/")) {
      setShowCommandPicker(false);
    }
  }, []);

  const selectFile = useCallback((filename: string) => {
    setTargetFiles((prev) =>
      prev.includes(filename) ? prev : [...prev, filename],
    );
    setText((prev) => {
      const atIdx = prev.lastIndexOf("@");
      if (atIdx >= 0) {
        return prev.slice(0, atIdx) + `@${filename} `;
      }
      return prev + `@${filename} `;
    });
    setShowFilePicker(false);
    textareaRef.current?.focus();
  }, []);

  const selectCommand = useCallback((command: RefineCommand) => {
    setActiveCommand(command);
    // Remove the / trigger from text
    setText((prev) => {
      const slashIdx = prev.lastIndexOf("/");
      if (slashIdx >= 0) {
        return prev.slice(0, slashIdx) + prev.slice(slashIdx + 1);
      }
      return prev;
    });
    setShowCommandPicker(false);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (pickerOpen) {
        // Arrow keys cycle through picker items
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setPickerValue((prev) => {
            const next = cycleValue(pickerItems, prev, 1);
            pickerValueRef.current = next;
            return next;
          });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setPickerValue((prev) => {
            const next = cycleValue(pickerItems, prev, -1);
            pickerValueRef.current = next;
            return next;
          });
          return;
        }

        // Enter confirms the currently highlighted picker item
        if (e.key === "Enter") {
          e.preventDefault();
          const current = pickerValueRef.current;
          if (showCommandPicker) {
            const cmd = COMMANDS.find((c) => c.value === current);
            if (cmd) selectCommand(cmd.value);
          } else if (showFilePicker && current) {
            const file = availableFiles.find((f) => f === current);
            if (file) selectFile(file);
          }
          return;
        }

        // Escape closes the picker
        if (e.key === "Escape") {
          e.preventDefault();
          setShowFilePicker(false);
          setShowCommandPicker(false);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "@" && availableFiles.length > 0 && !showFilePicker) {
        setShowFilePicker(true);
        setPickerValue(availableFiles[0] ?? "");
        pickerValueRef.current = availableFiles[0] ?? "";
      }
      if (e.key === "/" && !activeCommand && !showCommandPicker) {
        setShowCommandPicker(true);
        setPickerValue(COMMANDS[0]?.value ?? "");
        pickerValueRef.current = COMMANDS[0]?.value ?? "";
      }
    },
    [handleSend, selectFile, selectCommand, availableFiles, activeCommand, showFilePicker, showCommandPicker, pickerOpen, pickerItems],
  );

  const removeFile = useCallback((filename: string) => {
    setTargetFiles((prev) => prev.filter((f) => f !== filename));
  }, []);

  const removeCommand = useCallback(() => {
    setActiveCommand(undefined);
  }, []);

  const hasBadges = targetFiles.length > 0 || activeCommand;

  return (
    <div className="flex flex-col gap-2 border-t p-3">
      {hasBadges && (
        <div className="flex flex-wrap gap-1">
          {activeCommand && (
            <Badge data-testid="refine-command-badge" variant="default" className="gap-1 text-xs">
              /{activeCommand}
              <button
                type="button"
                onClick={removeCommand}
                className="ml-0.5 hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            </Badge>
          )}
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
          <Textarea
            ref={textareaRef}
            data-testid="refine-chat-input"
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={activeCommand ? `Describe what to ${activeCommand}...` : "Describe what to change..."}
            disabled={isRunning}
            className="min-h-10 resize-none"
            rows={1}
          />
          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              {showCommandPicker && (
                <div role="listbox" aria-label="Commands">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Commands</div>
                  {COMMANDS.map((cmd) => (
                    <div
                      key={cmd.value}
                      role="option"
                      aria-selected={pickerValue === cmd.value}
                      data-selected={pickerValue === cmd.value || undefined}
                      className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault(); // keep focus on textarea
                        selectCommand(cmd.value);
                      }}
                    >
                      <cmd.icon className="size-3.5" />
                      {cmd.label}
                    </div>
                  ))}
                </div>
              )}
              {showFilePicker && (
                <div role="listbox" aria-label="Files">
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Files</div>
                  {availableFiles.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">No files available</div>
                  ) : (
                    availableFiles.map((f) => (
                      <div
                        key={f}
                        role="option"
                        aria-selected={pickerValue === f}
                        data-selected={pickerValue === f || undefined}
                        className="relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[selected]:bg-accent data-[selected]:text-accent-foreground"
                        onMouseDown={(e) => {
                          e.preventDefault(); // keep focus on textarea
                          selectFile(f);
                        }}
                      >
                        {f}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <Button
          data-testid="refine-send-button"
          size="icon"
          onClick={handleSend}
          disabled={isRunning || (!text.trim() && !activeCommand)}
        >
          <SendHorizontal className="size-4" />
        </Button>
      </div>
    </div>
  );
}
