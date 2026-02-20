import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { FolderOpen, Search, Filter, AlertCircle, Settings, Plus } from "lucide-react"
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
import SkillListRow from "@/components/skill-list-row"
import { DashboardViewToggle, type ViewMode } from "@/components/dashboard-view-toggle"
import SkillDialog from "@/components/skill-dialog"
import DeleteSkillDialog from "@/components/delete-skill-dialog"
import TagFilter from "@/components/tag-filter"
import TeamRepoImportDialog from "@/components/team-repo-import-dialog"
import { useSettingsStore } from "@/stores/settings-store"
import { useSkillStore } from "@/stores/skill-store"
import { useAuthStore } from "@/stores/auth-store"
import { useWorkflowStore } from "@/stores/workflow-store"
import { packageSkill, getLockedSkills, pushSkillToRemote } from "@/lib/tauri"
import type { SkillSummary, AppSettings } from "@/lib/types"
import { SKILL_TYPES, SKILL_TYPE_LABELS } from "@/lib/types"

export default function DashboardPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [workspacePath, setWorkspacePath] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null)
  const [editTarget, setEditTarget] = useState<SkillSummary | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const navigate = useNavigate()
  const skillsPath = useSettingsStore((s) => s.skillsPath)
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn)
  const remoteRepoOwner = useSettingsStore((s) => s.remoteRepoOwner)
  const remoteRepoName = useSettingsStore((s) => s.remoteRepoName)
  const remoteConfigured = !!(remoteRepoOwner && remoteRepoName)
  const savedViewMode = useSettingsStore((s) => s.dashboardViewMode) as ViewMode | null
  const [viewMode, setViewMode] = useState<ViewMode>(savedViewMode ?? "grid")
  const viewModeInitialized = useRef(false)
  const lockedSkills = useSkillStore((s) => s.lockedSkills)
  const setLockedSkills = useSkillStore((s) => s.setLockedSkills)
  const existingSkillNames = skills.map((s) => s.name)

  const refreshLocks = useCallback(async () => {
    try {
      const locks = await getLockedSkills()
      setLockedSkills(new Set(locks.map(l => l.skill_name)))
    } catch {
      // ignore — locks are best-effort
    }
  }, [setLockedSkills])

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
    refreshLocks()
  }, [loadSkills, loadTags, refreshLocks])

  useEffect(() => {
    refreshLocks()
    const interval = setInterval(refreshLocks, 30000)
    window.addEventListener("focus", refreshLocks)
    return () => {
      clearInterval(interval)
      window.removeEventListener("focus", refreshLocks)
    }
  }, [refreshLocks])

  // Initialize view mode from saved preference or auto-select based on skill count.
  // A saved preference is restored immediately. Auto-select waits until skills
  // have actually been fetched (workspacePath is set and loading is done).
  useEffect(() => {
    if (loading || viewModeInitialized.current) return
    if (savedViewMode !== null) {
      viewModeInitialized.current = true
      setViewMode(savedViewMode)
    } else if (workspacePath && skills.length > 0) {
      viewModeInitialized.current = true
      if (skills.length >= 10) setViewMode("list")
    }
  }, [loading, savedViewMode, skills.length, workspacePath])

  const handleViewModeChange = useCallback(async (mode: ViewMode) => {
    setViewMode(mode)
    useSettingsStore.getState().setSettings({ dashboardViewMode: mode })
    try {
      const current = await invoke<AppSettings>("get_settings")
      await invoke("save_settings", { settings: { ...current, dashboard_view_mode: mode } })
    } catch {
      console.warn("Failed to persist dashboard view mode")
    }
  }, [])

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
    useWorkflowStore.getState().setReviewMode(true)
    navigate({ to: "/skill/$skillName", params: { skillName: skill.name } })
  }

  const handleEditWorkflow = (skill: SkillSummary) => {
    useWorkflowStore.getState().setPendingUpdateMode(true)
    navigate({ to: "/skill/$skillName", params: { skillName: skill.name } })
  }

  const handleRefine = useCallback((skill: SkillSummary) => {
    navigate({ to: "/refine", search: { skill: skill.name } })
  }, [navigate])

  const handleDownload = useCallback(async (skill: SkillSummary) => {
    if (!workspacePath) return
    const toastId = toast.loading("Packaging skill...")
    try {
      const result = await packageSkill(skill.name, workspacePath)
      const savePath = await save({
        defaultPath: `${skill.name}.skill`,
        filters: [{ name: "Skill Package", extensions: ["skill"] }],
      })
      if (savePath) {
        await invoke("copy_file", { src: result.file_path, dest: savePath })
        toast.success("Skill downloaded", { id: toastId })
      } else {
        // User cancelled the save dialog
        toast.dismiss(toastId)
      }
    } catch (err) {
      toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId, duration: Infinity })
    }
  }, [workspacePath])

  const handlePushToRemote = useCallback(async (skill: SkillSummary) => {
    const toastId = toast.loading("Pushing skill to remote...")
    try {
      const result = await pushSkillToRemote(skill.name)
      toast.success(
        <div className="flex flex-col gap-1">
          <span>Skill pushed successfully!</span>
          <a
            href={result.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm underline"
          >
            View PR #{result.pr_number}
          </a>
        </div>,
        { id: toastId, duration: 8000 }
      )
    } catch (err) {
      toast.error(
        `Push failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: Infinity }
      )
    }
  }, [])

  function sharedSkillProps(skill: SkillSummary) {
    return {
      skill,
      isLocked: lockedSkills.has(skill.name),
      onContinue: handleContinue,
      onDelete: setDeleteTarget,
      onDownload: handleDownload,
      onEdit: setEditTarget,
      onEditWorkflow: handleEditWorkflow,
      onRefine: handleRefine,
      onPushToRemote: handlePushToRemote,
      remoteConfigured,
      isGitHubLoggedIn: isLoggedIn,
    }
  }

  function renderSkillContent(): React.ReactNode {
    if (loading) {
      if (viewMode === "list") {
        return (
          <div className="flex flex-col gap-1">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="grid grid-cols-[14%_22%_10%_22%_7rem_1fr] items-center gap-x-3 rounded-md border px-3 py-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <div className="flex gap-1">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-2 w-full" />
                <div className="flex gap-1 justify-self-end">
                  <Skeleton className="size-6 rounded-md" />
                  <Skeleton className="size-6 rounded-md" />
                  <Skeleton className="size-6 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        )
      }
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
      )
    }

    if (skills.length === 0) {
      return (
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
          {workspacePath && skillsPath && (
            <CardContent className="flex justify-center">
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                New Skill
              </Button>
            </CardContent>
          )}
        </Card>
      )
    }

    if (filteredSkills.length === 0 && isFiltering) {
      return (
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
      )
    }

    if (viewMode === "list") {
      return (
        <div className="flex flex-col gap-1">
          {filteredSkills.map((skill) => (
            <SkillListRow key={skill.name} {...sharedSkillProps(skill)} />
          ))}
        </div>
      )
    }

    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredSkills.map((skill) => (
          <SkillCard key={skill.name} {...sharedSkillProps(skill)} />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {workspacePath && skillsPath && (
        <div className="flex items-center justify-end gap-2">
          <TeamRepoImportDialog
            onImported={async () => { await Promise.all([loadSkills(), loadTags()]); }}
            remoteConfigured={remoteConfigured}
            isLoggedIn={isLoggedIn}
          />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New Skill
          </Button>
        </div>
      )}

      {!skillsPath && (
        <Card className="border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader className="flex flex-row items-start gap-3 pb-3">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <CardTitle className="text-base">Skills folder not configured</CardTitle>
              <CardDescription className="mt-1">
                Set a skills folder in Settings before creating skills. Finished outputs (SKILL.md, references, .skill packages) are saved there and won&apos;t be lost when the workspace is cleared.
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={() => navigate({ to: "/settings" })}>
              <Settings className="size-3.5" />
              Settings
            </Button>
          </CardHeader>
        </Card>
      )}

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
          <DashboardViewToggle value={viewMode} onChange={handleViewModeChange} />
        </div>
      )}

      {renderSkillContent()}

      {workspacePath && (
        <SkillDialog
          mode="create"
          workspacePath={workspacePath}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async () => { await Promise.all([loadSkills(), loadTags()]); }}
          tagSuggestions={availableTags}
          existingNames={existingSkillNames}
        />
      )}

      <SkillDialog
        mode="edit"
        skill={editTarget}
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null)
        }}
        onSaved={() => { loadSkills(); loadTags(); }}
        tagSuggestions={availableTags}
        existingNames={existingSkillNames}
      />

      <DeleteSkillDialog
        skill={deleteTarget}
        workspacePath={workspacePath}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onDeleted={() => { loadSkills(); loadTags(); }}
      />

    </div>
  )
}
