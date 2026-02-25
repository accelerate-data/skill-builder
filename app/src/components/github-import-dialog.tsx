import { useState, useCallback, useEffect, useRef } from "react"
import { Loader2, AlertCircle, Download, RefreshCw, CheckCircle2, CheckCheck } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { parseGitHubUrl, listGitHubSkills, importGitHubSkills, importMarketplaceToLibrary, listWorkspaceSkills, getDashboardSkillNames, listSkills, checkSkillCustomized } from "@/lib/tauri"
import type { WorkspaceSkillImportRequest } from "@/lib/tauri"
import type { AvailableSkill, GitHubRepoInfo, SkillMetadataOverride, SkillSummary, WorkspaceSkill, MarketplaceRegistry } from "@/lib/types"
import { PURPOSE_OPTIONS } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"

/**
 * Returns true only if `a` is strictly greater than `b` by semver rules.
 * Returns false if either value is missing/empty or semver parsing fails.
 */
function semverGt(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || a === "") return false
  if (b == null || b === "") return false
  // Try semver parse: split "major.minor.patch" into numbers
  const parseSemver = (v: string): [number, number, number] | null => {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)/)
    if (!m) return null
    return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
  }
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa && pb) {
    if (pa[0] !== pb[0]) return pa[0] > pb[0]
    if (pa[1] !== pb[1]) return pa[1] > pb[1]
    return pa[2] > pb[2]
  }
  // Fallback: semver parsing failed on one or both sides — can't determine direction,
  // so don't show a spurious upgrade badge.
  return false
}

const FALLBACK_MODEL_OPTIONS = [
  { id: "haiku",  displayName: "Haiku — fastest, lowest cost" },
  { id: "sonnet", displayName: "Sonnet — balanced (default)" },
  { id: "opus",   displayName: "Opus — most capable" },
]

interface GitHubImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
  /** The marketplace registries to browse (from settings). */
  registries: MarketplaceRegistry[]
  /**
   * When set, only skills whose purpose is in this list are shown (skill-library mode only).
   * In settings-skills mode this filter is ignored — all skills with a name are shown.
   */
  typeFilter?: string[]
  /**
   * 'skill-library': calls importMarketplaceToLibrary (creates workflow_runs rows with source='marketplace')
   * 'settings-skills': calls importGitHubSkills (creates imported_skills rows)
   * Defaults to 'settings-skills' for backward compatibility.
   */
  mode?: 'skill-library' | 'settings-skills'
  /** Workspace path — required for skill-library mode to look up installed skill metadata. */
  workspacePath?: string
}

type SkillState = "idle" | "importing" | "imported" | "exists" | "same-version" | "upgrade"

/** Sentinel used in the model <Select> to represent "no override — use app default". */
const APP_DEFAULT_MODEL = "__app_default__"

interface EditFormState {
  name: string
  description: string
  version: string
  model: string
  argument_hint: string
  user_invocable: boolean
  disable_model_invocation: boolean
  /** settings-skills only — purpose slot to assign on import */
  settings_purpose: string | null
}

/** Renders a version upgrade banner when upgrading a settings-skills skill. */
function UpgradeBanner({
  editingSkill,
  editForm,
  skillStates,
  workspaceSkills,
}: {
  editingSkill: AvailableSkill | null
  editForm: EditFormState | null
  skillStates: Map<string, SkillState>
  workspaceSkills: WorkspaceSkill[]
}): React.ReactElement | null {
  if (!editingSkill || !editForm) return null
  if (skillStates.get(editingSkill.path) !== "upgrade") return null
  const installedVersion = workspaceSkills.find(
    (w) => w.skill_name === editingSkill.name || w.skill_name === editForm.name
  )?.version
  const newVersion = editingSkill.version
  if (!installedVersion || !newVersion || installedVersion === newVersion) return null
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      Upgrading: <span className="font-mono">{installedVersion}</span> &rarr; <span className="font-mono">{newVersion}</span>
    </div>
  )
}

type TabState = {
  loading: boolean
  error: string | null
  skills: AvailableSkill[]
  skillStates: Map<string, SkillState>
  repoInfo: GitHubRepoInfo | null
}

const EMPTY_TAB: TabState = { loading: false, error: null, skills: [], skillStates: new Map(), repoInfo: null }

export default function GitHubImportDialog({
  open,
  onOpenChange,
  onImported,
  registries,
  typeFilter,
  mode = 'settings-skills',
  workspacePath,
}: GitHubImportDialogProps) {
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({})
  const [activeTab, setActiveTab] = useState<string>("")
  // Ref kept in sync with activeTab so callbacks with stale closures can read the current value
  const activeTabRef = useRef<string>("")
  const availableModels = useSettingsStore((s) => s.availableModels)

  const [editingSkill, setEditingSkill] = useState<AvailableSkill | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)

  // Workspace skills for version comparison and purpose conflict detection (settings-skills only)
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkill[]>([])
  // Installed library skills for edit form pre-population fallback (skill-library only)
  const [installedLibrarySkills, setInstalledLibrarySkills] = useState<Map<string, SkillSummary>>(new Map())

  // Customization warning state (settings-skills upgrade path)
  const [pendingUpgradeSkill, setPendingUpgradeSkill] = useState<AvailableSkill | null>(null)
  const [showCustomizationWarning, setShowCustomizationWarning] = useState(false)

  // Keep the ref in sync synchronously whenever setActiveTab is called
  // (useEffect would delay by one render; direct assignment is safer for callbacks)
  activeTabRef.current = activeTab

  // Derived values from current tab
  const currentTab: TabState = tabStates[activeTab] ?? EMPTY_TAB
  const loading = currentTab.loading
  const skills = currentTab.skills
  const error = currentTab.error
  const skillStates = currentTab.skillStates
  const repoInfo = currentTab.repoInfo

  function setSkillState(path: string, state: SkillState): void {
    const tabKey = activeTabRef.current
    setTabStates((prev) => {
      const tab = prev[tabKey] ?? EMPTY_TAB
      const newSkillStates = new Map(tab.skillStates).set(path, state)
      return { ...prev, [tabKey]: { ...tab, skillStates: newSkillStates } }
    })
  }

  function closeEditForm(): void {
    setEditingSkill(null)
    setEditForm(null)
  }

  function updateField<K extends keyof EditFormState>(key: K, value: EditFormState[K]): void {
    setEditForm((f) => f ? { ...f, [key]: value } : f)
  }

  const reset = useCallback(() => {
    setTabStates({})
    setActiveTab("")
    closeEditForm()
    setWorkspaceSkills([])
    setInstalledLibrarySkills(new Map())
    setPendingUpgradeSkill(null)
    setShowCustomizationWarning(false)
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
      let available = await listGitHubSkills(
        info.owner,
        info.repo,
        info.branch,
        info.subpath ?? undefined,
      )
      if (mode === 'skill-library' && typeFilter && typeFilter.length > 0) {
        available = available.filter(
          (s) => s.purpose != null && typeFilter.includes(s.purpose)
        )
      }
      if (mode === 'settings-skills') {
        available = available.filter((s) => !!s.name)
      }

      const preStates = new Map<string, SkillState>()

      if (mode === 'skill-library') {
        const dashboardNames = await getDashboardSkillNames()
        const dashboardSet = new Set(dashboardNames)
        const summaries = await listSkills(workspacePath ?? '')
        const newSummaryMap = new Map(summaries.map((s) => [s.name, s]))
        setInstalledLibrarySkills(newSummaryMap)
        for (const skill of available) {
          if (dashboardSet.has(skill.name)) {
            const installedSummary = newSummaryMap.get(skill.name)
            const isUpgrade = semverGt(skill.version, installedSummary?.version)
            preStates.set(skill.path, isUpgrade ? "upgrade" : "same-version")
          }
        }
      } else {
        const installedSkills = await listWorkspaceSkills()
        setWorkspaceSkills(installedSkills)
        const installedVersionMap = new Map(installedSkills.map((s) => [s.skill_name, s.version]))
        for (const skill of available) {
          if (installedVersionMap.has(skill.name)) {
            const isUpgrade = semverGt(skill.version, installedVersionMap.get(skill.name))
            preStates.set(skill.path, isUpgrade ? "upgrade" : "same-version")
          }
        }
      }

      const finalError = available.length === 0 ? "No skills found in this repository." : null

      setTabStates(prev => ({
        ...prev,
        [tabKey]: { loading: false, error: finalError, skills: available, skillStates: preStates, repoInfo: info }
      }))
    } catch (err) {
      console.error("[github-import] Failed to browse registry:", err)
      setTabStates(prev => ({
        ...prev,
        [tabKey]: { ...EMPTY_TAB, error: err instanceof Error ? err.message : String(err) }
      }))
    }
  }, [typeFilter, workspacePath, mode])

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

  const openEditForm = useCallback((skill: AvailableSkill) => {
    setEditingSkill(skill)
    // Priority: remote skill frontmatter → existing installed version (for upgrade/exists)
    const state = skillStates.get(skill.path)
    const isUpgradeOrExists = state === 'upgrade' || state === 'exists'
    // settings-skills mode: fall back to workspace_skills row
    const ws = isUpgradeOrExists
      ? workspaceSkills.find((w) => w.skill_name === skill.name)
      : undefined
    // skill-library mode: fall back to installed SkillSummary for description/domain
    const lib = mode === 'skill-library' && isUpgradeOrExists
      ? installedLibrarySkills.get(skill.name)
      : undefined
    setEditForm({
      name: skill.name ?? ws?.skill_name ?? '',
      description: skill.description ?? lib?.description ?? ws?.description ?? '',
      version: skill.version ?? ws?.version ?? '1.0.0',
      model: skill.model ?? ws?.model ?? '',
      argument_hint: skill.argument_hint ?? ws?.argument_hint ?? '',
      user_invocable: (skill.user_invocable ?? ws?.user_invocable) ?? false,
      disable_model_invocation: (skill.disable_model_invocation ?? ws?.disable_model_invocation) ?? false,
      settings_purpose: ws?.purpose ?? null,
    })
  }, [mode, skillStates, workspaceSkills, installedLibrarySkills])

  /** Handle marketplace import result, returning true if the import succeeded. */
  function handleMarketplaceResult(path: string, results: { success: boolean; error: string | null }[]): boolean {
    const result = results[0]
    if (result?.success) return true
    const errMsg = result?.error ?? "Import failed"
    // "already exists on disk" is an expected duplicate -- show "In library".
    // Any other error (DB failure, network, etc.) is surfaced as a toast.
    if (errMsg.toLowerCase().includes("already exists")) {
      setSkillState(path, "exists")
    } else {
      console.error("[github-import] Import failed:", errMsg)
      setSkillState(path, "idle")
      toast.error(errMsg, { duration: Infinity })
    }
    return false
  }

  /** skill-library: edit metadata then import immediately via importMarketplaceToLibrary */
  const handleImportWithMetadata = useCallback(async (skill: AvailableSkill, form: EditFormState) => {
    const skillName = form.name || skill.name
    console.log(`[github-import] importing "${skillName}" from marketplace (path=${skill.path})`)
    setSkillState(skill.path, "importing")
    closeEditForm()
    try {
      const metadataOverride: SkillMetadataOverride = {
        name: form.name,
        description: form.description,
        purpose: null,
        version: form.version || null,
        model: form.model === APP_DEFAULT_MODEL ? "" : form.model,  // "" signals "App default" -> clear model from frontmatter
        argument_hint: form.argument_hint || null,
        user_invocable: form.user_invocable,
        disable_model_invocation: form.disable_model_invocation,
      }
      console.log(`[github-import] calling import_marketplace_to_library for "${skillName}"`)
      const results = await importMarketplaceToLibrary([skill.path], activeTabRef.current, { [skill.path]: metadataOverride })
      console.log(`[github-import] import_marketplace_to_library result:`, results)
      if (!handleMarketplaceResult(skill.path, results)) return
      setSkillState(skill.path, "imported")
      toast.success(`Imported "${skillName}"`)
      await onImported()
    } catch (err) {
      console.error("[github-import] import_marketplace_to_library failed:", err)
      setSkillState(skill.path, "idle")
      toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity })
    }
  }, [onImported])

  /** settings-skills: import with all metadata + purpose via importGitHubSkills */
  const handleSettingsImport = useCallback(async () => {
    if (!editingSkill || !editForm || !repoInfo) return
    const skillPath = editingSkill.path
    const skillName = editForm.name || editingSkill.name
    console.log(`[github-import] importing "${skillName}" from ${repoInfo.owner}/${repoInfo.repo} (path=${skillPath}, purpose=${editForm.settings_purpose ?? 'none'})`)
    setSkillState(skillPath, "importing")
    closeEditForm()
    try {
      const requests: WorkspaceSkillImportRequest[] = [{
        path: skillPath,
        purpose: editForm.settings_purpose ?? null,
        version: editingSkill.version ?? null,
        metadata_override: {
          name: editForm.name,
          description: editForm.description,
          purpose: 'skill-builder',
          version: editForm.version || null,
          model: editForm.model || null,
          argument_hint: editForm.argument_hint || null,
          user_invocable: editForm.user_invocable,
          disable_model_invocation: editForm.disable_model_invocation,
        },
      }]
      console.log(`[github-import] calling import_github_skills with ${requests.length} request(s)`)
      await importGitHubSkills(repoInfo.owner, repoInfo.repo, repoInfo.branch, requests, activeTabRef.current)
      console.log(`[github-import] "${skillName}" imported successfully`)
      setSkillState(skillPath, "imported")
      toast.success(`Imported "${skillName}"`)
      await onImported()
    } catch (err) {
      console.error("[github-import] import_github_skills failed:", err)
      setSkillState(skillPath, "idle")
      toast.error(err instanceof Error ? err.message : String(err), { duration: Infinity })
    }
  }, [editingSkill, editForm, repoInfo, onImported])

  /** Check if a purpose is already occupied by another active workspace skill */
  function getPurposeConflict(purpose: string | null, excludeSkillName?: string | null): WorkspaceSkill | null {
    if (!purpose) return null
    return workspaceSkills.find(
      (w) => w.is_active && w.purpose === purpose && w.skill_name !== excludeSkillName
    ) ?? null
  }

  const isMandatoryMissing = editForm
    ? !editForm.name.trim() || !editForm.description.trim() || !editForm.version.trim()
    : false

  // settings-skills: purpose conflict blocks import
  const purposeConflict = editForm && mode === 'settings-skills' && editingSkill
    ? getPurposeConflict(editForm.settings_purpose, editingSkill.name)
    : null

  function renderSkillList() {
    if (loading) {
      return (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading skills...</p>
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

    if (skills.length > 0 && repoInfo) {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Browse Marketplace</DialogTitle>
            <DialogDescription>
              {skills.length} skill{skills.length !== 1 ? "s" : ""} in {repoInfo.owner}/{repoInfo.repo}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto rounded-md border mt-2">
            <table className="w-full text-sm table-fixed border-separate border-spacing-0">
              <colgroup>
                <col style={{ width: "76%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-background">
                <tr>
                  <th className="pl-4 py-1.5 text-left text-xs font-semibold text-muted-foreground border-b">Name</th>
                  <th className="pl-4 py-1.5 text-left text-xs font-semibold text-muted-foreground border-b">Version</th>
                  <th className="pr-4 py-1.5 border-b" />
                </tr>
              </thead>
              <tbody>
                {skills.map((skill) => {
                  const state = skillStates.get(skill.path) ?? "idle"
                  const isImporting = state === "importing"
                  const isSameVersion = state === "same-version"
                  const isUpgrade = state === "upgrade"
                  const isExists = state === "exists"
                  const isDisabled = isExists || isSameVersion

                  return (
                    <tr
                      key={skill.path}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="pl-4 py-2.5 border-b overflow-hidden">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="truncate text-sm font-medium min-w-0">
                              {skill.plugin_name ? `${skill.plugin_name}:${skill.name}` : skill.name}
                            </div>
                            {state === "imported" && (
                              <Badge variant="outline" className="shrink-0 text-xs text-emerald-600 border-emerald-300 dark:text-emerald-400">Imported</Badge>
                            )}
                            {isSameVersion && (
                              <Badge variant="secondary" className="shrink-0 text-xs text-muted-foreground">Up to date</Badge>
                            )}
                            {isUpgrade && (
                              <Badge variant="outline" className="shrink-0 text-xs text-amber-600 border-amber-300">Update available</Badge>
                            )}
                            {isExists && (
                              <Badge variant="outline" className="shrink-0 text-xs text-muted-foreground">Already installed</Badge>
                            )}
                          </div>
                          {skill.description ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {skill.description.length > 60 ? `${skill.description.slice(0, 60)}...` : skill.description}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="pl-4 py-2.5 border-b">
                        {skill.version ? (
                          <Badge variant="outline" className="text-xs font-mono">{skill.version}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="pr-4 py-2.5 border-b">
                        <div className="flex items-center justify-end">
                          {state === "imported" ? (
                            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : isDisabled ? (
                            <CheckCheck className="size-3.5 text-muted-foreground" />
                          ) : (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                              disabled={isImporting}
                              aria-label={isUpgrade ? `Update ${skill.name}` : `Install ${skill.name}`}
                              onClick={async () => {
                                if (isUpgrade && mode === 'settings-skills') {
                                  // Check for customization before opening edit form
                                  try {
                                    const isCustomized = await checkSkillCustomized(skill.name)
                                    if (isCustomized) {
                                      setPendingUpgradeSkill(skill)
                                      setShowCustomizationWarning(true)
                                      return
                                    }
                                  } catch (err) {
                                    console.warn("[github-import] checkSkillCustomized failed:", err)
                                  }
                                }
                                openEditForm(skill)
                              }}
                            >
                              {isImporting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : isUpgrade ? (
                                <RefreshCw className="size-3.5" />
                              ) : (
                                <Download className="size-3.5" />
                              )}
                            </button>
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
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          {registries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No enabled registries. Configure registries in Settings → Marketplace.
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
                  {activeTab === r.source_url && renderSkillList()}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* skill-library: edit & import dialog */}
      <Dialog open={mode === 'skill-library' && editingSkill !== null} onOpenChange={(isOpen) => { if (!isOpen) closeEditForm() }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit &amp; Import Skill</DialogTitle>
            <DialogDescription>
              Review and edit the skill metadata before importing. Mandatory fields are required.
            </DialogDescription>
          </DialogHeader>
          {editForm && (
            <ScrollArea className="max-h-[75vh]">
              <div className="flex flex-col gap-4 pr-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-name">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit-name"
                    value={editForm.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    className={!editForm.name.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="Skill name"
                  />
                  {!editForm.name.trim() && (
                    <p className="text-xs text-destructive">Name is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-description">
                    Description <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="edit-description"
                    value={editForm.description}
                    onChange={(e) => updateField("description", e.target.value)}
                    className={!editForm.description.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="Describe what this skill does"
                    rows={3}
                  />
                  {!editForm.description.trim() && (
                    <p className="text-xs text-destructive">Description is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-version">
                    Version <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit-version"
                    value={editForm.version}
                    onChange={(e) => updateField("version", e.target.value)}
                    className={!editForm.version.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="e.g. 1.0.0"
                  />
                  {!editForm.version.trim() && (
                    <p className="text-xs text-destructive">Version is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-model">Model <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select
                    value={editForm.model}
                    onValueChange={(v) => updateField("model", v)}
                  >
                    <SelectTrigger id="edit-model">
                      <SelectValue placeholder="App default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={APP_DEFAULT_MODEL}>App default</SelectItem>
                      {(availableModels.length > 0 ? availableModels : FALLBACK_MODEL_OPTIONS).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-argument-hint">Argument Hint <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    id="edit-argument-hint"
                    value={editForm.argument_hint}
                    onChange={(e) => updateField("argument_hint", e.target.value)}
                    placeholder="Hint shown to users when invoking"
                  />
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="edit-user-invocable"
                      checked={editForm.user_invocable}
                      onCheckedChange={(checked) => updateField("user_invocable", !!checked)}
                    />
                    <Label htmlFor="edit-user-invocable" className="cursor-pointer">
                      User Invocable <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="edit-disable-model-invocation"
                      checked={editForm.disable_model_invocation}
                      onCheckedChange={(checked) => updateField("disable_model_invocation", !!checked)}
                    />
                    <Label htmlFor="edit-disable-model-invocation" className="cursor-pointer">
                      Disable Model Invocation <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeEditForm}>Cancel</Button>
            <Button
              disabled={isMandatoryMissing || editForm === null}
              onClick={() => {
                if (editingSkill && editForm) {
                  handleImportWithMetadata(editingSkill, editForm)
                }
              }}
            >
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* settings-skills: dedicated import dialog with all metadata + purpose */}
      <Dialog open={mode === 'settings-skills' && editingSkill !== null} onOpenChange={(isOpen) => { if (!isOpen) closeEditForm() }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingSkill && skillStates.get(editingSkill.path) === 'upgrade' ? 'Update Skill' : 'Import Skill'}
            </DialogTitle>
            <DialogDescription>
              Review and configure the skill before importing.
            </DialogDescription>
          </DialogHeader>
          <UpgradeBanner
            editingSkill={editingSkill}
            editForm={editForm}
            skillStates={skillStates}
            workspaceSkills={workspaceSkills}
          />
          {editForm && (
            <ScrollArea className="max-h-[75vh]">
              <div className="flex flex-col gap-4 pr-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="si-name">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="si-name"
                    value={editForm.name}
                    onChange={(e) => updateField("name", e.target.value)}
                    className={!editForm.name.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="Skill name"
                  />
                  {!editForm.name.trim() && (
                    <p className="text-xs text-destructive">Name is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="si-description">
                    Description <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="si-description"
                    value={editForm.description}
                    onChange={(e) => updateField("description", e.target.value)}
                    className={!editForm.description.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="Describe what this skill does"
                    rows={3}
                  />
                  {!editForm.description.trim() && (
                    <p className="text-xs text-destructive">Description is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="si-purpose">Purpose <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select
                    value={editForm.settings_purpose ?? "__none__"}
                    onValueChange={(v) => updateField("settings_purpose", v === "__none__" ? null : v)}
                  >
                    <SelectTrigger id="si-purpose">
                      <SelectValue placeholder="General Purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">General Purpose</SelectItem>
                      {PURPOSE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {purposeConflict && (
                    <p className="text-xs text-destructive">
                      Purpose already assigned to &ldquo;{purposeConflict.skill_name}&rdquo;
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="si-version">
                    Version <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="si-version"
                    value={editForm.version}
                    onChange={(e) => updateField("version", e.target.value)}
                    className={!editForm.version.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="e.g. 1.0.0"
                  />
                  {!editForm.version.trim() && (
                    <p className="text-xs text-destructive">Version is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="si-model">Model <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select
                    value={editForm.model || APP_DEFAULT_MODEL}
                    onValueChange={(v) => updateField("model", v === APP_DEFAULT_MODEL ? '' : v)}
                  >
                    <SelectTrigger id="si-model">
                      <SelectValue placeholder="App default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={APP_DEFAULT_MODEL}>App default</SelectItem>
                      {(availableModels.length > 0 ? availableModels : FALLBACK_MODEL_OPTIONS).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.displayName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="si-argument-hint">Argument Hint <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    id="si-argument-hint"
                    value={editForm.argument_hint}
                    onChange={(e) => updateField("argument_hint", e.target.value)}
                    placeholder="Hint shown to users when invoking"
                  />
                </div>

                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="si-user-invocable"
                      checked={editForm.user_invocable}
                      onCheckedChange={(checked) => updateField("user_invocable", !!checked)}
                    />
                    <Label htmlFor="si-user-invocable" className="cursor-pointer">
                      User Invocable <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="si-disable-model-invocation"
                      checked={editForm.disable_model_invocation}
                      onCheckedChange={(checked) => updateField("disable_model_invocation", !!checked)}
                    />
                    <Label htmlFor="si-disable-model-invocation" className="cursor-pointer">
                      Disable Model Invocation <span className="text-muted-foreground text-xs">(optional)</span>
                    </Label>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeEditForm}>Cancel</Button>
            <Button
              disabled={isMandatoryMissing || !!purposeConflict || editForm === null}
              onClick={handleSettingsImport}
            >
              Confirm Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Customization warning: shown when upgrading a skill that has been locally modified */}
      <AlertDialog open={showCustomizationWarning} onOpenChange={(open) => {
        if (!open) {
          setShowCustomizationWarning(false)
          setPendingUpgradeSkill(null)
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skill has been customized</AlertDialogTitle>
            <AlertDialogDescription>
              This skill has been modified since it was imported. Updating will replace your changes with the marketplace version. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowCustomizationWarning(false)
              setPendingUpgradeSkill(null)
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const skill = pendingUpgradeSkill
              setShowCustomizationWarning(false)
              setPendingUpgradeSkill(null)
              if (skill) openEditForm(skill)
            }}>
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
