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
import { cn } from "@/lib/utils"
import { useMarketplaceRegistries, DEFAULT_MARKETPLACE_URL, type RegistryTestResult } from "@/hooks/use-marketplace-registries"

function RegistryTestIcon({ state }: { state: RegistryTestResult | undefined }) {
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
  const reg = useMarketplaceRegistries(autoSave)

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
            {reg.marketplaceRegistries.map((registry) => {
              const isDefault = registry.source_url === DEFAULT_MARKETPLACE_URL
              const testState = reg.registryTestState[registry.source_url]
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
                      onCheckedChange={(checked) => reg.toggleRegistry(registry.source_url, checked)}
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
                      onClick={() => reg.testRegistry(registry.source_url)}
                    >
                      <RegistryTestIcon state={testState} />
                    </button>
                    {!isDefault && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Remove ${registry.name}`}
                        onClick={() => reg.removeRegistry(registry)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {!reg.addingRegistry ? (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => reg.setAddingRegistry(true)}
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
                  value={reg.newRegistryUrl}
                  onChange={(e) => reg.setNewRegistryUrl(e.target.value)}
                />
                {reg.isDuplicateUrl && (
                  <p className="text-xs text-destructive">This registry is already added.</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!reg.newRegistryUrl.trim() || reg.newRegistryAdding || reg.isDuplicateUrl}
                  onClick={reg.addRegistry}
                >
                  {reg.newRegistryAdding ? <Loader2 className="size-3.5 animate-spin" /> : "Add"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={reg.cancelAdd}
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
