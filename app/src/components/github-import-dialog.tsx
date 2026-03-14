import { useState, useCallback, useEffect, useRef } from "react"
import { Loader2, AlertCircle, Download, RefreshCw, CheckCircle2, CheckCheck } from "lucide-react"
import { toast } from "@/lib/toast"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { parseGitHubUrl, listGitHubSkills, importMarketplaceToLibrary, getDashboardSkillNames, listSkills } from "@/lib/tauri"
import type { AvailableSkill, GitHubRepoInfo, SkillMetadataOverride, SkillSummary, MarketplaceRegistry } from "@/lib/types"

function semverGt(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || a === "") return false
  if (b == null || b === "") return false
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
  return false
}

interface GitHubImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
  registries: MarketplaceRegistry[]
  typeFilter?: string[]
  workspacePath?: string
}

type SkillState = "idle" | "importing" | "imported" | "exists" | "same-version" | "upgrade"

interface EditFormState {
  name: string
  description: string
  version: string
  argument_hint: string
  user_invocable: boolean
  disable_model_invocation: boolean
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
  workspacePath,
}: GitHubImportDialogProps) {
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({})
  const [activeTab, setActiveTab] = useState<string>("")
  const activeTabRef = useRef<string>("")

  const [editingSkill, setEditingSkill] = useState<AvailableSkill | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)

  const [installedLibrarySkills, setInstalledLibrarySkills] = useState<Map<string, SkillSummary>>(new Map())

  activeTabRef.current = activeTab

  const currentTab: TabState = tabStates[activeTab] ?? EMPTY_TAB
  const loading = currentTab.loading
  const skills = currentTab.skills
  const error = currentTab.error
  const skillStates = currentTab.skillStates
  const repoInfo = currentTab.repoInfo
  const topLevelDescription = registries.length === 0
    ? "No enabled registries. Configure registries in Settings \u2192 Marketplace."
    : repoInfo
      ? `${skills.length} skill${skills.length !== 1 ? "s" : ""} in ${repoInfo.owner}/${repoInfo.repo}`
      : "Browse and import skills from your configured registries."

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
    setInstalledLibrarySkills(new Map())
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
      if (typeFilter && typeFilter.length > 0) {
        available = available.filter(
          (s) => s.purpose != null && typeFilter.includes(s.purpose)
        )
      }

      const preStates = new Map<string, SkillState>()
      const availableByName = new Map(available.map((s) => [s.name, s]))

      const [dashboardNames, summaries] = await Promise.all([
        getDashboardSkillNames(),
        listSkills(workspacePath ?? '', registry.source_url),
      ])
      const dashboardSet = new Set(dashboardNames)
      const newSummaryMap = new Map(summaries.map((s) => [s.name, s]))
      setInstalledLibrarySkills(newSummaryMap)
      for (const [installedName, installedSummary] of newSummaryMap) {
        if (!dashboardSet.has(installedName)) continue
        const listed = availableByName.get(installedName)
        if (!listed) continue
        const isUpgrade = semverGt(listed.version, installedSummary?.version)
        preStates.set(listed.path, isUpgrade ? "upgrade" : "same-version")
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
  }, [typeFilter, workspacePath])

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
    const state = skillStates.get(skill.path)
    const isUpgradeOrExists = state === 'upgrade' || state === 'exists'
    const lib = isUpgradeOrExists
      ? installedLibrarySkills.get(skill.name)
      : undefined
    setEditForm({
      name: skill.name ?? '',
      description: skill.description ?? lib?.description ?? '',
      version: skill.version ?? '1.0.0',
      argument_hint: skill.argument_hint ?? '',
      user_invocable: skill.user_invocable ?? false,
      disable_model_invocation: skill.disable_model_invocation ?? false,
    })
  }, [skillStates, installedLibrarySkills])

  function handleMarketplaceResult(path: string, results: { success: boolean; error: string | null }[]): boolean {
    const result = results[0]
    if (result?.success) return true
    const errMsg = result?.error ?? "Import failed"
    if (errMsg.toLowerCase().includes("already exists")) {
      setSkillState(path, "exists")
    } else {
      console.error("[github-import] Import failed:", errMsg)
      setSkillState(path, "idle")
      toast.error(errMsg, {
        duration: Infinity,
        cause: errMsg,
        context: { operation: "github_import_marketplace_result", skillPath: path },
      })
    }
    return false
  }

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
      toast.error(err instanceof Error ? err.message : String(err), {
        duration: Infinity,
        cause: err,
        context: { operation: "github_import_marketplace_to_library", skillPath: skill.path },
      })
    }
  }, [onImported])

  const isMandatoryMissing = editForm
    ? !editForm.name.trim() || !editForm.description.trim() || !editForm.version.trim()
    : false

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
          <div className="flex-1 min-h-0 overflow-y-auto rounded-md border">
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
                              <Badge variant="outline" className="shrink-0 text-xs" style={{ color: "var(--color-seafoam)", borderColor: "var(--color-seafoam)" }}>Imported</Badge>
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
                            <CheckCircle2 className="size-3.5" style={{ color: "var(--color-seafoam)" }} />
                          ) : isDisabled ? (
                            <CheckCheck className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="text-muted-foreground hover:text-foreground"
                              disabled={isImporting}
                              aria-label={isUpgrade ? `Update ${skill.name}` : `Install ${skill.name}`}
                              onClick={() => openEditForm(skill)}
                            >
                              {isImporting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : isUpgrade ? (
                                <RefreshCw className="size-3.5" />
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
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Browse Marketplace</DialogTitle>
            <DialogDescription>{topLevelDescription}</DialogDescription>
          </DialogHeader>
          {registries.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No enabled registries. Configure registries in Settings &rarr; Marketplace.
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

      <Dialog open={editingSkill !== null} onOpenChange={(isOpen) => { if (!isOpen) closeEditForm() }}>
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
    </>
  )
}
