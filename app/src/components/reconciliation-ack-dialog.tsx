import { useEffect, useState, useCallback } from "react"
import { CheckCircle2, Info, Plus, Trash2, Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { resolveDiscovery } from "@/lib/tauri"
import type { DiscoveredSkill, DiscoveryResolutionAction } from "@/lib/types"
import pluginPaths from "../../plugin-paths.json"

interface ReconciliationAckDialogProps {
  notifications: string[]
  discoveredSkills: DiscoveredSkill[]
  open: boolean
  requireApply: boolean
  applying?: boolean
  onApply: () => void
  onCancel: () => void
}

type ResolutionState = "pending" | "resolving" | "resolved"

function discoveryKey(skill: DiscoveredSkill): string {
  return `${skill.plugin_slug ?? pluginPaths.default_plugin_slug}:${skill.name}`
}

function scenarioDescription(skill: DiscoveredSkill): string {
  if (skill.scenario === "9b") {
    return "Complete skill with all artifacts"
  }
  return "Skill with partial artifacts"
}

export default function ReconciliationAckDialog({
  notifications,
  discoveredSkills,
  open,
  requireApply,
  applying = false,
  onApply,
  onCancel,
}: ReconciliationAckDialogProps) {
  const [resolutions, setResolutions] = useState<Record<string, ResolutionState>>({})

  useEffect(() => {
    if (open) {
      console.warn(
        "[reconciliation-ack-dialog] showing %d notifications, %d discovered skills",
        notifications.length,
        discoveredSkills.length,
      )
      setResolutions(
        Object.fromEntries(discoveredSkills.map((s) => [discoveryKey(s), "pending" as ResolutionState])),
      )
    }
  }, [open, notifications.length, discoveredSkills])

  const allDiscoveriesResolved =
    discoveredSkills.length === 0 ||
    discoveredSkills.every((s) => resolutions[discoveryKey(s)] === "resolved")

  const handleResolve = useCallback(
    async (skill: DiscoveredSkill, action: DiscoveryResolutionAction) => {
      const key = discoveryKey(skill)
      console.log(
        "[reconciliation-ack] resolving discovery: skill=%s plugin=%s action=%s",
        skill.name,
        skill.plugin_slug ?? pluginPaths.default_plugin_slug,
        action,
      )
      setResolutions((prev) => ({ ...prev, [key]: "resolving" }))
      try {
        if (skill.plugin_slug) {
          await resolveDiscovery(skill.name, action, skill.plugin_slug)
        } else {
          await resolveDiscovery(skill.name, action)
        }
        setResolutions((prev) => ({ ...prev, [key]: "resolved" }))
      } catch (err) {
        console.error(
          "[reconciliation-ack] failed to resolve discovery: skill=%s plugin=%s action=%s error=%o",
          skill.name,
          skill.plugin_slug ?? pluginPaths.default_plugin_slug,
          action,
          err,
        )
        // Revert to pending so user can retry
        setResolutions((prev) => ({ ...prev, [key]: "pending" }))
      }
    },
    [],
  )

  return (
    <AlertDialog open={open}>
      <AlertDialogContent size="lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Info className="size-5" style={{ color: "var(--color-pacific)" }} />
            Startup Reconciliation
          </AlertDialogTitle>
          <AlertDialogDescription>
            {discoveredSkills.length > 0
              ? "The following changes were made and skills were discovered on disk. Please resolve all discovered skills before continuing."
              : "The following changes were made to keep the database in sync with files on disk."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ScrollArea className="max-h-[400px]">
          <div className="w-full min-w-0">
          {notifications.length > 0 && (
            <ul className="flex flex-col gap-2 py-2">
              {notifications.map((notification, i) => (
                <li
                  key={i}
                  className="break-words rounded-md border px-3 py-2 text-sm text-foreground"
                >
                  {notification}
                </li>
              ))}
            </ul>
          )}

          {discoveredSkills.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-sm font-medium text-foreground">
                Discovered Skills
              </h4>
              <ul className="flex flex-col gap-2">
                {discoveredSkills.map((skill) => {
                  const state = resolutions[discoveryKey(skill)] ?? "pending"
                  const isResolving = state === "resolving"
                  const isResolved = state === "resolved"
                  const addAction =
                    skill.scenario === "9b" ? "add-skill-builder" : "add-imported"

                  return (
                    <li
                      key={discoveryKey(skill)}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {skill.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {scenarioDescription(skill)}
                          {skill.plugin_display_name ? ` in ${skill.plugin_display_name}` : ""}
                        </p>
                      </div>

                      {isResolved ? (
                        <CheckCircle2 className="size-4 shrink-0" style={{ color: "var(--color-seafoam)" }} />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isResolving}
                            onClick={() => handleResolve(skill, addAction)}
                          >
                            {isResolving ? (
                              <Loader2 className="mr-1 size-3 animate-spin" />
                            ) : (
                              <Plus className="mr-1 size-3" />
                            )}
                            Add to Library
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isResolving}
                            onClick={() => handleResolve(skill, "remove")}
                          >
                            {isResolving ? (
                              <Loader2 className="mr-1 size-3 animate-spin" />
                            ) : (
                              <Trash2 className="mr-1 size-3" />
                            )}
                            Remove
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          </div>
        </ScrollArea>

        <AlertDialogFooter>
          {requireApply ? (
            <>
              <AlertDialogCancel onClick={onCancel}>
                Continue Without Applying
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onApply}
                disabled={!allDiscoveriesResolved || applying}
              >
                {applying ? "Applying..." : "Apply Reconciliation"}
              </AlertDialogAction>
            </>
          ) : (
            <AlertDialogAction onClick={onApply} disabled={!allDiscoveriesResolved}>
              Acknowledge
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
