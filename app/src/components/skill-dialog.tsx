import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "@/lib/toast"
import { Plus, Loader2, ChevronLeft, ChevronRight, Lock, FileText } from "lucide-react"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import TagInput from "@/components/tag-input"
import { Textarea } from "@/components/ui/textarea"
import ScopeAdvisor from "@/components/scope-advisor"
import { useScopeAdvisor } from "@/hooks/use-scope-advisor"
import { useSettingsStore } from "@/stores/settings-store"
import { useDocumentStore } from "@/stores/document-store"
import { renameSkill, updateSkillMetadata, createSkill } from "@/lib/tauri"
import { isValidKebab, toKebabChars, buildIntakeJson } from "@/lib/utils"
import type { EditableSkill } from "@/lib/types"
import { PURPOSES, PURPOSE_LABELS } from "@/lib/types"

// --- Built skill detection ---

/**
 * A skill is "built" when the generate step (step 5) has been completed.
 * Locked fields: name, purpose, tags.
 */
function isSkillBuilt(skill: EditableSkill | null): boolean {
  if (!skill) return false
  if (skill.status === "completed") return true
  if (!skill.current_step) return false
  if (/completed/i.test(skill.current_step)) return true
  const match = skill.current_step.match(/step\s*(\d+)/i)
  if (match) return Number(match[1]) >= 5
  return false
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
  onCreated: (createdName: string) => Promise<void>
  tagSuggestions?: string[]
  existingNames?: string[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

interface SkillDialogEditProps {
  mode: "edit"
  skill: EditableSkill | null
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

function LockedIcon({ message = "Locked — skill has been built" }: { message?: string } = {}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Lock className="ml-1 inline size-3 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>{message}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default function SkillDialog(props: SkillDialogProps) {
  const isEdit = props.mode === "edit"
  const navigate = useNavigate()
  const { workspacePath: storeWorkspacePath, skillsPath } = useSettingsStore()
  const documents = useDocumentStore((s) => s.documents)
  const allScopeDocuments = useMemo(() => documents.filter((d) => d.scope === "all"), [documents])

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

  // Skill names are immutable after creation — disabled for all edit modes
  const isNameLocked = isEdit

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
  const [argumentHint, setArgumentHint] = useState("")
  const [userInvocable, setUserInvocable] = useState(true)
  const [disableModelInvocation, setDisableModelInvocation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const advisorState = useScopeAdvisor({
    mode: props.mode,
    skillName,
    description,
    purpose,
    contextQuestions,
  })

  // Stable ref so resetForm doesn't take advisorState.onFieldEdit as a dep
  // (the edit-mode no-op is a new arrow fn each render and would cause infinite loops)
  const advisorResetRef = useRef(advisorState.onFieldEdit)
  advisorResetRef.current = advisorState.onFieldEdit

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
    setArgumentHint("")
    setUserInvocable(true)
    setDisableModelInvocation(false)
    setError(null)
    setSubmitting(false)
    advisorResetRef.current()
  }, [])

  // Populate form in edit mode when dialog opens; reset on close for both modes
  useEffect(() => {
    if (isEdit && dialogOpen && editSkill) {
      setSkillName(editSkill.name)
      setPurpose(editSkill.purpose || "domain")
      setTags([...editSkill.tags])
      setDescription(editSkill.description || "")
      setContextQuestions(parseIntakeContext(editSkill.intake_json))
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
          null,
          null,
          argumentHint.trim() || null,
          userInvocable,
          disableModelInvocation,
        )
        console.log(`[skill] Updated skill "${skillName}"`)
        toast.success(`Skill "${skillName}" updated`)
        handleOpenChange(false)
        editOnSaved?.()
      } else {
        await createSkill({
          workspacePath: createWorkspacePath,
          name: skillName.trim(),
          tags: tags.length > 0 ? tags : null,
          purpose: purpose || null,
          intakeJson: buildIntakeJson({ context: contextQuestions }),
          description: description.trim() || null,
          version: null,
          model: null,
          argumentHint: argumentHint.trim() || null,
          userInvocable,
          disableModelInvocation,
        })
        console.log(`[skill] Created skill "${skillName}"`)
        toast.success(`Skill "${skillName}" created`)
        const createdName = skillName.trim()
        await createOnCreated?.(createdName)
        navigate({ to: "/skill/$skillName", params: { skillName: createdName }, state: { autoStart: true } })
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
    if (!isEdit) advisorState.onManualFieldEdit()
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
      <DialogContent className="sm:max-w-3xl transition-all duration-1024">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit Skill" : "Create New Skill"}</DialogTitle>
            <DialogDescription>
              {stepDescriptions[step]}
            </DialogDescription>
          </DialogHeader>

          {/* Locked banner -- shown when skill is being edited in another window */}
          {isLocked && (
            <div className="flex items-center gap-2 rounded-md border border-amber-10240/1024 bg-amber-1024 px-3 py-2 text-sm text-amber-800 dark:bg-amber-91024/20 dark:text-amber-300">
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

          <div className="relative flex-1 min-h-0 flex flex-col gap-4 py-2 overflow-y-auto pr-1">
            {step === 1 && advisorState.status === "loading" && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-md bg-background/80 backdrop-blur-sm">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Analyzing skill details…</span>
              </div>
            )}
            {/* Step 1: Name + Purpose + Description + Tags + Context Questions */}
            {step === 1 && (
              <>
                {!isEdit && allScopeDocuments.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-md border border-muted bg-muted/30 px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">Business context documents</span>
                    <div className="flex flex-wrap gap-1.5">
                      {allScopeDocuments.map((doc) => (
                        <span key={doc.id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                          <FileText className="size-3" />
                          {doc.name}
                        </span>
                      ))}
                    </div>
                    <span className="text-[11px] text-muted-foreground/70">These documents inform the scope advisor. Manage in Settings.</span>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <Label htmlFor="skill-name">
                    Skill Name <span className="text-destructive">*</span>
                    {isNameLocked && <LockedIcon message="Skill names cannot be changed after creation" />}
                  </Label>
                  <Input
                    id="skill-name"
                    placeholder={isEdit ? "kebab-case-name" : "e.g., sales-pipeline"}
                    value={skillName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    disabled={submitting || isNameLocked}
                    autoFocus={!isEdit}
                  />
                  {isNameLocked && (
                    <p className="text-xs text-muted-foreground">
                      Skill names cannot be changed after creation
                    </p>
                  )}
                  {!isEdit && (
                    <p className="text-xs text-muted-foreground">
                      Kebab-case identifier (lowercase, hyphens)
                      {skillName && !nameValid && (
                        <span className="text-destructive ml-1">-- invalid format</span>
                      )}
                    </p>
                  )}
                  {nameExists && (
                    <p className="text-xs text-destructive">
                      A skill with this name already exists
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="description">
                    What the skill does <span className="text-destructive">*</span>
                    {isEdit && <LockedIcon message="Use the Optimize Description tab to update this" />}
                  </Label>
                  <Textarea
                    id="description"
                    placeholder="Describe what this skill does and when to use it"
                    value={description}
                    onChange={(e) => { setDescription(e.target.value.slice(0, 1024)); if (!isEdit) advisorState.onManualFieldEdit() }}
                    disabled={submitting || isEdit}
                    className="min-h-[4.5rem] resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {isEdit
                      ? "Use the Optimize Description tab to update this"
                      : `How the AI agent decides when to activate this skill (${description.length}/1024)`}
                  </p>
                  <ScopeAdvisor
                    advisorState={advisorState}
                    onChipSelect={(name, desc) => {
                      setSkillName(name)
                      setDescription(desc)
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="purpose-select">
                    What are you trying to capture? <span className="text-destructive">*</span>
                    {(isBuilt || isImported) && <LockedIcon />}
                  </Label>
                  <Select
                    value={purpose}
                    onValueChange={(isBuilt || isImported) ? undefined : (v) => { setPurpose(v); if (!isEdit) advisorState.onManualFieldEdit() }}
                    disabled={submitting || isBuilt || isImported}
                  >
                    <SelectTrigger id="purpose-select" className="w-full">
                      <SelectValue placeholder="Select a purpose..." />
                    </SelectTrigger>
                    <SelectContent>
                      {PURPOSES.map((p) => (
                        <SelectItem key={p} value={p}>{PURPOSE_LABELS[p]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    Output: <code className="text-xs">{skillsPath}/skills/{skillName}/</code>
                  </p>
                )}
              </>
            )}

            {/* Step 2: Behaviour settings */}
            {step === 2 && (
              <>
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
                {!isEdit && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!canAdvanceStep1 || advisorState.status === "loading" || advisorState.status === "focused"}
                    onClick={() => advisorState.triggerCheck()}
                  >
                    Validate
                  </Button>
                )}
                <Button
                  type="button"
                  disabled={!canAdvanceStep1 || isLocked || advisorState.status === "loading"}
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
                  type="button"
                  disabled={submitting || isLocked || !canAdvanceStep1}
                  onClick={() => doSubmit()}
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
