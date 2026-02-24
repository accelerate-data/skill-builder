import { useEffect, useCallback, useState, useRef } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Upload, Package, Github, Trash2, Tag } from "lucide-react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useImportedSkillsStore } from "@/stores/imported-skills-store"
import type { WorkspaceSkill } from "@/stores/imported-skills-store"
import { useSettingsStore } from "@/stores/settings-store"
import GitHubImportDialog from "@/components/github-import-dialog"
import { setWorkspaceSkillPurpose } from "@/lib/tauri"
import { PURPOSE_OPTIONS } from "@/lib/types"

export function SkillsLibraryTab() {
  const {
    skills,
    isLoading,
    fetchSkills,
    uploadSkill,
    toggleActive,
    deleteSkill,
  } = useImportedSkillsStore()

  const marketplaceUrl = useSettingsStore((s) => s.marketplaceUrl)
  const pendingUpgrade = useSettingsStore((s) => s.pendingUpgradeOpen)
  const [showGitHubImport, setShowGitHubImport] = useState(false)
  // Track which skill's purpose popover is open
  const [purposePopoverSkillId, setPurposePopoverSkillId] = useState<string | null>(null)
  // Ref to avoid re-triggering after clearing pendingUpgrade
  const prevPendingRef = useRef(pendingUpgrade)

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  useEffect(() => {
    if (pendingUpgrade?.mode === 'settings-skills') {
      setShowGitHubImport(true)
      useSettingsStore.getState().setPendingUpgradeOpen(null)
    }
    prevPendingRef.current = pendingUpgrade
  }, [pendingUpgrade])

  const handleUpload = useCallback(async () => {
    const filePath = await open({
      title: "Import Skill Package",
      filters: [{ name: "Skill Package", extensions: ["skill", "zip"] }],
    })
    if (!filePath) return

    const toastId = toast.loading("Importing skill...")
    try {
      const skill = await uploadSkill(filePath)
      toast.success(`Imported "${skill.skill_name}"`, { id: toastId })
    } catch (err) {
      console.error("[skills-library] upload failed:", err)
      const message = err instanceof Error ? err.message : String(err)
      const missingPrefix = "missing_mandatory_fields:"
      if (message.startsWith(missingPrefix)) {
        const fields = message.slice(missingPrefix.length).split(",").filter(Boolean)
        toast.error(
          `Import failed: SKILL.md is missing required fields: ${fields.join(", ")}.`,
          { id: toastId, duration: Infinity }
        )
      } else {
        toast.error(`Import failed: ${message}`, { id: toastId, duration: Infinity })
      }
    }
  }, [uploadSkill])

  const handleToggle = useCallback(
    async (skill: WorkspaceSkill) => {
      try {
        await toggleActive(skill.skill_id, !skill.is_active)
        toast.success(
          !skill.is_active ? `"${skill.skill_name}" activated` : `"${skill.skill_name}" deactivated`,
          { duration: 1500 }
        )
      } catch (err) {
        console.error("[skills-library] toggle failed:", err)
        toast.error(`Failed to toggle: ${err instanceof Error ? err.message : String(err)}`, { duration: Infinity })
      }
    },
    [toggleActive]
  )

  const handleDelete = useCallback(
    async (skill: WorkspaceSkill) => {
      const toastId = toast.loading(`Deleting "${skill.skill_name}"...`)
      try {
        await deleteSkill(skill.skill_id)
        toast.success(`Deleted "${skill.skill_name}"`, { id: toastId })
      } catch (err) {
        console.error("[skills-library] delete failed:", err)
        toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId, duration: Infinity })
      }
    },
    [deleteSkill]
  )

  const handleSetPurpose = useCallback(
    async (skill: WorkspaceSkill, purpose: string | null) => {
      // Conflict check: if setting a purpose, check if another active skill already has it
      if (purpose) {
        const conflict = skills.find(
          (s) => s.skill_id !== skill.skill_id && s.is_active && s.purpose === purpose
        )
        if (conflict) {
          toast.error(`Purpose "${purpose}" is already occupied by "${conflict.skill_name}"`)
          return
        }
      }
      try {
        await setWorkspaceSkillPurpose(skill.skill_id, purpose)
        toast.success(
          purpose
            ? `Purpose set to "${purpose}" for "${skill.skill_name}"`
            : `Purpose cleared for "${skill.skill_name}"`,
          { duration: 1500 }
        )
        setPurposePopoverSkillId(null)
        await fetchSkills()
      } catch (err) {
        console.error("[skills-library] set purpose failed:", err)
        toast.error(`Failed to set purpose: ${err instanceof Error ? err.message : String(err)}`, { duration: Infinity })
      }
    },
    [skills, fetchSkills]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="w-36"
          onClick={() => setShowGitHubImport(true)}
          disabled={!marketplaceUrl}
          title={!marketplaceUrl ? "Configure marketplace URL in Settings → GitHub" : undefined}
        >
          <Github className="size-4" />
          Marketplace
        </Button>
        <Button className="w-36" onClick={handleUpload}>
          <Upload className="size-4" />
          Upload Skill
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-md border px-4 py-3">
              <Skeleton className="h-4 w-40 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-8" />
            </div>
          ))}
        </div>
      ) : skills.length === 0 ? (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
              <Package className="size-6 text-muted-foreground" />
            </div>
            <CardTitle>No workspace skills</CardTitle>
            <CardDescription>
              Upload a .skill package or browse the marketplace to add skills.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="rounded-md border">
          <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span className="flex-1">Name</span>
            <span className="w-24">Version</span>
            <span className="w-20">Active</span>
            <span className="w-8" />
          </div>
          {skills.map((skill) => (
            <div
              key={skill.skill_id}
              className="flex items-center gap-4 border-b last:border-b-0 px-4 py-2 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="truncate text-sm font-medium">{skill.skill_name}</span>
                  {skill.is_bundled && (
                    <Badge variant="secondary" className="text-xs">Built-in</Badge>
                  )}
                  {skill.purpose && (
                    <Badge variant="outline" className="text-xs capitalize">
                      {skill.purpose}
                    </Badge>
                  )}
                  <Popover
                    open={purposePopoverSkillId === skill.skill_id}
                    onOpenChange={(isOpen) => {
                      setPurposePopoverSkillId(isOpen ? skill.skill_id : null)
                    }}
                  >
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`Set purpose for ${skill.skill_name}`}
                        title={skill.purpose ? "Change purpose" : "Set purpose"}
                      >
                        <Tag className="size-3" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-48 p-1" align="start">
                      <div className="flex flex-col gap-0.5">
                        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Set purpose</p>
                        {PURPOSE_OPTIONS.map((opt) => {
                          const conflict = skills.find(
                            (s) => s.skill_id !== skill.skill_id && s.is_active && s.purpose === opt.value
                          )
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={!!conflict}
                              className="flex items-center justify-between rounded px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-left"
                              onClick={() => handleSetPurpose(skill, opt.value)}
                            >
                              <span>{opt.label}</span>
                              {conflict && (
                                <span className="text-muted-foreground text-xs ml-1 truncate">({conflict.skill_name})</span>
                              )}
                            </button>
                          )
                        })}
                        {skill.purpose && (
                          <>
                            <div className="my-0.5 border-t" />
                            <button
                              type="button"
                              className="rounded px-2 py-1.5 text-xs hover:bg-muted text-muted-foreground text-left"
                              onClick={() => handleSetPurpose(skill, null)}
                            >
                              Clear purpose
                            </button>
                          </>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                {skill.description && (
                  <div className="text-xs text-muted-foreground">{skill.description}</div>
                )}
              </div>
              <div className="w-24 shrink-0">
                {skill.version ? (
                  <Badge variant="outline" className="text-xs font-mono">{skill.version}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
              <div className="w-20 shrink-0 flex items-center gap-2">
                <Switch
                  checked={skill.is_active}
                  onCheckedChange={() => handleToggle(skill)}
                  aria-label={`Toggle ${skill.skill_name}`}
                />
              </div>
              <div className="w-8 shrink-0 flex items-center justify-end">
                {!skill.is_bundled && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    aria-label={`Delete ${skill.skill_name}`}
                    onClick={() => handleDelete(skill)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <GitHubImportDialog
        open={showGitHubImport}
        onOpenChange={setShowGitHubImport}
        onImported={fetchSkills}
        mode="settings-skills"
        url={marketplaceUrl ?? ""}
      />
    </div>
  )
}
