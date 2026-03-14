import { useEffect, useCallback, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "@/lib/toast"
import { FolderInput, Package, Github, Trash2 } from "lucide-react"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useImportedSkillsStore } from "@/stores/imported-skills-store"
import { useSettingsStore } from "@/stores/settings-store"
import GitHubImportDialog from "@/components/github-import-dialog"
import { ImportSkillDialog } from "@/components/import-skill-dialog"
import { parseSkillFile } from "@/lib/tauri"
import type { ImportedSkill } from "@/lib/types"
import type { SkillFileMeta } from "@/lib/types"

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)

    if (diffMinutes < 1) return "just now"
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return ""
  }
}

function sourceLabel(skill: ImportedSkill): string {
  if (skill.marketplace_source_url) return "marketplace"
  return "file"
}

export function ImportedSkillsTab() {
  const {
    skills,
    isLoading,
    fetchSkills,
    deleteSkill,
  } = useImportedSkillsStore()

  const marketplaceRegistries = useSettingsStore((s) => s.marketplaceRegistries)
  const hasEnabledRegistry = marketplaceRegistries.some(r => r.enabled)
  const [showGitHubImport, setShowGitHubImport] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState("")
  const [importMeta, setImportMeta] = useState<SkillFileMeta>({
    name: null, description: null, version: null, model: null,
    argument_hint: null, user_invocable: null, disable_model_invocation: null,
  })

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const handleImport = useCallback(async () => {
    const filePath = await open({
      title: "Import Skill Package",
      filters: [{ name: "Skill Package", extensions: ["skill", "zip"] }],
    })
    if (!filePath) return

    try {
      const meta = await parseSkillFile(filePath)
      setImportFile(filePath)
      setImportMeta(meta)
      setImportOpen(true)
    } catch (err) {
      console.error("[imported-skills] parse failed:", err)
      toast.error(
        "Import failed: not a valid skill package.",
        { duration: Infinity, cause: err, context: { operation: "imported_skills_import_parse" } }
      )
    }
  }, [])

  const handleDelete = useCallback(
    async (skill: ImportedSkill) => {
      const toastId = toast.loading(`Deleting "${skill.skill_name}"...`)
      try {
        await deleteSkill(skill.skill_id)
        toast.success(`Deleted "${skill.skill_name}"`, { id: toastId })
      } catch (err) {
        console.error("[imported-skills] delete failed:", err)
        toast.error(`Delete failed: ${err instanceof Error ? err.message : String(err)}`, {
          id: toastId,
          duration: Infinity,
          cause: err,
          context: { operation: "imported_skills_delete", skillId: skill.skill_id },
        })
      }
    },
    [deleteSkill]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="w-36"
          onClick={() => setShowGitHubImport(true)}
          disabled={!hasEnabledRegistry}
          title={!hasEnabledRegistry ? "Enable a marketplace registry in Settings \u2192 Marketplace" : undefined}
        >
          <Github className="size-4" />
          Marketplace
        </Button>
        <Button className="w-36" onClick={handleImport}>
          <FolderInput className="size-4" />
          Import
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
            <CardTitle>No imported skills</CardTitle>
            <CardDescription>
              Import a .skill package or browse the marketplace to add skills.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="rounded-md border">
          <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span className="flex-1">Name</span>
            <span className="w-24">Version</span>
            <span className="w-24">Source</span>
            <span className="w-28">Imported</span>
            <span className="w-8" />
          </div>
          {skills.map((skill) => (
            <div
              key={skill.skill_id}
              className="flex items-center gap-4 border-b last:border-b-0 px-4 py-2 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{skill.skill_name}</span>
                  {skill.is_bundled && (
                    <Badge variant="secondary" className="text-xs">Built-in</Badge>
                  )}
                </div>
                {skill.description && (
                  <div className="text-xs text-muted-foreground">{skill.description}</div>
                )}
              </div>
              <div className="w-24 shrink-0">
                {skill.version ? (
                  <Badge variant="outline" className="text-xs font-mono">{skill.version}</Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">&mdash;</span>
                )}
              </div>
              <div className="w-24 shrink-0">
                <span className="text-xs text-muted-foreground">{sourceLabel(skill)}</span>
              </div>
              <div className="w-28 shrink-0">
                <span className="text-xs text-muted-foreground">{formatRelativeTime(skill.imported_at)}</span>
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
        registries={marketplaceRegistries.filter(r => r.enabled)}
      />

      <ImportSkillDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        filePath={importFile}
        meta={importMeta}
        onImported={fetchSkills}
      />
    </div>
  )
}
