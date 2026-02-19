import { useState, useEffect, useRef, useCallback } from "react"
import { useNavigate } from "@tanstack/react-router"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import { Plus, Loader2, ChevronLeft, ChevronRight } from "lucide-react"
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import TagInput from "@/components/tag-input"
import { GhostInput, GhostTextarea } from "@/components/ghost-input"
import { useSettingsStore } from "@/stores/settings-store"
import { generateSuggestions, type FieldSuggestions } from "@/lib/tauri"
import { isValidKebab, toKebabChars, buildIntakeJson } from "@/lib/utils"
import { SKILL_TYPES, SKILL_TYPE_LABELS, SKILL_TYPE_DESCRIPTIONS, INTAKE_PLACEHOLDERS } from "@/lib/types"

const STEP_DESCRIPTIONS: Record<number, string> = {
  1: "Name your skill and choose its type.",
  2: "Describe the domain, scope, and tags.",
  3: "Add optional details to guide research.",
}

interface NewSkillDialogProps {
  workspacePath: string
  onCreated: () => Promise<void>
  tagSuggestions?: string[]
}

export default function NewSkillDialog({
  workspacePath,
  onCreated,
  tagSuggestions = [],
}: NewSkillDialogProps) {
  const navigate = useNavigate()
  const { skillsPath, industry, functionRole } = useSettingsStore()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [name, setName] = useState("")
  const [skillType, setSkillType] = useState<string>("")
  const [domain, setDomain] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [audience, setAudience] = useState("")
  const [challenges, setChallenges] = useState("")
  const [scope, setScope] = useState("")
  const [uniqueSetup, setUniqueSetup] = useState("")
  const [claudeMistakes, setClaudeMistakes] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<FieldSuggestions | null>(null)
  const [step3Suggestions, setStep3Suggestions] = useState<FieldSuggestions | null>(null)
  const [aiTagSuggestions, setAiTagSuggestions] = useState<string[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tagDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchVersionRef = useRef(0)
  const step3VersionRef = useRef(0)
  const tagVersionRef = useRef(0)

  const placeholders = INTAKE_PLACEHOLDERS[skillType] || INTAKE_PLACEHOLDERS.domain

  // Merged tag suggestions: existing workspace tags + AI-generated tags (deduped)
  const mergedTagSuggestions = [
    ...tagSuggestions,
    ...aiTagSuggestions.filter((t) => !tagSuggestions.includes(t)),
  ]

  // Step 2 suggestions: triggered by name + type (domain, scope ghosts only)
  const fetchSuggestions = useCallback(
    (skillName: string, type: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (!skillName || !type) {
        setSuggestions(null)
        return
      }
      const version = ++fetchVersionRef.current
      debounceRef.current = setTimeout(async () => {
        try {
          const result = await generateSuggestions(skillName, type, {
            industry, functionRole,
          })
          if (version === fetchVersionRef.current) setSuggestions(result)
        } catch (err) {
          console.warn("[new-skill] Ghost suggestion fetch failed:", err)
        }
      }, 800)
    },
    [industry, functionRole],
  )

  // Tag suggestions: triggered when domain or scope change (debounced)
  useEffect(() => {
    if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current)
    const effectiveDomain = domain || suggestions?.domain
    const effectiveScope = scope || suggestions?.scope
    if (!name || !skillType || !effectiveDomain) {
      setAiTagSuggestions([])
      return
    }
    const version = ++tagVersionRef.current
    tagDebounceRef.current = setTimeout(async () => {
      try {
        const result = await generateSuggestions(name, skillType, {
          industry, functionRole, existingTags: tagSuggestions,
          domain: effectiveDomain, scope: effectiveScope,
        })
        if (version === tagVersionRef.current) {
          setAiTagSuggestions(result.tags)
        }
      } catch (err) {
        console.warn("[new-skill] Tag suggestion fetch failed:", err)
      }
    }, 1200)
    return () => { if (tagDebounceRef.current) clearTimeout(tagDebounceRef.current) }
  }, [domain, scope, name, skillType, industry, functionRole, tagSuggestions, suggestions?.domain, suggestions?.scope])

  // Step 3 suggestions: triggered when entering step 3, uses step 2 values
  const fetchStep3Suggestions = useCallback(() => {
    if (!name || !skillType) return
    const version = ++step3VersionRef.current
    const run = async () => {
      try {
        const result = await generateSuggestions(name, skillType, {
          industry, functionRole, existingTags: tagSuggestions,
          domain: domain || suggestions?.domain,
          scope: scope || suggestions?.scope,
          currentTags: tags,
        })
        if (version === step3VersionRef.current) setStep3Suggestions(result)
      } catch (err) {
        console.warn("[new-skill] Step 3 suggestion fetch failed:", err)
      }
    }
    run()
  }, [name, skillType, industry, functionRole, tagSuggestions, domain, scope, tags, suggestions])

  // Trigger step 2 suggestion fetch when name or type changes
  useEffect(() => {
    if (name && skillType) {
      fetchSuggestions(name, skillType)
    } else {
      setSuggestions(null)
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [name, skillType, fetchSuggestions])

  const handleNameChange = (value: string) => {
    setName(toKebabChars(value))
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !skillType) return
    if (!isValidKebab(name.trim())) {
      setError("Skill name must be kebab-case (e.g., sales-pipeline)")
      return
    }

    setLoading(true)
    setError(null)
    try {
      await invoke("create_skill", {
        workspacePath,
        name: name.trim(),
        domain: domain.trim() || name.replace(/-/g, " "),
        tags: tags.length > 0 ? tags : null,
        skillType: skillType || null,
        intakeJson: buildIntakeJson({
          audience, challenges, scope,
          unique_setup: uniqueSetup, claude_mistakes: claudeMistakes,
        }),
      })
      console.log(`[skill] Created skill "${name}"`)
      toast.success(`Skill "${name}" created`)
      const skillName = name.trim()
      await onCreated()
      navigate({ to: "/skill/$skillName", params: { skillName } })
      setOpen(false)
      resetForm()
    } catch (err) {
      console.error("[new-skill] Failed to create skill:", err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error("Failed to create skill", { duration: Infinity })
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setStep(1)
    setName("")
    setSkillType("")
    setDomain("")
    setTags([])
    setAudience("")
    setChallenges("")
    setScope("")
    setUniqueSetup("")
    setClaudeMistakes("")
    setSuggestions(null)
    setStep3Suggestions(null)
    setAiTagSuggestions([])
    setError(null)
    fetchVersionRef.current++
    step3VersionRef.current++
    tagVersionRef.current++
  }

  const canAdvanceStep1 = name.trim() !== "" && isValidKebab(name.trim()) && skillType !== ""

  function stepDotColor(s: number): string {
    if (s === step) return "bg-primary"
    if (s < step) return "bg-primary/40"
    return "bg-muted-foreground/20"
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New Skill
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Skill</DialogTitle>
            <DialogDescription>
              {STEP_DESCRIPTIONS[step]}
            </DialogDescription>
          </DialogHeader>

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-2 py-3">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`size-2 rounded-full transition-colors ${stepDotColor(s)}`}
              />
            ))}
            <span className="ml-2 text-xs text-muted-foreground">
              Step {step} of 3
            </span>
          </div>

          <div className="flex flex-col gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
            {/* Step 1: Name + Type */}
            {step === 1 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="skill-name">Skill Name</Label>
                  <Input
                    id="skill-name"
                    placeholder="e.g., sales-pipeline"
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                  <p className="text-xs text-muted-foreground">
                    Kebab-case identifier (lowercase, hyphens)
                    {name && !isValidKebab(name) && (
                      <span className="text-destructive ml-1">— invalid format</span>
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Skill Type</Label>
                  <RadioGroup
                    value={skillType}
                    onValueChange={setSkillType}
                    className="grid grid-cols-2 gap-2"
                  >
                    {SKILL_TYPES.map((type) => (
                      <label
                        key={type}
                        className="flex items-start gap-2 rounded-md border p-3 cursor-pointer hover:bg-accent [&:has([data-state=checked])]:border-primary"
                      >
                        <RadioGroupItem value={type} id={`type-${type}`} className="mt-0.5" />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{SKILL_TYPE_LABELS[type]}</span>
                          <span className="text-xs text-muted-foreground">
                            {SKILL_TYPE_DESCRIPTIONS[type]}
                          </span>
                        </div>
                      </label>
                    ))}
                  </RadioGroup>
                </div>
              </>
            )}

            {/* Step 2: Domain + Scope + Tags */}
            {step === 2 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="domain">Domain</Label>
                  <GhostInput
                    id="domain"
                    placeholder="What does this skill cover?"
                    value={domain}
                    onChange={setDomain}
                    suggestion={suggestions?.domain ?? null}
                    onAccept={setDomain}
                    disabled={loading}
                  />
                  <p className="text-xs text-muted-foreground">
                    Brief description of the skill&apos;s domain
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="scope">Scope</Label>
                  <GhostTextarea
                    id="scope"
                    placeholder={placeholders.scope}
                    value={scope}
                    onChange={setScope}
                    suggestion={suggestions?.scope ?? null}
                    onAccept={setScope}
                    disabled={loading}
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Helps agents focus research on what matters most
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="tags">Tags</Label>
                  <TagInput
                    tags={tags}
                    onChange={setTags}
                    suggestions={mergedTagSuggestions}
                    disabled={loading}
                    placeholder="e.g., salesforce, analytics"
                  />
                </div>

                {/* Skills output location */}
                {skillsPath && name && (
                  <p className="text-xs text-muted-foreground">
                    Output: <code className="text-xs">{skillsPath}/{name}/</code>
                  </p>
                )}
              </>
            )}

            {/* Step 3: Optional detail fields (suggestions use step 2 context) */}
            {step === 3 && (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="audience">Target Audience</Label>
                  <GhostTextarea
                    id="audience"
                    placeholder={placeholders.audience}
                    value={audience}
                    onChange={setAudience}
                    suggestion={step3Suggestions?.audience ?? null}
                    onAccept={setAudience}
                    disabled={loading}
                    rows={2}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="challenges">Key Challenges</Label>
                  <GhostTextarea
                    id="challenges"
                    placeholder={placeholders.challenges}
                    value={challenges}
                    onChange={setChallenges}
                    suggestion={step3Suggestions?.challenges ?? null}
                    onAccept={setChallenges}
                    disabled={loading}
                    rows={2}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="unique-setup">What makes your setup unique?</Label>
                  <GhostTextarea
                    id="unique-setup"
                    placeholder={placeholders.unique_setup}
                    value={uniqueSetup}
                    onChange={setUniqueSetup}
                    suggestion={step3Suggestions?.unique_setup ?? null}
                    onAccept={setUniqueSetup}
                    disabled={loading}
                    rows={2}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="claude-mistakes">What does Claude get wrong?</Label>
                  <GhostTextarea
                    id="claude-mistakes"
                    placeholder={placeholders.claude_mistakes}
                    value={claudeMistakes}
                    onChange={setClaudeMistakes}
                    suggestion={step3Suggestions?.claude_mistakes ?? null}
                    onAccept={setClaudeMistakes}
                    disabled={loading}
                    rows={2}
                  />
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {step === 1 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={!canAdvanceStep1}
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
                  disabled={loading}
                >
                  <ChevronLeft className="size-4" />
                  Back
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setStep(3); fetchStep3Suggestions(); }}
                  disabled={loading}
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !canAdvanceStep1}
                >
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  Create
                </Button>
              </>
            )}
            {step === 3 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(2)}
                  disabled={loading}
                >
                  <ChevronLeft className="size-4" />
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={loading || !canAdvanceStep1}
                >
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  Create
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
