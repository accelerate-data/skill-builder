import { useEffect, useCallback, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "@/lib/toast"
import { FolderInput, Package, Trash2, FolderTree, ArrowRightLeft, Undo2 } from "lucide-react"
import { Github } from "@/components/icons/github"
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
import { createPluginFromSkills, moveSkillToPlugin, parseSkillFile, removeSkillFromPlugin } from "@/lib/tauri"
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
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<Set<string>>(new Set())
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
        await deleteSkill(skill.skill_id, fetchSkills)
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
    [deleteSkill, fetchSkills]
  )

  const groupedSkills = skills.reduce<Record<string, ImportedSkill[]>>((acc, skill) => {
    const group = skill.plugin_display_name ?? "No Plugin"
    acc[group] ??= []
    acc[group].push(skill)
    return acc
  }, {})

  const pluginOptions = Array.from(
    new Map(
      skills
        .filter((skill) => !skill.is_default_plugin && skill.plugin_slug)
        .map((skill) => [skill.plugin_slug as string, skill.plugin_display_name ?? skill.plugin_slug as string])
    ).entries()
  )

  const toggleSelected = (skill: ImportedSkill) => {
    const key = skill.library_key ?? `imported:${skill.skill_id}`
    setSelectedSkillKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleCreatePlugin = useCallback(async () => {
    const pluginName = window.prompt("New plugin name")
    if (!pluginName) return
    const skillKeys = Array.from(selectedSkillKeys)
    if (skillKeys.length === 0) return
    const toastId = toast.loading(`Creating plugin "${pluginName}"...`)
    try {
      await createPluginFromSkills(pluginName, skillKeys)
      setSelectedSkillKeys(new Set())
      await fetchSkills()
      toast.success(`Created plugin "${pluginName}"`, { id: toastId })
    } catch (err) {
      toast.error(`Create plugin failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId })
    }
  }, [fetchSkills, selectedSkillKeys])

  const handleMoveToPlugin = useCallback(async (skill: ImportedSkill) => {
    const suggestion = pluginOptions.map(([slug, label]) => `${label} (${slug})`).join(", ")
    const pluginSlug = window.prompt(`Move to plugin slug${suggestion ? `\nAvailable: ${suggestion}` : ""}`)
    if (!pluginSlug) return
    const toastId = toast.loading(`Moving "${skill.skill_name}"...`)
    try {
      await moveSkillToPlugin(skill.library_key ?? `imported:${skill.skill_id}`, pluginSlug)
      await fetchSkills()
      toast.success(`Moved "${skill.skill_name}"`, { id: toastId })
    } catch (err) {
      toast.error(`Move failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId })
    }
  }, [fetchSkills, pluginOptions])

  const handleRemoveFromPlugin = useCallback(async (skill: ImportedSkill) => {
    const toastId = toast.loading(`Removing "${skill.skill_name}" from plugin...`)
    try {
      await removeSkillFromPlugin(skill.library_key ?? `imported:${skill.skill_id}`)
      await fetchSkills()
      toast.success(`Removed "${skill.skill_name}" from plugin`, { id: toastId })
    } catch (err) {
      toast.error(`Remove failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId })
    }
  }, [fetchSkills])

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
          Upload
        </Button>
        <Button
          variant="secondary"
          className="w-40"
          disabled={selectedSkillKeys.size === 0}
          onClick={handleCreatePlugin}
        >
          <FolderTree className="size-4" />
          Create Plugin
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
        <div className="space-y-4">
          {Object.entries(groupedSkills).map(([pluginName, pluginSkills]) => (
            <div key={pluginName} className="rounded-md border">
              <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
                <div>
                  <div className="text-sm font-medium">{pluginName}</div>
                  <div className="text-xs text-muted-foreground">
                    {pluginSkills[0]?.is_default_plugin ? "Synthetic default plugin" : `${pluginSkills.length} skill${pluginSkills.length === 1 ? "" : "s"}`}
                  </div>
                </div>
              </div>
              {pluginSkills.map((skill) => {
                const skillKey = skill.library_key ?? `imported:${skill.skill_id}`
                const selectable = !!skill.is_default_plugin
                return (
                  <div
                    key={skill.skill_id}
                    className="flex items-center gap-4 border-b last:border-b-0 px-4 py-2 hover:bg-muted/30 transition-colors"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      disabled={!selectable}
                      checked={selectedSkillKeys.has(skillKey)}
                      onChange={() => toggleSelected(skill)}
                    />
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
                    <div className="flex items-center gap-1">
                      {skill.is_default_plugin ? (
                        <Button variant="ghost" size="icon-sm" onClick={() => handleMoveToPlugin(skill)} title="Move to plugin">
                          <ArrowRightLeft className="size-4" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="icon-sm" onClick={() => handleRemoveFromPlugin(skill)} title="Remove from plugin">
                          <Undo2 className="size-4" />
                        </Button>
                      )}
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
                )
              })}
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
