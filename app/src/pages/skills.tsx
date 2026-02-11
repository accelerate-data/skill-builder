import { useState, useEffect, useCallback } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Upload, Package } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import ImportedSkillCard from "@/components/imported-skill-card"
import SkillPreviewDialog from "@/components/skill-preview-dialog"
import { useImportedSkillsStore } from "@/stores/imported-skills-store"
import type { ImportedSkill } from "@/stores/imported-skills-store"

export default function SkillsPage() {
  const {
    skills,
    isLoading,
    fetchSkills,
    uploadSkill,
    toggleActive,
    deleteSkill,
  } = useImportedSkillsStore()

  const [previewSkill, setPreviewSkill] = useState<ImportedSkill | null>(null)

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  const handleUpload = useCallback(async () => {
    const filePath = await open({
      title: "Import Skill Package",
      filters: [{ name: "Skill Package", extensions: ["skill"] }],
    })
    if (!filePath) return

    const toastId = toast.loading("Importing skill...")
    try {
      const skill = await uploadSkill(filePath)
      toast.success(`Imported "${skill.skill_name}"`, { id: toastId })
    } catch (err) {
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: toastId, duration: Infinity }
      )
    }
  }, [uploadSkill])

  const handleToggleActive = useCallback(
    async (skillName: string, active: boolean) => {
      try {
        await toggleActive(skillName, active)
        toast.success(
          active ? `"${skillName}" activated` : `"${skillName}" deactivated`,
          { duration: 1500 }
        )
      } catch (err) {
        toast.error(
          `Failed to toggle: ${err instanceof Error ? err.message : String(err)}`,
          { duration: Infinity }
        )
      }
    },
    [toggleActive]
  )

  const handleDelete = useCallback(
    async (skill: ImportedSkill) => {
      const toastId = toast.loading(`Deleting "${skill.skill_name}"...`)
      try {
        await deleteSkill(skill.skill_name)
        toast.success(`Deleted "${skill.skill_name}"`, { id: toastId })
      } catch (err) {
        toast.error(
          `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
          { id: toastId, duration: Infinity }
        )
      }
    },
    [deleteSkill]
  )

  const handlePreview = useCallback((skill: ImportedSkill) => {
    setPreviewSkill(skill)
  }, [])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Skills Library</h1>
        <Button onClick={handleUpload}>
          <Upload className="size-4" />
          Upload Skill
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : skills.length === 0 ? (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-muted">
              <Package className="size-6 text-muted-foreground" />
            </div>
            <CardTitle>No imported skills</CardTitle>
            <CardDescription>
              Upload a .skill package to add it to your library.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={handleUpload}>
              <Upload className="size-4" />
              Upload Skill
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((skill) => (
            <ImportedSkillCard
              key={skill.skill_id}
              skill={skill}
              onToggleActive={handleToggleActive}
              onDelete={handleDelete}
              onPreview={handlePreview}
            />
          ))}
        </div>
      )}

      <SkillPreviewDialog
        skill={previewSkill}
        open={previewSkill !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewSkill(null)
        }}
      />
    </div>
  )
}
