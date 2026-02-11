import { useState } from "react"
import { Eye, Trash2 } from "lucide-react"
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
import type { ImportedSkill } from "@/stores/imported-skills-store"
import { cn } from "@/lib/utils"

interface ImportedSkillCardProps {
  skill: ImportedSkill
  onToggleActive: (skillName: string, active: boolean) => void
  onDelete: (skill: ImportedSkill) => void
  onPreview: (skill: ImportedSkill) => void
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

  return (
    <Card className={cn(!skill.is_active && "opacity-60")}>
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
        {skill.domain && (
          <Badge variant="outline" className="w-fit text-xs">
            {skill.domain}
          </Badge>
        )}
      </CardHeader>

      <CardContent>
        {skill.description ? (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {skill.description}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No description
          </p>
        )}
      </CardContent>

      <CardFooter className="flex items-center justify-between">
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
        </div>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(skill.imported_at)}
        </span>
      </CardFooter>
    </Card>
  )
}
