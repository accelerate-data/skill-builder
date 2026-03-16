import { useState } from "react"
import { LayoutGrid, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import SkillDialog from "@/components/skill-dialog"
import { useSettingsStore } from "@/stores/settings-store"
import { useSkillStore } from "@/stores/skill-store"
import { listSkills } from "@/lib/tauri"

export default function DashboardPage() {
  const [createOpen, setCreateOpen] = useState(false)
  const workspacePath = useSettingsStore((s) => s.workspacePath)
  const setSkills = useSkillStore((s) => s.setSkills)

  return (
    <div
      className="flex h-full items-center justify-center"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Ccircle cx='1' cy='1' r='1' fill='%23000' fill-opacity='0.035'/%3E%3C/svg%3E\")",
      }}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted">
          <LayoutGrid className="size-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold tracking-tight">Select a skill</h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            Choose a skill from the list to open its workspace, or create a new one.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" />
          New Skill
        </Button>
      </div>

      {workspacePath && (
        <SkillDialog
          mode="create"
          workspacePath={workspacePath}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async () => {
            if (workspacePath) {
              listSkills(workspacePath).then(setSkills).catch(() => {})
            }
          }}
        />
      )}
    </div>
  )
}
