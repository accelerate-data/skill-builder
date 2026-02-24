import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useNavigate } from "@tanstack/react-router"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { FolderOpen, Search, Filter, AlertCircle, Settings, Plus, Github, ChevronUp, ChevronDown } from "lucide-react"
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
import GitHubImportDialog from "@/components/github-import-dialog"
import { useSettingsStore } from "@/stores/settings-store"
import { useSkillStore } from "@/stores/skill-store"
import { useWorkflowStore } from "@/stores/workflow-store"
import { packageSkill, getLockedSkills } from "@/lib/tauri"
import type { SkillSummary, AppSettings } from "@/lib/types"
import { PURPOSES, PURPOSE_LABELS } from "@/lib/types"
import { SOURCE_DISPLAY_LABELS } from "@/components/skill-source-badge"

function SortHeader({ label, column, sortBy, sortDir, onSort }: {
  label: string
  column: string
  sortBy: string
  sortDir: 'asc' | 'desc'
  onSort: (col: string) => void
}) {
  const isActive = sortBy === column
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1 text-left hover:text-foreground transition-colors"
      onClick={() => onSort(column)}
    >
      {label}
      {isActive && (sortDir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
    </button>
  )
}

export default function DashboardPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [workspacePath, setWorkspacePath] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [skillLibraryMarketplaceOpen, setSkillLibraryMarketplaceOpen] = useState(false)
  const pendingUpgrade = useSettingsStore((s) => s.pendingUpgradeOpen)
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null)
  const [editTarget, setEditTarget] = useState<SkillSummary | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedSources, setSelectedSources] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'in-progress'>('all')
  const [sortBy, setSortBy] = useState<string>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const navigate = useNavigate()
  const skillsPath = useSettingsStore((s) => s.skillsPath)
  const marketplaceUrl = useSettingsStore((s) => s.marketplaceUrl)
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
    } catch (err) {
      console.error("[dashboard] Failed to load skills:", err)
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  const loadTags = useCallback(async () => {
    try {
      const tags = await invoke<string[]>("get_all_tags")
      setAvailableTags(tags)
    } catch (err) {
      console.error("[dashboard] Failed to load tags:", err)
      setAvailableTags([])
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (pendingUpgrade?.mode === 'skill-library') {
      setSkillLibraryMarketplaceOpen(true)
      useSettingsStore.getState().setPendingUpgradeOpen(null)
    }
  }, [pendingUpgrade])

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
          (s.description && s.description.toLowerCase().includes(q)) ||
          (s.purpose && (PURPOSE_LABELS[s.purpose as keyof typeof PURPOSE_LABELS] || s.purpose).toLowerCase().includes(q))
      )
    }
    if (selectedTags.length > 0) {
      result = result.filter((s) =>
        selectedTags.every((tag) => s.tags?.includes(tag))
      )
    }
    if (selectedTypes.length > 0) {
      result = result.filter((s) =>
        s.purpose != null && selectedTypes.includes(s.purpose)
      )
    }
    if (selectedSources.length > 0) {
      result = result.filter((s) =>
        s.skill_source != null && selectedSources.includes(s.skill_source)
      )
    }
    if (statusFilter === 'completed') {
      result = result.filter((s) =>
        s.skill_source === 'marketplace' || s.skill_source === 'imported' || s.status === 'completed'
      )
    }
    if (statusFilter === 'in-progress') {
      result = result.filter((s) =>
        s.skill_source === 'skill-builder' && s.status !== 'completed'
      )
    }
    return result
  }, [skills, searchQuery, selectedTags, selectedTypes, selectedSources, statusFilter])

  const isFiltering =
    searchQuery.trim().length > 0 ||
    selectedTags.length > 0 ||
    selectedTypes.length > 0 ||
    selectedSources.length > 0 ||
    statusFilter !== 'all'

  const sortedSkills = useMemo(() => {
    if (!sortBy) return filteredSkills
    return [...filteredSkills].sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'source': cmp = (a.skill_source || '').localeCompare(b.skill_source || ''); break
        case 'type': cmp = (a.purpose || '').localeCompare(b.purpose || ''); break
        case 'status': {
          const aComplete = a.skill_source !== 'skill-builder' || a.status === 'completed'
          const bComplete = b.skill_source !== 'skill-builder' || b.status === 'completed'
          cmp = Number(aComplete) - Number(bComplete)
          break
        }
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredSkills, sortBy, sortDir])

  const handleSort = useCallback((column: string) => {
    if (sortBy === column) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortDir('asc')
    }
  }, [sortBy])

  const handleContinue = (skill: SkillSummary) => {
    if (skill.skill_source === 'marketplace') {
      navigate({ to: "/refine", search: { skill: skill.name } })
      return
    }
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

  const handleTest = useCallback((skill: SkillSummary) => {
    console.log("[dashboard] navigating to test: skill=%s", skill.name)
    navigate({ to: "/test", search: { skill: skill.name } })
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
      console.error("[dashboard] Download failed:", err)
      toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { id: toastId, duration: Infinity })
    }
  }, [workspacePath])

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
      onTest: handleTest,
    }
  }

  function renderSkillContent(): React.ReactNode {
    if (loading) {
      if (viewMode === "list") {
        return (
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            <table className="w-full table-auto border-separate border-spacing-0">
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td className="py-2.5 pl-4 border-b">
                      <Skeleton className="h-4 w-32 mb-1" />
                      <Skeleton className="h-3 w-16" />
                    </td>
                    <td className="hidden sm:table-cell py-2.5 border-b">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </td>
                    <td className="hidden sm:table-cell py-2.5 border-b">
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </td>
                    <td className="py-2.5 pr-4 border-b">
                      <div className="flex gap-1 justify-end">
                        <Skeleton className="size-6 rounded-md" />
                        <Skeleton className="size-6 rounded-md" />
                        <Skeleton className="size-6 rounded-md" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              Skills are knowledge packages that teach Claude your team's specific processes, systems, and standards. Create your first skill to get started.
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
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <table className="w-full table-auto border-separate border-spacing-0">
            <thead className="sticky top-0 z-10 bg-background">
              <tr className="hidden sm:table-row">
                <th scope="col" className="pl-4 py-1.5 text-left text-sm font-semibold text-muted-foreground border-b-2 border-border">
                  <SortHeader label="Name" column="name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th scope="col" className="py-1.5 text-left text-sm font-semibold text-muted-foreground border-b-2 border-border">
                  <SortHeader label="Source" column="source" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th scope="col" className="py-1.5 text-left text-sm font-semibold text-muted-foreground border-b-2 border-border">
                  <SortHeader label="Status" column="status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                </th>
                <th scope="col" className="pr-4 py-1.5 text-right text-sm font-semibold text-muted-foreground border-b-2 border-border">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedSkills.map((skill) => (
                <SkillListRow key={skill.name} {...sharedSkillProps(skill)} />
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sortedSkills.map((skill) => (
          <SkillCard key={skill.name} {...sharedSkillProps(skill)} />
        ))}
      </div>
    )
  }

  return (
    <div className={viewMode === "list" ? "flex flex-col h-full gap-6 p-6" : "flex flex-col gap-6 p-6"}>
      {workspacePath && skillsPath && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setSkillLibraryMarketplaceOpen(true)}
            disabled={!marketplaceUrl}
            title={!marketplaceUrl ? "Configure marketplace URL in Settings → GitHub" : undefined}
          >
            <Github className="size-4" />
            Marketplace
          </Button>
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
              {PURPOSES.map((type) => (
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
                  {PURPOSE_LABELS[type]}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="size-4" />
                Source
                {selectedSources.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                    {selectedSources.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Filter by source</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.entries(SOURCE_DISPLAY_LABELS).map(([key, label]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={selectedSources.includes(key)}
                  onCheckedChange={() => {
                    setSelectedSources((prev) =>
                      prev.includes(key)
                        ? prev.filter((s) => s !== key)
                        : [...prev, key]
                    )
                  }}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
              {selectedSources.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <button
                    type="button"
                    className="w-full px-2 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setSelectedSources([])}
                  >
                    Clear all
                  </button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Filter className="size-4" />
                Status
                {statusFilter !== 'all' && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
                    1
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={statusFilter === 'all'}
                onCheckedChange={() => setStatusFilter('all')}
              >
                All
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter === 'completed'}
                onCheckedChange={() => setStatusFilter('completed')}
              >
                Completed
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter === 'in-progress'}
                onCheckedChange={() => setStatusFilter('in-progress')}
              >
                In Progress
              </DropdownMenuCheckboxItem>
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
        isLocked={editTarget ? lockedSkills.has(editTarget.name) : false}
      />

      <DeleteSkillDialog
        skill={deleteTarget}
        workspacePath={workspacePath}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onDeleted={() => { loadSkills(); loadTags(); }}
        isLocked={deleteTarget ? lockedSkills.has(deleteTarget.name) : false}
      />

      <GitHubImportDialog
        open={skillLibraryMarketplaceOpen}
        onOpenChange={setSkillLibraryMarketplaceOpen}
        onImported={async () => { await Promise.all([loadSkills(), loadTags()]); }}
        mode="skill-library"
        url={marketplaceUrl ?? ""}
        workspacePath={workspacePath}
      />

    </div>
  )
}
