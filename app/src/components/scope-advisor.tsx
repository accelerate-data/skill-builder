import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { UseScopeAdvisorReturn } from "@/hooks/use-scope-advisor"

interface ScopeAdvisorProps {
  advisorState: UseScopeAdvisorReturn
  onChipSelect: (name: string, description: string) => void
}

export default function ScopeAdvisor({ advisorState, onChipSelect }: ScopeAdvisorProps) {
  const {
    status,
    suggestions,
    currentChipIndex,
    copiedIndices,
    panelExpanded,
    onChipClick,
    onCopyOne,
    onCopyAll,
    onTogglePanel,
  } = advisorState

  if (status === "idle") return null

  if (status === "loading") return null

  if (status === "focused") {
    return (
      <p className="text-xs text-emerald-600 dark:text-emerald-400">
        ✓ This skill looks focused.
      </p>
    )
  }

  if (status === "too-broad") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          <span>⚠ This skill might be too broad. Consider splitting into more focused skills.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-2 h-6 w-6 p-0 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30"
            onClick={onTogglePanel}
            aria-label={panelExpanded ? "Collapse suggestions" : "Expand suggestions"}
          >
            {panelExpanded ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </Button>
        </div>

        {panelExpanded && (
          <div className="flex flex-col gap-2 rounded-md border bg-card p-3">
            <div className="flex flex-col gap-2">
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  className="flex items-start justify-between gap-2 rounded-md border bg-background px-3 py-2"
                >
                  <button
                    type="button"
                    className="flex flex-1 flex-col gap-0.5 text-left"
                    onClick={() => {
                      const result = onChipClick(i)
                      onChipSelect(result.name, result.description)
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono font-medium">{s.name}</code>
                      {currentChipIndex === i && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                          current
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{s.description}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => onCopyOne(i)}
                  >
                    {copiedIndices.has(i) ? "Copied" : "Copy"}
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t pt-2">
              <span className="text-xs text-muted-foreground">
                Gerund names: <code className="font-mono">verb-ing + object</code>
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onCopyAll}
              >
                Copy all
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}
