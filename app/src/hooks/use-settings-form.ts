import { useState, useCallback, useRef } from "react"
import { toast } from "@/lib/toast"
import type { AppSettings, MarketplaceRegistry, ModelSettings } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"
import { updateUserSettings } from "@/lib/tauri"

const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  provider: "anthropic",
  model: null,
  api_key: null,
  base_url: null,
  api_version: null,
  temperature: null,
  max_output_tokens: null,
  timeout_seconds: 300,
  num_retries: 5,
  reasoning_effort: "auto",
  extra_headers: null,
  input_cost_per_token: null,
  output_cost_per_token: null,
  usage_id: "workflow",
}

/** Fields managed by the settings form (local state mirroring the store). */
export interface SettingsFormFields {
  modelSettings: ModelSettings
  skillsPath: string | null
  logLevel: string
  refinePromptSuggestions: boolean
  maxDimensions: number
  industry: string | null
  functionRole: string | null
  autoUpdate: boolean
}

export type ModelSettingsPatch = Partial<ModelSettings>

export type AutoSaveOverrides = Partial<
  Omit<SettingsFormFields, "modelSettings"> & {
    marketplaceRegistries: MarketplaceRegistry[]
  }
>

const SECRET_OVERRIDE_KEYS = new Set(["api_key", "modelSettings.api_key"])

function normalizeModelSettings(settings: Partial<ModelSettings>): ModelSettings {
  return {
    ...DEFAULT_MODEL_SETTINGS,
    ...settings,
    provider: settings.provider ?? DEFAULT_MODEL_SETTINGS.provider,
    model: settings.model?.trim() || null,
    api_key: settings.api_key?.trim() || null,
    base_url: settings.base_url?.trim() || null,
    api_version: settings.api_version?.trim() || null,
    reasoning_effort: settings.reasoning_effort ?? DEFAULT_MODEL_SETTINGS.reasoning_effort,
    usage_id: settings.usage_id?.trim() || DEFAULT_MODEL_SETTINGS.usage_id,
  }
}

function formatSavedOverride(key: string, value: unknown): string {
  if (key === "modelSettings" && value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([modelKey, modelValue]) =>
        formatSavedOverride(`modelSettings.${modelKey}`, modelValue),
      )
      .join(", ")
  }
  if (SECRET_OVERRIDE_KEYS.has(key)) {
    return `${key}=${value ? "[redacted]" : "null"}`
  }
  return `${key}=${value}`
}

export function useSettingsForm() {
  const store = useSettingsStore.getState()
  const setStoreSettings = useSettingsStore((s) => s.setSettings)

  const [modelSettings, setModelSettings] = useState<ModelSettings>(
    normalizeModelSettings(store.modelSettings),
  )
  const [skillsPath, setSkillsPath] = useState<string | null>(store.skillsPath ?? null)
  const [logLevel, setLogLevel] = useState(store.logLevel ?? "info")
  const [refinePromptSuggestions, setRefinePromptSuggestions] = useState(store.refinePromptSuggestions ?? true)
  const [maxDimensions, setMaxDimensions] = useState(store.maxDimensions ?? 5)
  const [industry, setIndustry] = useState(store.industry ?? "")
  const [functionRole, setFunctionRole] = useState(store.functionRole ?? "")
  const [autoUpdate, setAutoUpdate] = useState(store.autoUpdate ?? false)
  const [saved, setSaved] = useState(false)

  const workspacePath = store.workspacePath ?? null
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const persistSettings = useCallback(async (
    overrides: AutoSaveOverrides,
    nextModelSettings: ModelSettings,
    logOverrides: Record<string, unknown> = overrides,
  ) => {
    const resolve = <T,>(key: keyof AutoSaveOverrides, fallback: T): T =>
      overrides[key] !== undefined ? (overrides[key] as T) : fallback

    const storeSnapshot = useSettingsStore.getState()

    const settings: AppSettings = {
      model_settings: nextModelSettings,
      workspace_path: workspacePath,
      skills_path: resolve("skillsPath", skillsPath),
      log_level: resolve("logLevel", logLevel),
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
      await updateUserSettings(settings)
      setModelSettings(nextModelSettings)
      setStoreSettings({
        modelSettings: nextModelSettings,
        workspacePath: settings.workspace_path,
        skillsPath: settings.skills_path,
        logLevel: settings.log_level,
        refinePromptSuggestions: settings.refine_prompt_suggestions,
        maxDimensions: settings.max_dimensions,
        marketplaceRegistries: settings.marketplace_registries,
        industry: settings.industry,
        functionRole: settings.function_role,
        autoUpdate: settings.auto_update,
      })
      const changedEntries: Array<[string, unknown]> = [
        ...Object.entries(overrides),
        ...Object.entries(logOverrides).filter(([k]) => !(k in overrides)),
      ]
      const changed = changedEntries
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => formatSavedOverride(k, v))
        .filter(Boolean)
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
  }, [skillsPath, logLevel, refinePromptSuggestions, maxDimensions, industry, functionRole, autoUpdate, workspacePath, setStoreSettings])

  const autoSave = useCallback(async (overrides: AutoSaveOverrides) => {
    await persistSettings(overrides, modelSettings)
  }, [modelSettings, persistSettings])

  const updateModelSettings = useCallback((patch: ModelSettingsPatch) => {
    setModelSettings((current) => normalizeModelSettings({ ...current, ...patch }))
  }, [])

  const saveModelSettings = useCallback(async (patch: ModelSettingsPatch) => {
    const nextModelSettings = normalizeModelSettings({ ...modelSettings, ...patch })
    await persistSettings({}, nextModelSettings, { modelSettings: patch })
  }, [modelSettings, persistSettings])

  return {
    modelSettings,
    updateModelSettings,
    saveModelSettings,
    skillsPath,
    setSkillsPath,
    logLevel,
    setLogLevel,
    refinePromptSuggestions,
    setRefinePromptSuggestions,
    maxDimensions,
    setMaxDimensions,
    industry,
    setIndustry,
    functionRole,
    setFunctionRole,
    autoUpdate,
    setAutoUpdate,
    autoSave,
    saved,
  }
}
