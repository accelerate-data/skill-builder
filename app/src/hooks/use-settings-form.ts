import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "@/lib/toast"
import type { AppSettings, MarketplaceRegistry } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"
import { listModels, saveSettings } from "@/lib/tauri"

/** Fields managed by the settings form (local state mirroring the store). */
export interface SettingsFormFields {
  apiKey: string | null
  skillsPath: string | null
  preferredModel: string
  logLevel: string
  extendedThinking: boolean
  interleavedThinkingBeta: boolean
  sdkEffort: string | null
  refinePromptSuggestions: boolean
  maxDimensions: number
  industry: string | null
  functionRole: string | null
  autoUpdate: boolean
}

export type AutoSaveOverrides = Partial<
  SettingsFormFields & { marketplaceRegistries: MarketplaceRegistry[] }
>

export function useSettingsForm() {
  const store = useSettingsStore.getState()
  const setStoreSettings = useSettingsStore((s) => s.setSettings)

  // Local form fields — initialized from store snapshot
  const [apiKey, setApiKey] = useState<string | null>(store.anthropicApiKey ?? null)
  const [skillsPath, setSkillsPath] = useState<string | null>(store.skillsPath ?? null)
  const [preferredModel, setPreferredModel] = useState(store.preferredModel ?? "")
  const [logLevel, setLogLevel] = useState(store.logLevel ?? "info")
  const [extendedThinking, setExtendedThinking] = useState(store.extendedThinking ?? false)
  const [interleavedThinkingBeta, setInterleavedThinkingBeta] = useState(store.interleavedThinkingBeta ?? true)
  const [sdkEffort, setSdkEffort] = useState<string>(store.sdkEffort ?? "")
  const [refinePromptSuggestions, setRefinePromptSuggestions] = useState(store.refinePromptSuggestions ?? true)
  const [maxDimensions, setMaxDimensions] = useState(store.maxDimensions ?? 5)
  const [industry, setIndustry] = useState(store.industry ?? "")
  const [functionRole, setFunctionRole] = useState(store.functionRole ?? "")
  const [autoUpdate, setAutoUpdate] = useState(store.autoUpdate ?? false)
  const [saved, setSaved] = useState(false)

  const workspacePath = store.workspacePath ?? null

  // Use a ref for the saved timeout so we can clear it
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Fetch models on mount if API key exists
  useEffect(() => {
    const key = apiKey || useSettingsStore.getState().anthropicApiKey
    if (key) {
      listModels(key)
        .then((models) => setStoreSettings({ availableModels: models ?? [] }))
        .catch((err) => console.warn("[settings] Could not fetch model list:", err))
    }
  }, [])

  const autoSave = useCallback(async (overrides: AutoSaveOverrides) => {
    // Read current local state via closure, apply overrides
    const resolve = <T,>(key: keyof AutoSaveOverrides, fallback: T): T =>
      overrides[key] !== undefined ? (overrides[key] as T) : fallback

    const storeSnapshot = useSettingsStore.getState()

    const settings: AppSettings = {
      anthropic_api_key: resolve("apiKey", apiKey),
      workspace_path: workspacePath,
      skills_path: resolve("skillsPath", skillsPath),
      preferred_model: resolve("preferredModel", preferredModel),
      log_level: resolve("logLevel", logLevel),
      extended_context: false,
      extended_thinking: resolve("extendedThinking", extendedThinking),
      interleaved_thinking_beta: resolve("interleavedThinkingBeta", interleavedThinkingBeta),
      sdk_effort: resolve("sdkEffort", sdkEffort) || null,
      fallback_model: resolve("preferredModel", preferredModel),
      refine_prompt_suggestions: resolve("refinePromptSuggestions", refinePromptSuggestions),
      max_dimensions: resolve("maxDimensions", maxDimensions),
      splash_shown: false,
      github_oauth_token: storeSnapshot.githubOauthToken ?? null,
      github_user_login: storeSnapshot.githubUserLogin ?? null,
      github_user_avatar: storeSnapshot.githubUserAvatar ?? null,
      github_user_email: storeSnapshot.githubUserEmail ?? null,
      marketplace_registries: resolve("marketplaceRegistries", storeSnapshot.marketplaceRegistries ?? []),
      marketplace_initialized: storeSnapshot.marketplaceInitialized ?? false,
      industry: resolve("industry", industry) || null,
      function_role: resolve("functionRole", functionRole) || null,
      dashboard_view_mode: storeSnapshot.dashboardViewMode ?? null,
      auto_update: resolve("autoUpdate", autoUpdate),
    }

    try {
      await saveSettings(settings)
      setStoreSettings({
        anthropicApiKey: settings.anthropic_api_key,
        workspacePath: settings.workspace_path,
        skillsPath: settings.skills_path,
        preferredModel: settings.preferred_model,
        logLevel: settings.log_level,
        extendedThinking: settings.extended_thinking,
        interleavedThinkingBeta: settings.interleaved_thinking_beta,
        sdkEffort: settings.sdk_effort,
        refinePromptSuggestions: settings.refine_prompt_suggestions,
        maxDimensions: settings.max_dimensions,
        marketplaceRegistries: settings.marketplace_registries,
        industry: settings.industry,
        functionRole: settings.function_role,
        autoUpdate: settings.auto_update,
      })
      const changed = Object.entries(overrides)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
      console.log(`[settings] Saved: ${changed}`)
      setSaved(true)
      clearTimeout(savedTimeoutRef.current)
      savedTimeoutRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error("settings: auto-save failed", err)
      toast.error(`Failed to save: ${err}`, {
        duration: Infinity,
        cause: err,
        context: { operation: "settings_auto_save" },
      })
    }
  }, [apiKey, skillsPath, preferredModel, logLevel, extendedThinking, interleavedThinkingBeta, sdkEffort, refinePromptSuggestions, maxDimensions, industry, functionRole, autoUpdate, workspacePath, setStoreSettings])

  return {
    // Fields + setters
    apiKey, setApiKey,
    skillsPath, setSkillsPath,
    preferredModel, setPreferredModel,
    logLevel, setLogLevel,
    extendedThinking, setExtendedThinking,
    interleavedThinkingBeta, setInterleavedThinkingBeta,
    sdkEffort, setSdkEffort,
    refinePromptSuggestions, setRefinePromptSuggestions,
    maxDimensions, setMaxDimensions,
    industry, setIndustry,
    functionRole, setFunctionRole,
    autoUpdate, setAutoUpdate,
    // Shared
    autoSave,
    saved,
  }
}
