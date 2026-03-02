import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate } from "@tanstack/react-router"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Plus, Loader2, ChevronLeft, ChevronRight, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import TagInput from "@/components/tag-input"
import { GhostTextarea } from "@/components/ghost-input"
import { Textarea } from "@/components/ui/textarea"
import { useSettingsStore } from "@/stores/settings-store"
import { useWorkflowStore } from "@/stores/workflow-store"
import { renameSkill, updateSkillMetadata, generateSuggestions, type FieldSuggestions } from "@/lib/tauri"
import { isValidKebab, toKebabChars, buildIntakeJson } from "@/lib/utils"
import type { SkillSummary } from "@/lib/types"
import { PURPOSES, PURPOSE_LABELS } from "@/lib/types"

// --- Built skill detection ---

/**
 * A skill is "built" when the generate step (step 5) has been completed.
 * Locked fields: name, purpose, tags.
 */
function isSkillBuilt(skill: SkillSummary | null): boolean {
  if (!skill) return false
  if (skill.status === "completed") return true
  if (!skill.current_step) return false
  if (/completed/i.test(skill.current_step)) return true
  const match = skill.current_step.match(/step\s*(\d+)/i)
  if (match) return Number(match[1]) >= 5
  return false
}

// --- Cache key helper ---

function makeCacheKey(group: string, params: Record<string, string | null | undefined>): string {
  return JSON.stringify({ group, ...params })
}

// --- Intake JSON parsing ---

function parseIntakeContext(json: string | null | undefined): string {
  if (!json) return ""
  try {
    const obj = JSON.parse(json)
    // New format: context field
    if (obj.context) return obj.context
    // Old format: combine old fields for backwards compat display
    const parts: string[] = []
    if (obj.unique_setup) parts.push(obj.unique_setup)
    if (obj.claude_mistakes) parts.push(obj.claude_mistakes)
    return parts.join("\n")
  } catch {
    return ""
  }
}

// --- Props ---

interface SkillDialogCreateProps {
  mode: "create"
  workspacePath: string
  onCreated: () => Promise<void>
  tagSuggestions?: string[]
  existingNames?: string[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface SkillDialogEditProps {
  mode: "edit"
  skill: SkillSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  tagSuggestions?: string[]
  existingNames?: string[]
  isLocked?: boolean
}

export type SkillDialogProps = SkillDialogCreateProps | SkillDialogEditProps

const STEP_DESCRIPTIONS = {
  create: {
    1: "Name your skill, choose its purpose, and describe what Claude needs to know.",
    2: "Configure skill behaviour (optional -- defaults are fine).",
  },
  edit: {
    1: "Update name, purpose, and description.",
    2: "Update skill behaviour settings.",
  },
} as const

const FALLBACK_MODEL_OPTIONS = [
  { id: "claude-haiku-4-5", displayName: "Haiku -- fastest, lowest cost" },
  { id: "claude-sonnet-4-6", displayName: "Sonnet -- balanced" },
  { id: "claude-opus-4-6", displayName: "Opus -- most capable" },
]

// Map old shorthand values stored in DB to real model IDs.
const SHORTHAND_TO_MODEL: Record<string, string> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
}

function normalizeModelValue(raw: string | null | undefined): string {
  if (!raw) return ""  // "" = App default (no model override)
  return SHORTHAND_TO_MODEL[raw] ?? raw
}

function LockedIcon() {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Lock className="ml-1 inline size-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>Locked — skill has been built</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function SkillDialog(props: SkillDialogProps) {
  const isEdit = props.mode === "edit"
  const navigate = useNavigate()
  const { workspacePath: storeWorkspacePath, skillsPath, industry, functionRole, availableModels } = useSettingsStore()

  // Extract mode-specific props
  const editSkill = isEdit ? (props as SkillDialogEditProps).skill : null
  const editOnOpenChange = isEdit ? (props as SkillDialogEditProps).onOpenChange : undefined
  const editOnSaved = isEdit ? (props as SkillDialogEditProps).onSaved : undefined
  const isLocked = isEdit ? ((props as SkillDialogEditProps).isLocked ?? false) : false
  const createWorkspacePath = !isEdit ? (props as SkillDialogCreateProps).workspacePath : ""
  const createOnCreated = !isEdit ? (props as SkillDialogCreateProps).onCreated : undefined
  const createOnOpenChange = !isEdit ? (props as SkillDialogCreateProps).onOpenChange : undefined
  const tagSuggestions = props.tagSuggestions ?? []
  const existingNames = props.existingNames ?? []

  // Built skill detection (edit mode only)
  const isBuilt = isEdit && isSkillBuilt(editSkill)

  // Imported/marketplace skills: skip intake, lock purpose
  const isImported = isEdit && (editSkill?.skill_source === 'marketplace' || editSkill?.skill_source === 'imported')

  // Total wizard steps: always 2
  const totalSteps = 2

  // Dialog open state -- controlled (edit always, create optionally) or internal
  const [internalOpen, setInternalOpen] = useState(false)
  const dialogOpen = isEdit
    ? (props as SkillDialogEditProps).open
    : (props as SkillDialogCreateProps).open ?? internalOpen

  // Form state
  const [step, setStep] = useState<1 | 2>(1)
  const [skillName, setSkillName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [description, setDescription] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [contextQuestions, setContextQuestions] = useState("")
  // Step 2 behaviour fields
  const [version, setVersion] = useState("1.0.0")
  const [model, setModel] = useState("")
  const [argumentHint, setArgumentHint] = useState("")
  const [userInvocable, setUserInvocable] = useState(true)
  const [disableModelInvocation, setDisableModelInvocation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ghost suggestion state
  const [descriptionSuggestion, setDescriptionSuggestion] = useState<string | null>(null)

  // Version refs and debounce timers
  const group0VersionRef = useRef(0)
  const group0DebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestionCache = useRef<Map<string, FieldSuggestions>>(new Map())

  // Derived state
  const originalName = editSkill?.name ?? ""
  const nameChanged = isEdit && skillName !== originalName
  const nameValid = isValidKebab(skillName)
  const nameExists = skillName !== "" && skillName !== originalName && existingNames.includes(skillName)
  const canAdvanceStep1 = skillName.trim() !== "" && nameValid && !nameExists && purpose !== "" && description.trim() !== ""
  const submitLabel = isEdit ? "Save" : "Create"
  const stepDescriptions = STEP_DESCRIPTIONS[props.mode]

  // --- Form population and reset ---

  const resetForm = useCallback(() => {
    setStep(1)
    setSkillName("")
    setPurpose("")
    setDescription("")
    setTags([])
    setContextQuestions("")
    setVersion("1.0.0")
    setModel("")
    setArgumentHint("")
    setUserInvocable(true)
    setDisableModelInvocation(false)
    setDescriptionSuggestion(null)
    setError(null)
    setSubmitting(false)
    group0VersionRef.current++
    suggestionCache.current.clear()
    if (group0DebounceRef.current) clearTimeout(group0DebounceRef.current)
  }, [])

  // Populate form in edit mode when dialog opens; reset on close for both modes
  useEffect(() => {
    if (isEdit && dialogOpen && editSkill) {
      setSkillName(editSkill.name)
      setPurpose(editSkill.purpose || "domain")
      setTags([...editSkill.tags])
      setDescription(editSkill.description || "")
      setContextQuestions(parseIntakeContext(editSkill.intake_json))
      setVersion(editSkill.version || "1.0.0")
      setModel(normalizeModelValue(editSkill.model))
      setArgumentHint(editSkill.argumentHint || "")
      setUserInvocable(editSkill.userInvocable ?? true)
      setDisableModelInvocation(editSkill.disableModelInvocation ?? false)
    } else if (!dialogOpen) {
      resetForm()
    }
  }, [dialogOpen, isEdit, editSkill, resetForm])

  const handleOpenChange = useCallback((open: boolean) => {
    if (editOnOpenChange) {
      editOnOpenChange(open)
    } else if (createOnOpenChange) {
      createOnOpenChange(open)
    } else {
      setInternalOpen(open)
    }
  }, [editOnOpenChange, createOnOpenChange])

  // --- Cascading ghost suggestions ---
  // Group 0: description <- name + purpose (skip in edit mode)
  // Context questions: fires when name + description + purpose are all set

  // Generic fetch helper: debounce -> cache check -> API call -> set state
  const fetchGroup = useCallback(
    (opts: {
      group: string
      fields: string[]
      params: Record<string, string | null | undefined>
      apiOpts: Parameters<typeof generateSuggestions>[2]
      versionRef: React.MutableRefObject<number>
      debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
      debounceMs: number
      onResult: (result: FieldSuggestions) => void
    }) => {
      if (opts.debounceRef.current) clearTimeout(opts.debounceRef.current)
      if (!skillName || !purpose) return

      const version = ++opts.versionRef.current
      opts.debounceRef.current = setTimeout(async () => {
        try {
          const key = makeCacheKey(opts.group, opts.params)
          const cached = suggestionCache.current.get(key)
          if (cached) {
            if (version === opts.versionRef.current) opts.onResult(cached)
            return
          }
          const result = await generateSuggestions(skillName, purpose, {
            ...opts.apiOpts,
            fields: opts.fields,
          })
          if (version === opts.versionRef.current) {
            suggestionCache.current.set(key, result)
            opts.onResult(result)
          }
        } catch (err) {
          console.error(`[skill-dialog] ${opts.group} suggestion fetch failed:`, err)
        }
      }, opts.debounceMs)
    },
    [skillName, purpose],
  )

  // Group 0: fetch description when name + purpose are set (skip in edit mode)
  useEffect(() => {
    if (!dialogOpen || !skillName || !purpose || isEdit) { setDescriptionSuggestion(null); return }
    const params = { name: skillName, purpose, industry, functionRole }
    fetchGroup({
      group: "description", fields: ["description"], params,
      apiOpts: { industry, functionRole },
      versionRef: group0VersionRef, debounceRef: group0DebounceRef,
      debounceMs: 800,
      onResult: (r) => setDescriptionSuggestion(r.description || null),
    })
    return () => { if (group0DebounceRef.current) clearTimeout(group0DebounceRef.current) }
  }, [dialogOpen, isEdit, skillName, purpose, industry, functionRole, fetchGroup])

  // --- Submit ---

  const doSubmit = async () => {
    if (!canAdvanceStep1) return

    setSubmitting(true)
    setError(null)

    try {
      if (isEdit) {
        if (!editSkill) return
        if (nameChanged && storeWorkspacePath) {
          await renameSkill(editSkill.name, skillName, storeWorkspacePath)
        }
        await updateSkillMetadata(
          nameChanged ? skillName : editSkill.name,
          purpose || null,
          tags,
          buildIntakeJson({ context: contextQuestions }),
          description.trim() || null,
          version.trim() || null,
          model || null,
          argumentHint.trim() || null,
          userInvocable,
          disableModelInvocation,
        )
        console.log(`[skill] Updated skill "${skillName}"`)
        toast.success("Skill updated")
        handleOpenChange(false)
        editOnSaved?.()
      } else {
        await invoke("create_skill", {
          workspacePath: createWorkspacePath,
          name: skillName.trim(),
          tags: tags.length > 0 ? tags : null,
          purpose: purpose || null,
          intakeJson: buildIntakeJson({ context: contextQuestions }),
          description: description.trim() || null,
          version: version.trim() || null,
          model: model || null,
          argumentHint: argumentHint.trim() || null,
          userInvocable,
          disableModelInvocation,
        })
        console.log(`[skill] Created skill "${skillName}"`)
        toast.success(`Skill "${skillName}" created`)
        const createdName = skillName.trim()
        await createOnCreated?.()
        // Signal the workflow page to start in update mode (auto-start step 0)
        useWorkflowStore.getState().setPendingUpdateMode(true)
        navigate({ to: "/skill/$skillName", params: { skillName: createdName } })
        handleOpenChange(false)
      }
    } catch (err) {
      console.error(`[skill-dialog] Failed to ${isEdit ? "update" : "create"} skill:`, err)
      const msg = err instanceof Error ? err.message : String(err)
      if (isEdit) {
        toast.error(`Failed to update skill: ${msg}`, { duration: Infinity })
      } else {
        setError(msg)
        toast.error("Failed to create skill", { duration: Infinity })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await doSubmit()
  }

  // --- Helpers ---

  const handleNameChange = (value: string) => {
    setSkillName(toKebabChars(value))
    setError(null)
  }

  function stepDotColor(s: number): string {
    if (s === step) return "bg-primary"
    if (s < step) return "bg-primary/40"
    return "bg-muted-foreground/20"
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      {!isEdit && !createOnOpenChange && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="size-4" />
            New Skill
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-3xl transition-all duration-200">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Skill" : "Create New Skill"}</DialogTitle>
            <DialogDescription>
              {stepDescriptions[step]}
            </DialogDescription>
          </DialogHeader>

          {/* Locked banner -- shown when skill is being edited in another window */}
          {isLocked && (
            <div className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              <Lock className="size-4 shrink-0" />
              This skill is being edited in another window
            </div>
          )}

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-2 py-3">
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
              <div
                key={s}
                className={`size-2 rounded-full transition-colors ${stepDotColor(s)}`}
              />
            ))}
            <span className="ml-2 text-xs text-muted-foreground">
              Step {step} of {totalSteps}
            </span>
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-4 py-2 overflow-y-auto pr-1">
            {/* Step 1: Name + Purpose + Description + Tags + Context Questions */}
            {step === 1 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="skill-name">
                    Skill Name <span className="text-destructive">*</span>
                    {isBuilt && <LockedIcon />}
                  </Label>
                  <Input
                    id="skill-name"
                    placeholder={isEdit ? "kebab-case-name" : "e.g., sales-pipeline"}
                    value={skillName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    disabled={submitting || isBuilt}
                    autoFocus={!isEdit}
                  />
                  {!isEdit && (
                    <p className="text-xs text-muted-foreground">
                      Kebab-case identifier (lowercase, hyphens)
                      {skillName && !nameValid && (
                        <span className="text-destructive ml-1">-- invalid format</span>
                      )}
                    </p>
                  )}
                  {isEdit && skillName && !nameValid && !isBuilt && (
                    <p className="text-xs text-destructive">
                      Must be kebab-case (e.g., sales-pipeline)
                    </p>
                  )}
                  {nameExists && (
                    <p className="text-xs text-destructive">
                      A skill with this name already exists
                    </p>
                  )}
                  {nameChanged && nameValid && !nameExists && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Renaming will move the skill directory
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
                  <GhostTextarea
                    id="description"
                    placeholder="Brief description of what this skill does (1-2 sentences)"
                    value={description}
                    onChange={(val) => setDescription(val.slice(0, 1024))}
                    suggestion={descriptionSuggestion}
                    onAccept={(val) => setDescription(val.slice(0, 1024))}
                    disabled={submitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    How Claude Code decides when to activate this skill ({description.length}/1024)
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="purpose-select">
                    What are you trying to capture? <span className="text-destructive">*</span>
                    {(isBuilt || isImported) && <LockedIcon />}
                  </Label>
                  <select
                    id="purpose-select"
                    value={purpose}
                    onChange={(e) => (isBuilt || isImported) ? undefined : setPurpose(e.target.value)}
                    disabled={submitting || isBuilt || isImported}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="" disabled>Select a purpose...</option>
                    {PURPOSES.map((p) => (
                      <option key={p} value={p}>{PURPOSE_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="tags">
                    Tags
                    {isBuilt && <LockedIcon />}
                  </Label>
                  <TagInput
                    tags={tags}
                    onChange={setTags}
                    suggestions={tagSuggestions}
                    disabled={submitting || isBuilt}
                    placeholder="e.g., salesforce, analytics"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="context-questions">What Claude needs to know</Label>
                  <Textarea
                    id="context-questions"
                    placeholder="What makes your setup unique? What does Claude usually miss?"
                    value={contextQuestions}
                    onChange={(e) => setContextQuestions(e.target.value)}
                    disabled={submitting || isLocked}
                    className="min-h-[4.5rem] resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional hints to guide the research agents
                  </p>
                </div>

                {/* Skills output location (create mode only) */}
                {!isEdit && skillsPath && skillName && (
                  <p className="text-xs text-muted-foreground">
                    Output: <code className="text-xs">{skillsPath}/{skillName}/</code>
                  </p>
                )}
              </>
            )}

            {/* Step 2: Behaviour settings */}
            {step === 2 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="version">Version</Label>
                  <Input
                    id="version"
                    placeholder="1.0.0"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="model">Model</Label>
                  <select
                    id="model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={submitting}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">App default</option>
                    {(availableModels.length > 0 ? availableModels : FALLBACK_MODEL_OPTIONS).map((m) => (
                      <option key={m.id} value={m.id}>{m.displayName}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Model this skill is designed and tested for
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="argument-hint">Argument Hint</Label>
                  <Input
                    id="argument-hint"
                    placeholder="e.g., [salesforce-org-url]"
                    value={argumentHint}
                    onChange={(e) => setArgumentHint(e.target.value)}
                    disabled={submitting}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional hint shown to users when invoking this skill
                  </p>
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">User Invocable</span>
                    <span className="text-xs text-muted-foreground">
                      Allow users to invoke this skill directly
                    </span>
                  </div>
                  <Switch
                    checked={userInvocable}
                    onCheckedChange={setUserInvocable}
                    disabled={submitting}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Disable Model Invocation</span>
                    <span className="text-xs text-muted-foreground">
                      Prevent Claude from automatically invoking this skill
                    </span>
                  </div>
                  <Switch
                    checked={disableModelInvocation}
                    onCheckedChange={setDisableModelInvocation}
                    disabled={submitting}
                  />
                </div>
              </>
            )}

            {!isEdit && error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter>
            {step === 1 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!canAdvanceStep1 || isLocked}
                  onClick={() => setStep(2)}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </>
            )}
            {step === 2 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={submitting}
                >
                  <ChevronLeft className="size-4" />
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || isLocked || !canAdvanceStep1}
                >
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  {submitLabel}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
