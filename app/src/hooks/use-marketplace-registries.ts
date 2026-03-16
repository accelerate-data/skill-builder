import { useState, useCallback } from "react"
import { toast } from "@/lib/toast"
import type { MarketplaceRegistry } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"
import { checkMarketplaceUrl, parseGitHubUrl } from "@/lib/tauri"

/** Must match DEFAULT_MARKETPLACE_URL in app/src-tauri/src/commands/settings.rs */
export const DEFAULT_MARKETPLACE_URL = "hbanerjee74/skills"

export type RegistryTestResult = "checking" | "valid" | "invalid"

export function useMarketplaceRegistries(
  autoSave: (overrides: Record<string, unknown>) => void,
) {
  const marketplaceRegistries = useSettingsStore((s) => s.marketplaceRegistries)
  const [addingRegistry, setAddingRegistry] = useState(false)
  const [newRegistryUrl, setNewRegistryUrl] = useState("")
  const [newRegistryAdding, setNewRegistryAdding] = useState(false)
  const [registryTestState, setRegistryTestState] = useState<Record<string, RegistryTestResult>>({})

  const toggleRegistry = useCallback((sourceUrl: string, enabled: boolean) => {
    console.log(`[settings] registry toggled: url=${sourceUrl}, enabled=${enabled}`)
    const current = useSettingsStore.getState().marketplaceRegistries
    const updated = current.map(r =>
      r.source_url === sourceUrl ? { ...r, enabled } : r
    )
    autoSave({ marketplaceRegistries: updated })
  }, [autoSave])

  const removeRegistry = useCallback((registry: MarketplaceRegistry) => {
    console.log(`[settings] registry removed: name=${registry.name}`)
    const current = useSettingsStore.getState().marketplaceRegistries
    const updated = current.filter(r => r.source_url !== registry.source_url)
    autoSave({ marketplaceRegistries: updated })
  }, [autoSave])

  const testRegistry = useCallback(async (sourceUrl: string) => {
    setRegistryTestState((s) => ({ ...s, [sourceUrl]: "checking" }))
    try {
      await checkMarketplaceUrl(sourceUrl)
      setRegistryTestState((s) => ({ ...s, [sourceUrl]: "valid" }))
    } catch (err) {
      console.error(`[settings] registry test failed for ${sourceUrl}:`, err)
      setRegistryTestState((s) => ({ ...s, [sourceUrl]: "invalid" }))
    }
  }, [])

  const addRegistry = useCallback(async () => {
    const url = newRegistryUrl.trim()
    if (!url) return

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

    const currentRegistries = useSettingsStore.getState().marketplaceRegistries
    const isDuplicate = currentRegistries.some(r => {
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
    autoSave({ marketplaceRegistries: [...currentRegistries, entry] })
    setNewRegistryUrl("")
    setNewRegistryAdding(false)
    setAddingRegistry(false)
  }, [newRegistryUrl, autoSave])

  const cancelAdd = useCallback(() => {
    setNewRegistryUrl("")
    setNewRegistryAdding(false)
    setAddingRegistry(false)
  }, [])

  const isDuplicateUrl = newRegistryUrl.trim()
    ? marketplaceRegistries.some(r => r.source_url === newRegistryUrl.trim())
    : false

  return {
    marketplaceRegistries,
    registryTestState,
    addingRegistry,
    setAddingRegistry,
    newRegistryUrl,
    setNewRegistryUrl,
    newRegistryAdding,
    isDuplicateUrl,
    toggleRegistry,
    removeRegistry,
    testRegistry,
    addRegistry,
    cancelAdd,
  }
}
