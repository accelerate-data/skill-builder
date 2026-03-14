import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { FolderOpen, FolderSearch } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { normalizeDirectoryPickerPath } from "@/lib/utils"
import { getDataDir } from "@/lib/tauri"

interface AdvancedSectionProps {
  logLevel: string
  setLogLevel: (v: string) => void
  skillsPath: string | null
  setSkillsPath: (v: string | null) => void
  autoSave: (overrides: Record<string, unknown>) => void
}

export function AdvancedSection({
  logLevel,
  setLogLevel,
  skillsPath,
  setSkillsPath,
  autoSave,
}: AdvancedSectionProps) {
  const [dataDir, setDataDir] = useState<string | null>(null)

  useEffect(() => {
    getDataDir()
      .then((dir) => setDataDir(dir))
      .catch(() => setDataDir(null))
  }, [])

  const handleBrowseSkillsPath = async () => {
    const folder = await open({ directory: true, title: "Select Skills Folder" })
    if (folder) {
      const normalized = normalizeDirectoryPickerPath(folder)
      setSkillsPath(normalized)
      autoSave({ skillsPath: normalized })
    }
  }

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Logging</CardTitle>
          <CardDescription>
            Configure application logging level. Chat transcripts (JSONL) are always captured regardless of level.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="log-level-select">Log Level</Label>
            <div className="flex items-center gap-3">
              <Select
                value={logLevel}
                onValueChange={(val) => {
                  setLogLevel(val)
                  autoSave({ logLevel: val })
                  invoke("set_log_level", { level: val }).catch((e) => console.warn("[settings] non-fatal: op=set_log_level err=%s", e))
                }}
              >
                <SelectTrigger id="log-level-select" className="w-fit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="warn">Warn</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="debug">Debug</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">
                {{ error: "Only errors", warn: "Errors + warnings", info: "Errors + warnings + lifecycle (default)", debug: "Everything (verbose)" }[logLevel]}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>
            Manage application directories.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label>Skills Folder</Label>
            <div className="flex items-center gap-2">
              <FolderOpen className="size-4 text-muted-foreground" />
              <code className="text-sm text-muted-foreground flex-1">
                {skillsPath || "Not configured"}
              </code>
              <Button variant="outline" size="sm" onClick={handleBrowseSkillsPath}>
                <FolderSearch className="size-4" />
                Browse
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Data Directory</Label>
            <div className="flex items-center gap-2">
              <FolderOpen className="size-4 text-muted-foreground" />
              <code className="text-sm text-muted-foreground flex-1">
                {dataDir || "Unknown"}
              </code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
