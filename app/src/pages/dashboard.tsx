import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "@tanstack/react-router"
import { invoke } from "@tauri-apps/api/core"
import { Link } from "@tanstack/react-router"
import { Loader2, FolderOpen, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import SkillCard from "@/components/skill-card"
import NewSkillDialog from "@/components/new-skill-dialog"
import DeleteSkillDialog from "@/components/delete-skill-dialog"
import type { SkillSummary, AppSettings } from "@/lib/types"

export default function DashboardPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [workspacePath, setWorkspacePath] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<SkillSummary | null>(null)
  const [workspaceWarning, setWorkspaceWarning] = useState(false)
  const navigate = useNavigate()

  const loadSettings = useCallback(async () => {
    try {
      const settings = await invoke<AppSettings>("get_settings")
      const wp = settings.workspace_path || ""
      setWorkspacePath(wp)

      if (wp) {
        try {
          const exists = await invoke<boolean>("check_workspace_path", { workspacePath: wp })
          setWorkspaceWarning(!exists)
        } catch {
          setWorkspaceWarning(false)
        }
      } else {
        setWorkspaceWarning(false)
      }
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

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    loadSkills()
  }, [loadSkills])

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
            onCreated={loadSkills}
          />
        )}
      </div>

      {workspaceWarning && (
        <Card className="border-amber-500/50 bg-amber-500/10">
          <CardHeader className="flex-row items-center gap-3 py-3">
            <TriangleAlert className="size-5 shrink-0 text-amber-500" />
            <div className="flex-1 space-y-1">
              <CardTitle className="text-sm font-medium">
                Workspace folder not found
              </CardTitle>
              <CardDescription className="text-sm">
                The configured workspace path no longer exists on disk. Please reconfigure it in Settings.
              </CardDescription>
            </div>
            <Link to="/settings">
              <Button variant="outline" size="sm">
                Open Settings
              </Button>
            </Link>
          </CardHeader>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : skills.length === 0 ? (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
              <FolderOpen className="size-6 text-muted-foreground" />
            </div>
            <CardTitle>No skills yet</CardTitle>
            <CardDescription>
              {workspacePath
                ? "Create your first skill to get started."
                : "Configure a workspace path in Settings to get started."}
            </CardDescription>
          </CardHeader>
          {workspacePath && (
            <CardContent className="flex justify-center">
              <NewSkillDialog
                workspacePath={workspacePath}
                onCreated={loadSkills}
              />
            </CardContent>
          )}
          {!workspacePath && (
            <CardContent className="flex justify-center">
              <Button variant="outline" asChild>
                <a href="/settings">Open Settings</a>
              </Button>
            </CardContent>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
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
        onDeleted={loadSkills}
      />
    </div>
  )
}
