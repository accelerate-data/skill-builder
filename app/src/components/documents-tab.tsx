import { useEffect, useRef, useState } from "react"
import { Trash2, Link, FolderOpen, Upload, Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDocumentStore } from "@/stores/document-store"
import {
  addDocumentFile,
  addDocumentUrl,
  addDocumentFolder,
  updateDocument,
  deleteDocument,
  listSkillsForDocuments,
  type SkillIdName,
} from "@/lib/tauri"
import type { Document } from "@/lib/types"
import { open as openFileDialog } from "@tauri-apps/plugin-dialog"

// ---------------------------------------------------------------------------
// Add URL dialog
// ---------------------------------------------------------------------------

interface AddUrlDialogProps {
  skills: SkillIdName[]
  onAdd: (doc: Document) => void
  onClose: () => void
}

function AddUrlDialog({ skills, onAdd, onClose }: AddUrlDialogProps) {
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [scope, setScope] = useState<"all" | "skill">("all")
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggle = (id: number) =>
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return
    setLoading(true)
    setError(null)
    try {
      const doc = await addDocumentUrl(
        name.trim(),
        url.trim(),
        scope,
        scope === "skill" ? selectedSkillIds : [],
      )
      onAdd(doc)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg p-6 w-full max-w-md space-y-4 shadow-lg">
        <h3 className="text-base font-semibold">Add document from URL</h3>

        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fabric Release Notes" />
        </div>

        <div className="space-y-2">
          <Label>URL</Label>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </div>

        <AssignmentPicker scope={scope} setScope={setScope} selectedSkillIds={selectedSkillIds} toggle={toggle} skills={skills} inline />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={loading || !name.trim() || !url.trim()}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Fetch &amp; Add
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assignment picker (reusable)
// ---------------------------------------------------------------------------

interface AssignmentPickerProps {
  scope: "all" | "skill"
  setScope: (s: "all" | "skill") => void
  selectedSkillIds: number[]
  toggle: (id: number) => void
  skills: SkillIdName[]
  inline?: boolean
}

function AssignmentPicker({ scope, setScope, selectedSkillIds, toggle, skills, inline }: AssignmentPickerProps) {
  return (
    <div className={inline ? "space-y-3" : undefined}>
      {inline && <Label>Assign to</Label>}
      <RadioGroup value={scope} onValueChange={(v) => setScope(v as "all" | "skill")} className="space-y-1">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="all" id="scope-all" />
          <Label htmlFor="scope-all" className="text-sm font-normal cursor-pointer">All skills</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="skill" id="scope-skill" />
          <Label htmlFor="scope-skill" className="text-sm font-normal cursor-pointer">Specific skills</Label>
        </div>
      </RadioGroup>

      {scope === "skill" && (
        <div className="ml-5 space-y-1 max-h-40 overflow-y-auto">
          {skills.length === 0 ? (
            <p className="text-xs text-muted-foreground">No skills found</p>
          ) : (
            skills.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <Checkbox
                  id={`skill-${s.id}`}
                  checked={selectedSkillIds.includes(s.id)}
                  onCheckedChange={() => toggle(s.id)}
                />
                <Label htmlFor={`skill-${s.id}`} className="text-sm font-normal cursor-pointer">{s.name}</Label>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Assigned-to popover in table row
// ---------------------------------------------------------------------------

interface AssignmentCellProps {
  doc: Document
  skills: SkillIdName[]
  onChange: (updated: Document) => void
}

function AssignmentCell({ doc, skills, onChange }: AssignmentCellProps) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<"all" | "skill">(doc.scope)
  const [selectedSkillIds, setSelectedSkillIds] = useState<number[]>(doc.skill_ids)
  const [saving, setSaving] = useState(false)

  const toggle = (id: number) =>
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )

  const save = async () => {
    setSaving(true)
    try {
      const updated = await updateDocument(doc.id, scope, scope === "skill" ? selectedSkillIds : [])
      onChange(updated)
      setOpen(false)
    } catch (e) {
      console.error("event=update_document_failed error=%s", e)
    } finally {
      setSaving(false)
    }
  }

  const label = doc.scope === "all"
    ? "All skills"
    : doc.skill_ids.length === 0
    ? "No skills"
    : doc.skill_ids.length === 1
    ? (skills.find((s) => s.id === doc.skill_ids[0])?.name ?? "1 skill")
    : `${doc.skill_ids.length} skills`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="text-sm text-left underline decoration-dotted text-muted-foreground hover:text-foreground transition-colors duration-150">
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 space-y-3">
        <AssignmentPicker scope={scope} setScope={setScope} selectedSkillIds={selectedSkillIds} toggle={toggle} skills={skills} />
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Main DocumentsTab
// ---------------------------------------------------------------------------

export function DocumentsTab() {
  const { documents, isLoading, fetchDocuments, removeDocument, upsertDocument } = useDocumentStore()
  const [skills, setSkills] = useState<SkillIdName[]>([])
  const [showUrlDialog, setShowUrlDialog] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchDocuments()
    listSkillsForDocuments()
      .then(setSkills)
      .catch((e) => console.error("event=list_skills_for_documents_failed error=%s", e))
  }, [fetchDocuments])

  // ---------------------------------------------------------------------------
  // Upload file
  // ---------------------------------------------------------------------------
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const content = await file.text()
      const name = file.name.replace(/\.(md|txt|pdf)$/i, "")
      const doc = await addDocumentFile(name, content, "all", [])
      upsertDocument(doc)
    } catch (err) {
      console.error("event=add_document_file_failed error=%s", err)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  // ---------------------------------------------------------------------------
  // Add folder (using Tauri dialog plugin)
  // ---------------------------------------------------------------------------
  const handleAddFolder = async () => {
    try {
      const selected = await openFileDialog({ directory: true, multiple: false })
      if (!selected || typeof selected !== "string") return
      const folderName = selected.split("/").pop() ?? "Folder"
      const docs = await addDocumentFolder(folderName, selected, "all", [])
      docs.forEach(upsertDocument)
      await fetchDocuments()
    } catch (err) {
      console.error("event=add_document_folder_failed error=%s", err)
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------
  const handleDelete = async (id: number) => {
    try {
      await deleteDocument(id)
      removeDocument(id)
    } catch (err) {
      console.error("event=delete_document_failed error=%s", err)
    }
  }

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    } catch {
      return iso
    }
  }

  const sourceLabel = (doc: Document) => {
    if (doc.source_type === "url") return "url"
    if (doc.source_type === "folder") return "folder"
    return "file"
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Documents</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload files or add URLs to inject as reference context into skill workflows.
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
          Upload file
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.pdf"
          className="hidden"
          onChange={handleFileUpload}
        />
        <Button variant="outline" size="sm" onClick={() => setShowUrlDialog(true)}>
          <Link className="h-3.5 w-3.5 mr-1.5" />
          Add URL
        </Button>
        <Button variant="outline" size="sm" onClick={handleAddFolder}>
          <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
          Add folder
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading documents…
        </div>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No documents added yet. Upload a file or add a URL to get started.
        </p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-16">Source</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Assigned to</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground w-20">Added</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors duration-150">
                  <td className="px-4 py-2.5 font-medium truncate max-w-xs">{doc.name}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{sourceLabel(doc)}</td>
                  <td className="px-4 py-2.5">
                    <AssignmentCell doc={doc} skills={skills} onChange={upsertDocument} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDate(doc.created_at)}</td>
                  <td className="px-2 py-2.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(doc.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showUrlDialog && (
        <AddUrlDialog
          skills={skills}
          onAdd={upsertDocument}
          onClose={() => setShowUrlDialog(false)}
        />
      )}
    </div>
  )
}
