import { useState, useCallback, useEffect, useRef } from "react"
import { Loader2, AlertCircle, Download, CheckCircle2, CheckCheck } from "lucide-react"
import { toast } from "@/lib/toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { parseGitHubUrl, listGitHubPlugins, importMarketplacePluginToLibrary, listSkills } from "@/lib/tauri"
import type { AvailablePlugin, GitHubRepoInfo, SkillSummary, MarketplaceRegistry } from "@/lib/types"

interface GitHubImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
  registries: MarketplaceRegistry[]
  typeFilter?: string[]
  workspacePath?: string
}

type PluginState = "idle" | "importing" | "imported" | "exists"

type TabState = {
  loading: boolean
  error: string | null
  plugins: AvailablePlugin[]
  pluginStates: Map<string, PluginState>
  repoInfo: GitHubRepoInfo | null
}

const EMPTY_TAB: TabState = { loading: false, error: null, plugins: [], pluginStates: new Map(), repoInfo: null }

export default function GitHubImportDialog({
  open,
  onOpenChange,
  onImported,
  typeFilter: _typeFilter,
  registries,
  workspacePath,
}: GitHubImportDialogProps) {
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({})
  const [activeTab, setActiveTab] = useState<string>("")
  const activeTabRef = useRef<string>("")

  activeTabRef.current = activeTab

  const currentTab: TabState = tabStates[activeTab] ?? EMPTY_TAB
  const loading = currentTab.loading
  const plugins = currentTab.plugins
  const error = currentTab.error
  const pluginStates = currentTab.pluginStates
  const repoInfo = currentTab.repoInfo
  const topLevelDescription = registries.length === 0
    ? "No enabled registries. Configure registries in Settings -> Marketplace."
    : repoInfo
      ? `${plugins.length} plugin${plugins.length !== 1 ? "s" : ""} in ${repoInfo.owner}/${repoInfo.repo}`
      : "Browse and import plugins from your configured registries."

  function setPluginState(path: string, state: PluginState): void {
    const tabKey = activeTabRef.current
    setTabStates((prev) => {
      const tab = prev[tabKey] ?? EMPTY_TAB
      const newPluginStates = new Map(tab.pluginStates).set(path, state)
      return { ...prev, [tabKey]: { ...tab, pluginStates: newPluginStates } }
    })
  }

  const reset = useCallback(() => {
    setTabStates({})
    setActiveTab("")
  }, [])

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) reset()
      onOpenChange(isOpen)
    },
    [onOpenChange, reset]
  )

  const browseRegistry = useCallback(async (registry: MarketplaceRegistry) => {
    const tabKey = registry.source_url
    setTabStates(prev => ({
      ...prev,
      [tabKey]: { ...EMPTY_TAB, loading: true }
    }))
    try {
      const info = await parseGitHubUrl(registry.source_url.trim())
      const available = await listGitHubPlugins(
        info.owner,
        info.repo,
        info.branch,
        info.subpath ?? undefined,
      )

      const summaries = await listSkills(workspacePath ?? "", registry.source_url)
      const installedPluginNames = new Set(
        summaries
          .filter((s: SkillSummary) => s.skill_source === "marketplace")
          .map((s: SkillSummary) => s.plugin_display_name),
      )
      const preStates = new Map<string, PluginState>()
      for (const plugin of available) {
        if (installedPluginNames.has(plugin.name)) {
          preStates.set(plugin.path, "exists")
        }
      }

      const finalError = available.length === 0 ? "No plugins found in this marketplace." : null
      setTabStates(prev => ({
        ...prev,
        [tabKey]: { loading: false, error: finalError, plugins: available, pluginStates: preStates, repoInfo: info }
      }))
    } catch (err) {
      console.error("[github-import] Failed to browse registry:", err)
      setTabStates(prev => ({
        ...prev,
        [tabKey]: { ...EMPTY_TAB, error: err instanceof Error ? err.message : String(err) }
      }))
    }
  }, [workspacePath])

  useEffect(() => {
    if (open && registries.length > 0) {
      const first = registries[0]
      setActiveTab(first.source_url)
      browseRegistry(first)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspacePath])

  const handleTabChange = useCallback((tabKey: string) => {
    setActiveTab(tabKey)
    const registry = registries.find(r => r.source_url === tabKey)
    if (registry && !tabStates[tabKey]) {
      browseRegistry(registry)
    }
  }, [registries, tabStates, browseRegistry])

  const handleImportPlugin = useCallback(async (plugin: AvailablePlugin) => {
    setPluginState(plugin.path, "importing")
    try {
      const results = await importMarketplacePluginToLibrary(plugin.path, plugin.name, activeTabRef.current)
      const failures = results.filter((result) => !result.success)
      const nonExistsFailures = failures.filter((result) => {
        const error = result.error?.toLowerCase() ?? ""
        return !error.includes("already exists")
      })

      if (nonExistsFailures.length > 0) {
        setPluginState(plugin.path, "idle")
        toast.error(nonExistsFailures[0].error ?? `Failed to import plugin "${plugin.name}"`, {
          duration: Infinity,
          cause: nonExistsFailures[0].error,
          context: { operation: "github_import_marketplace_plugin_to_library", pluginPath: plugin.path },
        })
        return
      }

      const nextState: PluginState = results.some((result) => result.success) ? "imported" : "exists"
      setPluginState(plugin.path, nextState)
      if (nextState === "imported") {
        toast.success(`Imported plugin "${plugin.name}"`)
        await onImported()
      }
    } catch (err) {
      console.error("[github-import] import_marketplace_plugin_to_library failed:", err)
      setPluginState(plugin.path, "idle")
      toast.error(err instanceof Error ? err.message : String(err), {
        duration: Infinity,
        cause: err,
        context: { operation: "github_import_marketplace_plugin_to_library", pluginPath: plugin.path },
      })
    }
  }, [onImported])

  function renderPluginList() {
    if (loading) {
      return (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading plugins...</p>
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex flex-col items-center gap-3 py-8">
          <AlertCircle className="size-8 text-destructive" />
          <p className="text-sm text-destructive text-center">{error}</p>
          <Button variant="outline" onClick={() => {
            const registry = registries.find(r => r.source_url === activeTab)
            if (registry) browseRegistry(registry)
          }}>Retry</Button>
        </div>
      )
    }

    if (plugins.length > 0 && repoInfo) {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-y-auto rounded-md border">
            <table className="w-full text-sm table-fixed border-separate border-spacing-0">
              <colgroup>
                <col style={{ width: "56%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "14%" }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <th className="pl-4 py-1.5 text-left text-xs font-semibold text-muted-foreground border-b">Plugin</th>
                  <th className="pl-4 py-1.5 text-left text-xs font-semibold text-muted-foreground border-b">Version</th>
                  <th className="pl-4 py-1.5 text-left text-xs font-semibold text-muted-foreground border-b">Source</th>
                  <th className="pr-4 py-1.5 border-b" />
                </tr>
              </thead>
              <tbody>
                {plugins.map((plugin) => {
                  const state = pluginStates.get(plugin.path) ?? "idle"
                  const isImporting = state === "importing"
                  const isDisabled = state === "exists"

                  return (
                    <tr
                      key={plugin.path}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="pl-4 py-2.5 border-b overflow-hidden">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="truncate text-sm font-medium min-w-0">
                              {plugin.name}
                            </div>
                            {state === "imported" && (
                              <Badge variant="outline" className="shrink-0 text-xs" style={{ color: "var(--color-seafoam)", borderColor: "var(--color-seafoam)" }}>Imported</Badge>
                            )}
                            {state === "exists" && (
                              <Badge variant="secondary" className="shrink-0 text-xs text-muted-foreground">Installed</Badge>
                            )}
                          </div>
                          {plugin.description ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {plugin.description.length > 72 ? `${plugin.description.slice(0, 72)}...` : plugin.description}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="pl-4 py-2.5 border-b">
                        {plugin.version ? (
                          <Badge variant="outline" className="text-xs font-mono">{plugin.version}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="pl-4 py-2.5 border-b">
                        <span className="text-xs text-muted-foreground truncate">{plugin.path}</span>
                      </td>
                      <td className="pr-4 py-2.5 border-b">
                        <div className="flex items-center justify-end">
                          {state === "imported" ? (
                            <CheckCircle2 className="size-3.5" style={{ color: "var(--color-seafoam)" }} />
                          ) : isDisabled ? (
                            <CheckCheck className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-foreground"
                              disabled={isImporting}
                              aria-label={`Install ${plugin.name}`}
                              onClick={() => handleImportPlugin(plugin)}
                            >
                              {isImporting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Download className="size-3.5" />
                              )}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    return null
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Browse Marketplace</DialogTitle>
          <DialogDescription>{topLevelDescription}</DialogDescription>
        </DialogHeader>
        {registries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No enabled registries. Configure registries in Settings -&gt; Marketplace.
          </p>
        ) : (
          <Tabs value={activeTab} onValueChange={handleTabChange} className="flex flex-col flex-1 min-h-0">
            <TabsList className="w-full justify-start">
              {registries.map((r) => (
                <TabsTrigger key={r.source_url} value={r.source_url}>
                  {r.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {registries.map((r) => (
              <TabsContent key={r.source_url} value={r.source_url} className="flex-1 min-h-0 overflow-hidden flex flex-col mt-0">
                {activeTab === r.source_url && renderPluginList()}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}
