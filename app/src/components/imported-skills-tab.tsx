import { useEffect, useCallback, useState } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "@/lib/toast"
import { FolderInput, Package, FolderTree } from "lucide-react"
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
import { useSettingsStore } from "@/stores/settings-store"
import GitHubImportDialog from "@/components/github-import-dialog"
import { ImportSkillDialog } from "@/components/import-skill-dialog"
import { CreatePluginDialog } from "@/components/create-plugin-dialog"
import { listPlugins, parseSkillFile } from "@/lib/tauri"
import type { LibraryPlugin, SkillFileMeta } from "@/lib/types"

export function ImportedSkillsTab() {
  const [plugins, setPlugins] = useState<LibraryPlugin[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const marketplaceRegistries = useSettingsStore((s) => s.marketplaceRegistries)
  const hasEnabledRegistry = marketplaceRegistries.some(r => r.enabled)
  const [showGitHubImport, setShowGitHubImport] = useState(false)
  const [createPluginOpen, setCreatePluginOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState("")
  const [importMeta, setImportMeta] = useState<SkillFileMeta>({
    name: null, description: null, version: null, model: null,
    argument_hint: null, user_invocable: null, disable_model_invocation: null,
  })

  const fetchPluginList = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await listPlugins()
      setPlugins(result)
    } catch (err) {
      console.error("event=fetch_plugins_failed error=%s", err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPluginList()
  }, [fetchPluginList])

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

  // Filter out the synthetic no-plugin from the display list
  const displayPlugins = plugins.filter((p) => !p.is_default)

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
          onClick={() => setCreatePluginOpen(true)}
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
      ) : displayPlugins.length === 0 ? (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
              <Package className="size-6 text-muted-foreground" />
            </div>
            <CardTitle>No plugins</CardTitle>
            <CardDescription>
              Browse the marketplace or upload a plugin package to get started.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-1">
          {displayPlugins.map((plugin) => (
            <div
              key={plugin.id}
              className="flex items-center gap-4 rounded-md border px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <FolderTree className="size-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{plugin.display_name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{plugin.slug}</span>
              </div>
              {plugin.version && (
                <Badge variant="outline" className="text-xs font-mono">{plugin.version}</Badge>
              )}
              <Badge variant="secondary" className="text-xs">{plugin.source_type}</Badge>
            </div>
          ))}
        </div>
      )}

      <GitHubImportDialog
        open={showGitHubImport}
        onOpenChange={setShowGitHubImport}
        onImported={fetchPluginList}
        registries={marketplaceRegistries.filter(r => r.enabled)}
      />

      <ImportSkillDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        filePath={importFile}
        meta={importMeta}
        onImported={fetchPluginList}
      />

      <CreatePluginDialog
        open={createPluginOpen}
        onOpenChange={setCreatePluginOpen}
        onCreated={fetchPluginList}
      />
    </div>
  )
}
