import { useState, useEffect, useCallback, useMemo } from "react"
import { useNavigate } from "@tanstack/react-router"
import { invoke } from "@tauri-apps/api/core"
import { FolderOpen, Search, Filter } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import SkillCard from "@/components/skill-card"
import NewSkillDialog from "@/components/new-skill-dialog"
import DeleteSkillDialog from "@/components/delete-skill-dialog"
import TagFilter from "@/components/tag-filter"
import { OnboardingDialog } from "@/components/onboarding-dialog"
import type { SkillSummary, AppSettings } from "@/lib/types"
import { SKILL_TYPES, SKILL_TYPE_LABELS } from "@/lib/types"

export default function DashboardPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [workspacePath, setWorkspacePath] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const navigate = useNavigate()

  const loadSettings = useCallback(async () => {
    try {
      const settings = await invoke<AppSettings>("get_settings")
      setWorkspacePath(settings.workspace_path || "")
    } catch {
      // Settings may not exist yet
    }
  }, [])

  const loadSkills = useCallback(async () => {
    if (!workspacePath) {
      setSkills([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const result = await invoke<SkillSummary[]>("list_skills", {
        workspacePath,
      })
      setSkills(result)
    } catch {
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  const loadTags = useCallback(async () => {
    try {
      const tags = await invoke<string[]>("get_all_tags")
      setAvailableTags(tags)
    } catch {
      setAvailableTags([])
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    loadSkills()
    loadTags()
  }, [loadSkills, loadTags])

  const filteredSkills = useMemo(() => {
    let result = skills
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.domain && s.domain.toLowerCase().includes(q)) ||
          (s.skill_type && (SKILL_TYPE_LABELS[s.skill_type as keyof typeof SKILL_TYPE_LABELS] || s.skill_type).toLowerCase().includes(q))
      )
    }
    if (selectedTags.length > 0) {
      result = result.filter((s) =>
        selectedTags.every((tag) => s.tags?.includes(tag))
      )
    }
    if (selectedTypes.length > 0) {
      result = result.filter((s) =>
        s.skill_type != null && selectedTypes.includes(s.skill_type)
      )
    }
    return result
  }, [skills, searchQuery, selectedTags, selectedTypes])

  const isFiltering = searchQuery.trim().length > 0 || selectedTags.length > 0 || selectedTypes.length > 0

  const handleContinue = (skill: SkillSummary) => {
    navigate({ to: "/skill/$skillName", params: { skillName: skill.name } })
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Skills</h1>
        {workspacePath && (
          <NewSkillDialog
            workspacePath={workspacePath}
            onCreated={() => { loadSkills(); loadTags(); }}
            tagSuggestions={availableTags}
          />
        )}
      </div>

      {!loading && skills.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <TagFilter
            availableTags={availableTags}
            selectedTags={selectedTags}
            onChange={setSelectedTags}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="size-4" />
                Type
                {selectedTypes.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                    {selectedTypes.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Filter by type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SKILL_TYPES.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={selectedTypes.includes(type)}
                  onCheckedChange={() => {
                    setSelectedTypes((prev) =>
                      prev.includes(type)
                        ? prev.filter((t) => t !== type)
                        : [...prev, type]
                    )
                  }}
                >
                  {SKILL_TYPE_LABELS[type]}
                </DropdownMenuCheckboxItem>
              ))}
              {selectedTypes.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedTypes([])}
                  >
                    Clear all
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-2 w-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-8 w-16" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : skills.length === 0 ? (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
              <FolderOpen className="size-6 text-muted-foreground" />
            </div>
            <CardTitle>No skills yet</CardTitle>
            <CardDescription>
              Create your first skill to get started.
            </CardDescription>
          </CardHeader>
          {workspacePath && (
            <CardContent className="flex justify-center">
              <NewSkillDialog
                workspacePath={workspacePath}
                onCreated={() => { loadSkills(); loadTags(); }}
                tagSuggestions={availableTags}
              />
            </CardContent>
          )}
        </Card>
      ) : filteredSkills.length === 0 && isFiltering ? (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
              <Search className="size-6 text-muted-foreground" />
            </div>
            <CardTitle>No matching skills</CardTitle>
            <CardDescription>
              Try a different search term or clear your filters.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSkills.map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              onContinue={handleContinue}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <DeleteSkillDialog
        skill={deleteTarget}
        workspacePath={workspacePath}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onDeleted={() => { loadSkills(); loadTags(); }}
      />

      <OnboardingDialog onComplete={() => { loadSettings(); loadSkills(); loadTags(); }} />
    </div>
  )
}
