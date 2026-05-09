import { useCallback, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "@/lib/toast"
import { FolderInput, Package, FolderTree, Trash2, Lock, LockOpen } from "lucide-react"
import { Github } from "@/components/icons/github"
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSettingsStore } from "@/stores/settings-store"
import { usePluginsQuery } from "@/lib/queries/plugins"
import { useInvalidateSkillQueries } from "@/lib/queries/skills"
import GitHubImportDialog from "@/components/github-import-dialog"
import { ImportSkillDialog } from "@/components/import-skill-dialog"
import { CreatePluginDialog } from "@/components/create-plugin-dialog"
import { deletePlugin, parseSkillFile, setPluginUpgradeLock } from "@/lib/tauri"
import type { LibraryPlugin, SkillFileMeta } from "@/lib/types"

export function ImportedSkillsTab() {
  const { data: plugins = [], isFetching, refetch: refetchPlugins } = usePluginsQuery()
  const invalidateSkillQueries = useInvalidateSkillQueries()
  const refreshPlugins = useCallback(async () => {
    await Promise.all([
      refetchPlugins(),
      invalidateSkillQueries(),
    ])
  }, [invalidateSkillQueries, refetchPlugins])
  const showLoading = isFetching && plugins.length === 0

  const marketplaceRegistries = useSettingsStore((s) => s.marketplaceRegistries)
  const hasEnabledRegistry = marketplaceRegistries.some(r => r.enabled)
  const [showGitHubImport, setShowGitHubImport] = useState(false)
  const [createPluginOpen, setCreatePluginOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState("")
  const [importMeta, setImportMeta] = useState<SkillFileMeta>({
    name: null, description: null, version: null,
    user_invocable: null, disable_model_invocation: null,
  })

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

  const handleToggleLock = useCallback(async (plugin: LibraryPlugin) => {
    const newLocked = !plugin.upgrade_locked
    try {
      await setPluginUpgradeLock(plugin.slug, newLocked)
      await refreshPlugins()
      toast.success(
        newLocked
          ? `Upgrades locked for "${plugin.display_name}"`
          : `Upgrades unlocked for "${plugin.display_name}"`,
      )
    } catch (err) {
      toast.error(
        `Failed to ${newLocked ? "lock" : "unlock"} plugin: ${err instanceof Error ? err.message : String(err)}`,
        { duration: Infinity },
      )
    }
  }, [refreshPlugins])

  const handleDeletePlugin = useCallback(async (plugin: LibraryPlugin) => {
    const toastId = toast.loading(`Deleting plugin "${plugin.display_name}"...`)
    try {
      await deletePlugin(plugin.slug)
      await refreshPlugins()
      toast.success(`Deleted plugin "${plugin.display_name}"`, { id: toastId })
    } catch (err) {
      toast.error(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: Infinity },
      )
    }
  }, [refreshPlugins])

  const displayPlugins = plugins.filter((p) => !p.is_default)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          className="w-40"
          onClick={() => setCreatePluginOpen(true)}
        >
          <FolderTree className="size-4" />
          Create Plugin
        </Button>
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
        <Button variant="outline" className="w-36" onClick={handleImport}>
          <FolderInput className="size-4" />
          Upload
        </Button>
      </div>

      {showLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 rounded-md border px-4 py-3">
              <Skeleton className="h-4 w-40 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-8" />
            </div>
          ))}
        </div>
      ) : displayPlugins.length === 0 ? (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
              <Package className="size-6 text-muted-foreground" />
            </div>
            <CardTitle>No plugins</CardTitle>
            <CardDescription>
              Browse the marketplace or upload a skill package to get started.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Version</th>
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium w-8" />
            </tr>
          </thead>
          <tbody>
            {displayPlugins.map((plugin) => (
              <tr key={plugin.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                <td className="py-2.5 pr-4">
                  <div className="font-medium">{plugin.display_name}</div>
                  <div className="text-xs text-muted-foreground">{plugin.slug}</div>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground font-mono text-xs">
                  {plugin.version ?? "\u2014"}
                </td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground truncate max-w-[200px]">
                  {plugin.source_url ?? plugin.source_type}
                </td>
                <td className="py-2.5 pr-4">
                  {plugin.upgrade_locked ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs font-medium transition-colors"
                      style={{ color: "var(--color-amber, #d97706)" }}
                      title="Upgrades disabled — skill was edited locally. Click to unlock."
                      onClick={() => handleToggleLock(plugin)}
                    >
                      <Lock className="size-3" />
                      Upgrades locked
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{"\u2014"}</span>
                  )}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-2">
                    {plugin.upgrade_locked && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={`Unlock upgrades for ${plugin.display_name}`}
                        title="Unlock upgrades"
                        onClick={() => handleToggleLock(plugin)}
                      >
                        <LockOpen className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Delete ${plugin.display_name}`}
                      onClick={() => handleDeletePlugin(plugin)}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <GitHubImportDialog
        open={showGitHubImport}
        onOpenChange={setShowGitHubImport}
        onImported={refreshPlugins}
        registries={marketplaceRegistries.filter(r => r.enabled)}
      />

      <ImportSkillDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        filePath={importFile}
        meta={importMeta}
        onImported={refreshPlugins}
      />


      <CreatePluginDialog
        open={createPluginOpen}
        onOpenChange={setCreatePluginOpen}
        onCreated={refreshPlugins}
      />
    </div>
  )
}
