import { useState, useCallback, useEffect } from "react"
import { Loader2, AlertCircle, PencilLine, CheckCircle2, CheckCheck } from "lucide-react"
import { toast } from "sonner"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { parseGitHubUrl, listGitHubSkills, importGitHubSkills, importMarketplaceToLibrary, listWorkspaceSkills, getDashboardSkillNames, listSkills } from "@/lib/tauri"
import type { WorkspaceSkillImportRequest } from "@/lib/tauri"
import type { AvailableSkill, GitHubRepoInfo, SkillMetadataOverride, WorkspaceSkill } from "@/lib/types"
import { SKILL_TYPES, PURPOSE_OPTIONS } from "@/lib/types"
import { useSettingsStore } from "@/stores/settings-store"

const FALLBACK_MODEL_OPTIONS = [
  { id: "haiku",  displayName: "Haiku — fastest, lowest cost" },
  { id: "sonnet", displayName: "Sonnet — balanced (default)" },
  { id: "opus",   displayName: "Opus — most capable" },
]

interface GitHubImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: () => Promise<void>
  /** The marketplace repository URL (from settings). Required — dialog auto-browses on open. */
  url: string
  /**
   * When set, only skills whose skill_type is in this list are shown (skill-library mode only).
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
  domain: string
  skill_type: string
  version: string
  model: string
  argument_hint: string
  user_invocable: boolean
  disable_model_invocation: boolean
  /** settings-skills only — purpose to assign on import */
  purpose: string | null
}

export default function GitHubImportDialog({
  open,
  onOpenChange,
  onImported,
  url,
  typeFilter,
  mode = 'settings-skills',
  workspacePath,
}: GitHubImportDialogProps) {
  const [loading, setLoading] = useState(false)
  const [repoInfo, setRepoInfo] = useState<GitHubRepoInfo | null>(null)
  const [skills, setSkills] = useState<AvailableSkill[]>([])
  const [error, setError] = useState<string | null>(null)
  const [skillStates, setSkillStates] = useState<Map<string, SkillState>>(new Map())
  const availableModels = useSettingsStore((s) => s.availableModels)

  const [editingSkill, setEditingSkill] = useState<AvailableSkill | null>(null)
  const [editForm, setEditForm] = useState<EditFormState | null>(null)

  // Workspace skills for version comparison and purpose conflict detection (settings-skills only)
  const [workspaceSkills, setWorkspaceSkills] = useState<WorkspaceSkill[]>([])

  function setSkillState(path: string, state: SkillState): void {
    setSkillStates((prev) => new Map(prev).set(path, state))
  }

  function closeEditForm(): void {
    setEditingSkill(null)
    setEditForm(null)
  }

  function updateField<K extends keyof EditFormState>(key: K, value: EditFormState[K]): void {
    setEditForm((f) => f ? { ...f, [key]: value } : f)
  }

  const reset = useCallback(() => {
    setLoading(false)
    setRepoInfo(null)
    setSkills([])
    setError(null)
    setSkillStates(new Map())
    closeEditForm()
    setWorkspaceSkills([])
  }, [])

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) reset()
      onOpenChange(isOpen)
    },
    [onOpenChange, reset]
  )

  const browse = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const info = await parseGitHubUrl(url.trim())
      setRepoInfo(info)
      let available = await listGitHubSkills(
        info.owner,
        info.repo,
        info.branch,
        info.subpath ?? undefined,
      )
      // Apply typeFilter only for skill-library mode
      if (mode === 'skill-library' && typeFilter && typeFilter.length > 0) {
        available = available.filter(
          (s) => s.skill_type != null && typeFilter.includes(s.skill_type)
        )
      }
      // For settings-skills mode: show all skills that have a name
      if (mode === 'settings-skills') {
        available = available.filter((s) => !!s.name)
      }
      if (available.length === 0) {
        setError("No skills found in this repository.")
        return
      }

      const preStates = new Map<string, SkillState>()

      if (mode === 'skill-library') {
        // skill-library: check the skills master table (covers both skill-builder and marketplace skills)
        const dashboardNames = await getDashboardSkillNames()
        const dashboardSet = new Set(dashboardNames)
        // Also fetch full metadata for version comparison
        const wp = workspacePath ?? ''
        const summaries = wp ? await listSkills(wp) : []
        const newSummaryMap = new Map(summaries.map((s) => [s.name, s]))
        for (const skill of available) {
          if (dashboardSet.has(skill.name)) {
            const installedSummary = newSummaryMap.get(skill.name)
            const sameVersion = installedSummary?.version === skill.version
            preStates.set(skill.path, sameVersion ? "same-version" : "upgrade")
          }
        }
      } else {
        // settings-skills: check workspace_skills table
        const installedSkills = await listWorkspaceSkills()
        setWorkspaceSkills(installedSkills)
        const installedSet = new Set(installedSkills.map((s) => s.skill_name))
        const installedVersionMap = new Map(installedSkills.map((s) => [s.skill_name, s.version]))
        for (const skill of available) {
          if (installedSet.has(skill.name)) {
            const installedVersion = installedVersionMap.get(skill.name)
            const sameVersion = installedVersion === skill.version  // covers both null/undefined
            preStates.set(skill.path, sameVersion ? "same-version" : "upgrade")
          }
        }
      }

      setSkillStates(preStates)
      setSkills(available)
    } catch (err) {
      console.error("[github-import] Failed to browse skills:", err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [url, typeFilter, workspacePath])

  useEffect(() => {
    if (open) browse()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const openEditForm = useCallback((skill: AvailableSkill) => {
    setEditingSkill(skill)
    // Priority: remote skill frontmatter → existing installed version (for upgrade/exists)
    const state = skillStates.get(skill.path)
    const ws = (state === 'upgrade' || state === 'exists')
      ? workspaceSkills.find((w) => w.skill_name === skill.name)
      : undefined
    const isSettingsMode = mode === 'settings-skills'
    setEditForm({
      name: skill.name ?? ws?.skill_name ?? '',
      description: skill.description ?? ws?.description ?? '',
      domain: skill.domain ?? ws?.domain ?? '',
      skill_type: isSettingsMode ? 'skill-builder' : (skill.skill_type ?? ws?.skill_type ?? ''),
      version: skill.version ?? ws?.version ?? '1.0.0',
      model: skill.model ?? ws?.model ?? '',
      argument_hint: skill.argument_hint ?? ws?.argument_hint ?? '',
      user_invocable: (skill.user_invocable ?? ws?.user_invocable) ?? false,
      disable_model_invocation: (skill.disable_model_invocation ?? ws?.disable_model_invocation) ?? false,
      purpose: ws?.purpose ?? null,
    })
  }, [mode, skillStates, workspaceSkills])

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
        domain: form.domain,
        skill_type: form.skill_type,
        version: form.version || null,
        model: form.model === APP_DEFAULT_MODEL ? "" : form.model,  // "" signals "App default" → clear model from frontmatter
        argument_hint: form.argument_hint || null,
        user_invocable: form.user_invocable,
        disable_model_invocation: form.disable_model_invocation,
      }
      console.log(`[github-import] calling import_marketplace_to_library for "${skillName}"`)
      const results = await importMarketplaceToLibrary([skill.path], { [skill.path]: metadataOverride })
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
    console.log(`[github-import] importing "${skillName}" from ${repoInfo.owner}/${repoInfo.repo} (path=${skillPath}, purpose=${editForm.purpose ?? 'none'})`)
    setSkillState(skillPath, "importing")
    closeEditForm()
    try {
      const requests: WorkspaceSkillImportRequest[] = [{
        path: skillPath,
        purpose: editForm.purpose ?? null,
        metadata_override: {
          name: editForm.name,
          description: editForm.description,
          domain: editForm.domain,
          skill_type: editForm.skill_type,
          version: editForm.version || null,
          model: editForm.model || null,
          argument_hint: editForm.argument_hint || null,
          user_invocable: editForm.user_invocable,
          disable_model_invocation: editForm.disable_model_invocation,
        },
      }]
      console.log(`[github-import] calling import_github_skills with ${requests.length} request(s)`)
      await importGitHubSkills(repoInfo.owner, repoInfo.repo, repoInfo.branch, requests)
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
    ? !editForm.name.trim() || !editForm.description.trim() || !editForm.domain.trim() || (mode !== 'settings-skills' && !editForm.skill_type.trim())
    : false

  // settings-skills: purpose conflict blocks import
  const purposeConflict = editForm && mode === 'settings-skills' && editingSkill
    ? getPurposeConflict(editForm.purpose, editingSkill.name)
    : null

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          {loading && (
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading skills...</p>
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertCircle className="size-8 text-destructive" />
              <p className="text-sm text-destructive text-center">{error}</p>
              <Button variant="outline" onClick={browse}>Retry</Button>
            </div>
          )}

          {!loading && skills.length > 0 && repoInfo && (
            <>
              <DialogHeader>
                <DialogTitle>Browse Marketplace</DialogTitle>
                <DialogDescription>
                  {skills.length} skill{skills.length !== 1 ? "s" : ""} in {repoInfo.owner}/{repoInfo.repo}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border">
                <div className="flex items-center gap-4 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
                  <span className="flex-1">Name</span>
                  <span className="w-20 shrink-0">Version</span>
                  <span className="w-28 shrink-0">Status</span>
                  <span className="w-8 shrink-0" />
                </div>
                <ScrollArea className="max-h-[60vh]">
                  {skills.map((skill) => {
                    const state = skillStates.get(skill.path) ?? "idle"
                    const isImporting = state === "importing"
                    const isSameVersion = state === "same-version"
                    const isUpgrade = state === "upgrade"
                    const isExists = state === "exists"
                    const isDisabled = isExists || isSameVersion

                    return (
                      <div
                        key={skill.path}
                        className="flex items-center gap-4 border-b last:border-b-0 px-4 py-2 hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="truncate text-sm font-medium">{skill.name}</span>
                            {mode === 'skill-library' && !skill.skill_type && !isDisabled && (
                              <Badge variant="outline" className="text-xs shrink-0 text-amber-600 border-amber-300">
                                Missing type
                              </Badge>
                            )}
                          </div>
                          {skill.domain ? (
                            <div className="text-xs text-muted-foreground">{skill.domain}</div>
                          ) : mode === 'skill-library' && !skill.description && !isDisabled ? (
                            <div className="text-xs text-amber-600">No description</div>
                          ) : null}
                        </div>
                        <div className="w-20 shrink-0">
                          {skill.version ? (
                            <Badge variant="outline" className="text-xs font-mono">{skill.version}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                        <div className="w-28 shrink-0">
                          {state === "imported" && (
                            <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300 dark:text-emerald-400">Imported</Badge>
                          )}
                          {isSameVersion && (
                            <Badge variant="secondary" className="text-xs text-muted-foreground">Up to date</Badge>
                          )}
                          {isUpgrade && (
                            <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">Update available</Badge>
                          )}
                          {isExists && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">Already installed</Badge>
                          )}
                        </div>
                        <div className="w-8 shrink-0 flex items-center justify-end">
                          {state === "imported" ? (
                            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : isDisabled ? (
                            <CheckCheck className="size-3.5 text-muted-foreground" />
                          ) : (
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                              disabled={isImporting}
                              aria-label={`Import ${skill.name}`}
                              onClick={() => openEditForm(skill)}
                            >
                              {isImporting ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <PencilLine className="size-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </ScrollArea>
              </div>
            </>
          )}

          {!loading && !error && skills.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-sm text-muted-foreground">No skills found in this repository.</p>
            </div>
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
                  <Label htmlFor="edit-domain">
                    Domain <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edit-domain"
                    value={editForm.domain}
                    onChange={(e) => updateField("domain", e.target.value)}
                    className={!editForm.domain.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="e.g. finance, analytics"
                  />
                  {!editForm.domain.trim() && (
                    <p className="text-xs text-destructive">Domain is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-skill-type">
                    Skill Type <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={editForm.skill_type}
                    onValueChange={(v) => updateField("skill_type", v)}
                  >
                    <SelectTrigger
                      id="edit-skill-type"
                      className={!editForm.skill_type.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    >
                      <SelectValue placeholder="Select skill type" />
                    </SelectTrigger>
                    <SelectContent>
                      {SKILL_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!editForm.skill_type.trim() && (
                    <p className="text-xs text-destructive">Skill type is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="edit-version">Version <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    id="edit-version"
                    value={editForm.version}
                    onChange={(e) => updateField("version", e.target.value)}
                    placeholder="e.g. 1.0.0"
                  />
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
              Review and configure the skill before importing. Purpose determines how this skill is used by agents.
            </DialogDescription>
          </DialogHeader>
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
                  <Label htmlFor="si-domain">
                    Domain <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="si-domain"
                    value={editForm.domain}
                    onChange={(e) => updateField("domain", e.target.value)}
                    className={!editForm.domain.trim() ? "border-destructive focus-visible:ring-destructive" : ""}
                    placeholder="e.g. finance, analytics"
                  />
                  {!editForm.domain.trim() && (
                    <p className="text-xs text-destructive">Domain is required</p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>Skill Type</Label>
                  <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground">
                    skill-builder
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="si-purpose">Purpose <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Select
                    value={editForm.purpose ?? "__none__"}
                    onValueChange={(v) => updateField("purpose", v === "__none__" ? null : v)}
                  >
                    <SelectTrigger id="si-purpose">
                      <SelectValue placeholder="No purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No purpose</SelectItem>
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
                  <Label htmlFor="si-version">Version <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Input
                    id="si-version"
                    value={editForm.version}
                    onChange={(e) => updateField("version", e.target.value)}
                    placeholder="e.g. 1.0.0"
                  />
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
    </>
  )
}
