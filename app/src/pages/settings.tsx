import { useState, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { Loader2, Eye, EyeOff, Save, CheckCircle2, XCircle, ExternalLink, FolderOpen, ChevronsUpDown, Search, Lock, Globe, RefreshCw, Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import type { AppSettings } from "@/lib/types"
import { checkNode, listGithubRepos, cloneRepo, commitAndPush, type NodeStatus, type GitHubRepo } from "@/lib/tauri"

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    anthropic_api_key: null,
    github_token: null,
    github_repo: null,
    workspace_path: null,
    auto_commit: false,
    auto_push: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [apiKeyValid, setApiKeyValid] = useState<boolean | null>(null)
  const [testingGh, setTestingGh] = useState(false)
  const [ghTokenValid, setGhTokenValid] = useState<boolean | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [showGhToken, setShowGhToken] = useState(false)
  const [nodeStatus, setNodeStatus] = useState<NodeStatus | null>(null)
  const [nodeLoading, setNodeLoading] = useState(true)
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [reposLoading, setReposLoading] = useState(false)
  const [repoSearch, setRepoSearch] = useState("")
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false)
  const [selectedRepoObj, setSelectedRepoObj] = useState<GitHubRepo | null>(null)
  const [cloning, setCloning] = useState(false)
  const [cloned, setCloned] = useState(false)
  const repoDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await invoke<AppSettings>("get_settings")
          if (!cancelled) {
            setSettings(result)
            setLoading(false)
          }
          return
        } catch (err) {
          console.error(`Failed to load settings (attempt ${attempt}/3):`, err)
          if (attempt < 3) await new Promise((r) => setTimeout(r, 500))
        }
      }
      // All retries exhausted
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const check = async () => {
      setNodeLoading(true)
      try {
        const result = await checkNode()
        setNodeStatus(result)
      } catch {
        setNodeStatus({ available: false, version: null, meets_minimum: false, error: "Failed to check Node.js" })
      } finally {
        setNodeLoading(false)
      }
    }
    check()
  }, [])

  // Close repo dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target as Node)) {
        setRepoDropdownOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleFetchRepos = async () => {
    if (!settings.github_token) {
      toast.error("Enter and test a GitHub token first")
      return
    }
    setReposLoading(true)
    try {
      const result = await listGithubRepos(settings.github_token)
      setRepos(result)
      setRepoDropdownOpen(true)
    } catch (err) {
      toast.error(`Failed to fetch repos: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setReposLoading(false)
    }
  }

  const handleSelectRepo = (repo: GitHubRepo) => {
    setSettings((s) => ({ ...s, github_repo: repo.full_name }))
    setSelectedRepoObj(repo)
    setRepoDropdownOpen(false)
    setRepoSearch("")
  }

  const handleCloneRepo = async () => {
    if (!selectedRepoObj || !settings.workspace_path || !settings.github_token) {
      toast.error("Select a repo, folder, and ensure your GitHub token is set")
      return
    }
    setCloning(true)
    setCloned(false)
    try {
      const result = await cloneRepo(
        selectedRepoObj.clone_url,
        settings.workspace_path,
        settings.github_token,
      )
      setCloned(true)
      const seeded: string[] = []
      if (result.created_readme) seeded.push("README.md")
      if (result.created_gitignore) seeded.push(".gitignore")
      if (seeded.length > 0) {
        toast.success(`Cloned and seeded ${seeded.join(" & ")}`)
      } else {
        toast.success("Cloned successfully — README and .gitignore already existed")
      }
    } catch (err) {
      toast.error(`${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setCloning(false)
    }
  }

  const handleBrowseFolder = async () => {
    const selected = await open({ directory: true, title: "Select workspace folder" })
    if (selected) {
      setSettings((s) => ({ ...s, workspace_path: selected }))
    }
  }

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  )

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await invoke("save_settings", { settings })
      setSaved(true)
      setSaving(false)
      setTimeout(() => setSaved(false), 3000)

      // Commit and push in background if we have a cloned repo with a token
      if (settings.workspace_path && settings.github_token) {
        try {
          const result = await commitAndPush(
            settings.workspace_path,
            "Update settings via Skill Builder",
            settings.github_token,
          )
          if (result === "No changes to commit") {
            toast.success("Settings saved — no repo changes to push")
          } else {
            toast.success("Settings saved, committed & pushed")
          }
        } catch {
          // Repo may not be cloned yet — just save settings
          toast.success("Settings saved")
        }
      } else {
        toast.success("Settings saved")
      }
    } catch (err) {
      setSaving(false)
      toast.error(
        `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  const handleTestGhToken = async () => {
    if (!settings.github_token) {
      toast.error("Enter a GitHub token first")
      return
    }
    setTestingGh(true)
    setGhTokenValid(null)
    try {
      const user = await invoke<{ login: string }>("get_current_user", {
        token: settings.github_token,
      })
      setGhTokenValid(true)
      toast.success(`Authenticated as ${user.login}`)
    } catch (err) {
      setGhTokenValid(false)
      toast.error(
        `Invalid token: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setTestingGh(false)
    }
  }

  const handleTestApiKey = async () => {
    if (!settings.anthropic_api_key) {
      toast.error("Enter an API key first")
      return
    }
    setTesting(true)
    setApiKeyValid(null)
    try {
      await invoke("test_api_key", { apiKey: settings.anthropic_api_key })
      setApiKeyValid(true)
      toast.success("API key is valid")
    } catch (err) {
      setApiKeyValid(false)
      toast.error(
        `Invalid API key: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>API Configuration</CardTitle>
          <CardDescription>
            Configure your Anthropic API key for skill building.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="api-key">Anthropic API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="api-key"
                  type={showApiKey ? "text" : "password"}
                  placeholder="sk-ant-..."
                  value={settings.anthropic_api_key || ""}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      anthropic_api_key: e.target.value || null,
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowApiKey(!showApiKey)}
                >
                  {showApiKey ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </Button>
              </div>
              <Button
                variant={apiKeyValid ? "default" : "outline"}
                size="sm"
                onClick={handleTestApiKey}
                disabled={testing || !settings.anthropic_api_key}
                className={apiKeyValid ? "bg-green-600 hover:bg-green-700 text-white" : ""}
              >
                {testing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : apiKeyValid ? (
                  <CheckCircle2 className="size-3.5" />
                ) : null}
                {apiKeyValid ? "Valid" : "Test"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* GitHub Token */}
      <Card>
        <CardHeader>
          <CardTitle>GitHub Token</CardTitle>
          <CardDescription>
            Personal access token for git operations.{" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=Skill+Builder"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Create one <ExternalLink className="size-3" />
            </a>
            {" "}with <code className="text-xs bg-muted px-1 rounded">repo</code> scope.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showGhToken ? "text" : "password"}
                placeholder="ghp_..."
                value={settings.github_token || ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    github_token: e.target.value || null,
                  }))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={() => setShowGhToken(!showGhToken)}
              >
                {showGhToken ? (
                  <EyeOff className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </Button>
            </div>
            <Button
              variant={ghTokenValid ? "default" : "outline"}
              size="sm"
              onClick={handleTestGhToken}
              disabled={testingGh || !settings.github_token}
              className={ghTokenValid ? "bg-green-600 hover:bg-green-700 text-white" : ""}
            >
              {testingGh ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : ghTokenValid ? (
                <CheckCircle2 className="size-3.5" />
              ) : null}
              {ghTokenValid ? "Valid" : "Test"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Node.js Runtime</CardTitle>
          <CardDescription>
            Required for running AI agents. Minimum version: 18.0.0
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nodeLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking Node.js...
            </div>
          ) : nodeStatus?.available && nodeStatus.meets_minimum ? (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="gap-1 bg-green-600">
                <CheckCircle2 className="size-3" />
                Available
              </Badge>
              <span className="text-sm text-muted-foreground">
                v{nodeStatus.version}
              </span>
            </div>
          ) : nodeStatus?.available && !nodeStatus.meets_minimum ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="size-3" />
                  Version too old
                </Badge>
                <span className="text-sm text-muted-foreground">
                  v{nodeStatus.version} (need 18.0.0+)
                </span>
              </div>
              <a
                href="https://nodejs.org"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Download Node.js
                <ExternalLink className="size-3" />
              </a>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="destructive" className="gap-1">
                  <XCircle className="size-3" />
                  Not found
                </Badge>
                {nodeStatus?.error && (
                  <span className="text-sm text-muted-foreground">
                    {nodeStatus.error}
                  </span>
                )}
              </div>
              <a
                href="https://nodejs.org"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Download Node.js
                <ExternalLink className="size-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GitHub Repository</CardTitle>
          <CardDescription>
            Select a repository and local folder for skill storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Repository</Label>
            <div className="relative" ref={repoDropdownRef}>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 justify-between font-normal"
                  onClick={() => {
                    if (repos.length > 0) {
                      setRepoDropdownOpen(!repoDropdownOpen)
                    } else {
                      handleFetchRepos()
                    }
                  }}
                  disabled={reposLoading || !settings.github_token}
                >
                  <span className={settings.github_repo ? "" : "text-muted-foreground"}>
                    {reposLoading ? "Loading repos..." : settings.github_repo || "Select a repository"}
                  </span>
                  {reposLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ChevronsUpDown className="size-4 opacity-50" />
                  )}
                </Button>
              </div>
              {repoDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
                  <div className="flex items-center border-b px-3">
                    <Search className="size-4 text-muted-foreground" />
                    <input
                      className="flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
                      placeholder="Search repos..."
                      value={repoSearch}
                      onChange={(e) => setRepoSearch(e.target.value)}
                    />
                    <button
                      className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                      title="Refresh repos"
                      onClick={handleFetchRepos}
                      disabled={reposLoading}
                    >
                      <RefreshCw className={`size-3.5 ${reposLoading ? "animate-spin" : ""}`} />
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto p-1">
                    {filteredRepos.length === 0 ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">No repos found</p>
                    ) : (
                      filteredRepos.map((repo) => (
                        <button
                          key={repo.full_name}
                          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                          onClick={() => handleSelectRepo(repo)}
                        >
                          {repo.private ? (
                            <Lock className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Globe className="size-3.5 text-muted-foreground" />
                          )}
                          <span className="flex-1 text-left">{repo.full_name}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            {!settings.github_token && (
              <p className="text-xs text-muted-foreground">
                Add a GitHub token above to browse your repos
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-path">Clone Destination</Label>
            <div className="flex gap-2">
              <Input
                id="workspace-path"
                placeholder="Select a folder..."
                value={settings.workspace_path || ""}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    workspace_path: e.target.value || null,
                  }))
                }
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleBrowseFolder}
              >
                <FolderOpen className="size-4" />
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Local directory where the repo will be cloned
            </p>
          </div>

          <Button
            onClick={handleCloneRepo}
            disabled={cloning || !settings.github_repo || !settings.workspace_path || !settings.github_token}
            className={`w-full ${cloned ? "bg-green-600 hover:bg-green-700 text-white" : ""}`}
          >
            {cloning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : cloned ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Download className="size-4" />
            )}
            {cloning ? "Cloning..." : cloned ? "Cloned" : "Clone & Setup"}
          </Button>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto-commit">Auto-commit</Label>
              <p className="text-xs text-muted-foreground">
                Automatically commit after each workflow step
              </p>
            </div>
            <Switch
              id="auto-commit"
              checked={settings.auto_commit}
              onCheckedChange={(checked) =>
                setSettings((s) => ({ ...s, auto_commit: checked }))
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto-push">Auto-push</Label>
              <p className="text-xs text-muted-foreground">
                Push to GitHub after each commit
              </p>
            </div>
            <Switch
              id="auto-push"
              checked={settings.auto_push}
              onCheckedChange={(checked) =>
                setSettings((s) => ({ ...s, auto_push: checked }))
              }
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          variant={saved ? "default" : "outline"}
          className={saved ? "bg-green-600 hover:bg-green-600 text-white border-green-600" : ""}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {saved ? "Saved" : "Save Settings"}
        </Button>
      </div>
    </div>
  )
}
