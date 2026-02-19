import { useEffect, useRef, useCallback } from "react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface GhostFieldProps {
  suggestion: string | null
  value: string
  onChange: (value: string) => void
  onAccept?: (suggestion: string) => void
}

type GhostInputProps = GhostFieldProps &
  Omit<React.ComponentProps<"input">, "value" | "onChange">

type GhostTextareaProps = GhostFieldProps &
  Omit<React.ComponentProps<"textarea">, "value" | "onChange">

function shouldShowGhost(value: string, suggestion: string | null): boolean {
  return value === "" && suggestion != null && suggestion !== ""
}

/**
 * Attaches a native DOM capture-phase keydown listener to intercept Tab
 * before Radix Dialog's focus trap (a native bubble-phase listener on the
 * dialog content node) can steal focus. React's onKeyDownCapture is
 * insufficient — it fires within React's delegation system at the root,
 * which is reached after Radix's native listener.
 */
function useNativeTabCapture(
  ref: React.RefObject<HTMLElement | null>,
  showGhost: boolean,
  suggestion: string | null,
  onAccept: ((suggestion: string) => void) | undefined,
) {
  const stateRef = useRef({ showGhost, suggestion, onAccept })
  stateRef.current = { showGhost, suggestion, onAccept }

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const handler = (e: KeyboardEvent) => {
      const { showGhost: sg, suggestion: s, onAccept: oa } = stateRef.current
      if (e.key === "Tab" && !e.shiftKey && sg && s && oa) {
        e.preventDefault()
        e.stopPropagation()
        oa(s)
      }
    }

    el.addEventListener("keydown", handler, true) // true = capture phase
    return () => el.removeEventListener("keydown", handler, true)
  }, [ref])
}

export function GhostInput({
  suggestion,
  value,
  onChange,
  onAccept,
  className,
  ...inputProps
}: GhostInputProps) {
  const showGhost = shouldShowGhost(value, suggestion)
  const inputRef = useRef<HTMLInputElement>(null)
  useNativeTabCapture(inputRef, showGhost, suggestion, onAccept)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      inputProps.onKeyDown?.(e)
    },
    [inputProps.onKeyDown],
  )

  return (
    <div className="relative">
      {showGhost && (
        <div className="absolute inset-px px-3 py-1 text-sm text-muted-foreground/50 italic pointer-events-none truncate">
          {suggestion}
        </div>
      )}
      <Input
        {...inputProps}
        ref={inputRef}
        className={cn(showGhost && "placeholder:text-transparent", className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}

export function GhostTextarea({
  suggestion,
  value,
  onChange,
  onAccept,
  className,
  ...textareaProps
}: GhostTextareaProps) {
  const showGhost = shouldShowGhost(value, suggestion)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useNativeTabCapture(textareaRef, showGhost, suggestion, onAccept)

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      textareaProps.onKeyDown?.(e)
    },
    [textareaProps.onKeyDown],
  )

  return (
    <div className="relative">
      {showGhost && (
        <div className="absolute inset-px px-3 py-2 text-sm text-muted-foreground/50 italic pointer-events-none whitespace-pre-wrap overflow-hidden">
          {suggestion}
        </div>
      )}
      <Textarea
        {...textareaProps}
        ref={textareaRef}
        className={cn(showGhost && "placeholder:text-transparent", className)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
