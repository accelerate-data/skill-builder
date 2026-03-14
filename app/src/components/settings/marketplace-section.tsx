import { useState } from "react"
import { toast } from "@/lib/toast"
import { Loader2, CheckCircle2, XCircle, PlugZap, Trash2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { MarketplaceRegistry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { checkMarketplaceUrl, parseGitHubUrl } from "@/lib/tauri"

/** Must match DEFAULT_MARKETPLACE_URL in app/src-tauri/src/commands/settings.rs */
const DEFAULT_MARKETPLACE_URL = "hbanerjee74/skills"

type RegistryTestState = "checking" | "valid" | "invalid" | undefined

function RegistryTestIcon({ state }: { state: RegistryTestState }) {
  if (state === "checking") return <Loader2 className="size-3.5 animate-spin" />
  if (state === "valid") return <CheckCircle2 className="size-3.5" style={{ color: "var(--color-seafoam)" }} />
  if (state === "invalid") return <XCircle className="size-3.5 text-destructive" />
  return <PlugZap className="size-3.5" />
}

interface MarketplaceSectionProps {
  autoUpdate: boolean
  setAutoUpdate: (v: boolean) => void
  autoSave: (overrides: Record<string, unknown>) => void
}

export function MarketplaceSection({
  autoUpdate,
  setAutoUpdate,
  autoSave,
}: MarketplaceSectionProps) {
  const marketplaceRegistries = useSettingsStore((s) => s.marketplaceRegistries)
  const [addingRegistry, setAddingRegistry] = useState(false)
  const [newRegistryUrl, setNewRegistryUrl] = useState("")
  const [newRegistryAdding, setNewRegistryAdding] = useState(false)
  const [registryTestState, setRegistryTestState] = useState<Record<string, "checking" | "valid" | "invalid">>({})

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Registries</CardTitle>
          <CardDescription>
            GitHub repositories to browse for marketplace skills. The Vibedata Skills registry is built-in and cannot be removed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-md border">
            <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
              <span className="flex-1">Registry</span>
              <span className="w-16">Enabled</span>
              <span className="w-16" />
            </div>
            {marketplaceRegistries.map((registry) => {
              const isDefault = registry.source_url === DEFAULT_MARKETPLACE_URL
              const testState = registryTestState[registry.source_url]
              const isFailed = testState === "invalid"
              return (
                <div
                  key={registry.source_url}
                  className={cn(
                    "flex items-center gap-4 border-b last:border-b-0 px-4 py-2 hover:bg-muted/30 transition-colors",
                    isFailed && "opacity-60"
                  )}
                >
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <span className="truncate text-sm font-mono text-muted-foreground">{registry.source_url}</span>
                    {isDefault && (
                      <Badge variant="secondary" className="text-xs shrink-0">Built-in</Badge>
                    )}
                  </div>
                  <div className="w-16 shrink-0 flex items-center gap-2">
                    <Switch
                      checked={registry.enabled && !isFailed}
                      disabled={isFailed}
                      onCheckedChange={(checked) => {
                        console.log(`[settings] registry toggled: url=${registry.source_url}, enabled=${checked}`)
                        const current = useSettingsStore.getState().marketplaceRegistries
                        const updated = current.map(r =>
                          r.source_url === registry.source_url ? { ...r, enabled: checked } : r
                        )
                        autoSave({ marketplaceRegistries: updated })
                      }}
                      aria-label={`Toggle ${registry.source_url}`}
                    />
                  </div>
                  <div className="w-16 shrink-0 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={`Test ${registry.source_url}`}
                      title="Check marketplace.json is reachable"
                      disabled={testState === "checking"}
                      onClick={async () => {
                        setRegistryTestState((s) => ({ ...s, [registry.source_url]: "checking" }))
                        try {
                          await checkMarketplaceUrl(registry.source_url)
                          setRegistryTestState((s) => ({ ...s, [registry.source_url]: "valid" }))
                        } catch (err) {
                          console.error(`[settings] registry test failed for ${registry.source_url}:`, err)
                          setRegistryTestState((s) => ({ ...s, [registry.source_url]: "invalid" }))
                        }
                      }}
                    >
                      <RegistryTestIcon state={testState} />
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${registry.name}`}
                        onClick={() => {
                          console.log(`[settings] registry removed: name=${registry.name}`)
                          const current = useSettingsStore.getState().marketplaceRegistries
                          const updated = current.filter(r => r.source_url !== registry.source_url)
                          autoSave({ marketplaceRegistries: updated })
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {!addingRegistry ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setAddingRegistry(true)}
            >
              <Plus className="size-4" />
              Add registry
            </Button>
          ) : (
            <div className="flex flex-col gap-3 rounded-md border p-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-registry-url">GitHub repository</Label>
                <Input
                  id="new-registry-url"
                  placeholder="owner/repo or owner/repo#branch"
                  value={newRegistryUrl}
                  onChange={(e) => setNewRegistryUrl(e.target.value)}
                />
                {newRegistryUrl.trim() && marketplaceRegistries.some(r => r.source_url === newRegistryUrl.trim()) && (
                  <p className="text-xs text-destructive">This registry is already added.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={
                    !newRegistryUrl.trim() ||
                    newRegistryAdding ||
                    marketplaceRegistries.some(r => r.source_url === newRegistryUrl.trim())
                  }
                  onClick={async () => {
                    const url = newRegistryUrl.trim()
                    setNewRegistryAdding(true)

                    let info: Awaited<ReturnType<typeof parseGitHubUrl>>
                    try {
                      info = await parseGitHubUrl(url)
                    } catch {
                      toast.error("Invalid GitHub repository format — use owner/repo or owner/repo#branch.", { duration: Infinity })
                      setNewRegistryAdding(false)
                      return
                    }
                    const canonicalUrl = info.branch === "main"
                      ? `${info.owner}/${info.repo}`
                      : `${info.owner}/${info.repo}#${info.branch}`

                    const isDuplicate = marketplaceRegistries.some(r => {
                      const m = r.source_url.match(/^([^/]+)\/([^/#]+)/)
                      return m && m[1] === info.owner && m[2] === info.repo
                    })
                    if (isDuplicate) {
                      toast.error(`${info.owner}/${info.repo} is already in your registries.`, { duration: Infinity })
                      setNewRegistryAdding(false)
                      return
                    }

                    let name: string
                    try {
                      name = await checkMarketplaceUrl(url)
                    } catch (err) {
                      console.error(`[settings] add registry check failed for ${url}:`, err)
                      setNewRegistryAdding(false)
                      toast.error("Could not reach marketplace.json — check it is a public GitHub repository with a .claude-plugin/marketplace.json file.", { duration: Infinity })
                      return
                    }
                    console.log(`[settings] registry added: name=${name}, url=${canonicalUrl}`)
                    const entry: MarketplaceRegistry = {
                      name,
                      source_url: canonicalUrl,
                      enabled: true,
                    }
                    autoSave({ marketplaceRegistries: [...marketplaceRegistries, entry] })
                    setNewRegistryUrl("")
                    setNewRegistryAdding(false)
                    setAddingRegistry(false)
                  }}
                >
                  {newRegistryAdding ? <Loader2 className="size-3.5 animate-spin" /> : "Add"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setNewRegistryUrl("")
                    setNewRegistryAdding(false)
                    setAddingRegistry(false)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-update</CardTitle>
          <CardDescription>
            Automatically apply updates from all enabled registries at startup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Switch
            id="auto-update"
            checked={autoUpdate}
            onCheckedChange={(checked) => { setAutoUpdate(checked); autoSave({ autoUpdate: checked }); }}
            aria-label="Enable auto-update"
          />
        </CardContent>
      </Card>
    </div>
  )
}
