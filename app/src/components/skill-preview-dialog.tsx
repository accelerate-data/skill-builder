import { useState, useEffect } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeSanitize from "rehype-sanitize"
import { markdownComponents } from "@/components/markdown-link"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { getSkillContent } from "@/lib/tauri"
import type { ImportedSkill } from "@/lib/types"

interface SkillPreviewDialogProps {
  skill: ImportedSkill | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function SkillPreviewDialog({
  skill,
  open,
  onOpenChange,
}: SkillPreviewDialogProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !skill) {
      setContent(null)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    getSkillContent(skill.skill_name)
      .then((result) => {
        if (!cancelled) {
          setContent(result)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[skill-preview] Failed to load skill content:", err)
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, skill])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{skill?.skill_name ?? "Skill Preview"}</DialogTitle>
          <DialogDescription>
            SKILL.md content preview
          </DialogDescription>
        </DialogHeader>

        {skill?.argument_hint && (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">Trigger</span>
            <p className="text-sm text-muted-foreground italic">{skill.argument_hint}</p>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="py-8 text-center text-sm text-destructive">
              Failed to load skill content: {error}
            </div>
          ) : content ? (
            <div className="markdown-body compact pr-3 overflow-x-hidden break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
                {content}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No content available.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
