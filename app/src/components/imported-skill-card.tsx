import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Download, Eye, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { exportSkill } from "@/lib/tauri"
import type { WorkspaceSkill } from "@/stores/imported-skills-store"
import { cn } from "@/lib/utils"

interface ImportedSkillCardProps {
  skill: WorkspaceSkill
  onToggleActive: (skillName: string, active: boolean) => void
  onDelete: (skill: WorkspaceSkill) => void
  onPreview: (skill: WorkspaceSkill) => void
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)

    if (diffMinutes < 1) return "just now"
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  } catch {
    return ""
  }
}

export default function ImportedSkillCard({
  skill,
  onToggleActive,
  onDelete,
  onPreview,
}: ImportedSkillCardProps) {
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const handleDelete = () => {
    if (deleteConfirm) {
      onDelete(skill)
      setDeleteConfirm(false)
    } else {
      setDeleteConfirm(true)
      // Auto-reset after 3 seconds
      setTimeout(() => setDeleteConfirm(false), 3000)
    }
  }

  const handleDownload = async () => {
    const toastId = toast.loading("Exporting skill...")
    try {
      const zipPath = await exportSkill(skill.skill_name)
      const savePath = await save({
        defaultPath: `${skill.skill_name}.zip`,
        filters: [{ name: "Zip Archive", extensions: ["zip"] }],
      })
      if (savePath) {
        await invoke("copy_file", { src: zipPath, dest: savePath })
        toast.success(`Saved to ${savePath}`, { id: toastId })
      } else {
        toast.dismiss(toastId)
      }
    } catch (err) {
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: Infinity }
      )
    }
  }

  return (
    <Card className={cn("flex flex-col", !skill.is_active && "opacity-60")}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">{skill.skill_name}</CardTitle>
          <Switch
            size="sm"
            checked={skill.is_active}
            onCheckedChange={(checked) =>
              onToggleActive(skill.skill_name, checked)
            }
            aria-label={`Toggle ${skill.skill_name} active`}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {skill.is_bundled && (
            <Badge variant="secondary" className="w-fit text-xs">
              Built-in
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1">
        {skill.argument_hint && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {skill.argument_hint}
          </p>
        )}
        {!skill.argument_hint && skill.description && (
          <p className="text-sm text-muted-foreground italic line-clamp-2">
            {skill.description} — no trigger set
          </p>
        )}
        {!skill.argument_hint && !skill.description && (
          <p className="text-sm text-muted-foreground italic">
            No trigger set
          </p>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between mt-auto">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPreview(skill)}
          >
            <Eye className="size-3" />
            Preview
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Download skill"
            onClick={handleDownload}
          >
            <Download className="size-3" />
          </Button>
          {!skill.is_bundled && (
            <Button
              variant={deleteConfirm ? "destructive" : "ghost"}
              size="icon-xs"
              className={cn(
                !deleteConfirm && "text-muted-foreground hover:text-destructive"
              )}
              aria-label={deleteConfirm ? "Confirm delete" : "Delete skill"}
              onClick={handleDelete}
            >
              <Trash2 className="size-3" />
            </Button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(skill.imported_at)}
        </span>
      </CardFooter>
    </Card>
  )
}
