import { useState, useEffect } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { CheckCircle2, ArrowLeft } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settings-store"
import { GitHubLoginDialog } from "@/components/github-login-dialog"
import { AboutDialog } from "@/components/about-dialog"
import { FeedbackDialog } from "@/components/feedback-dialog"
import { ImportedSkillsTab } from "@/components/imported-skills-tab"
import { GeneralSection } from "@/components/settings/general-section"
import { SdkSection } from "@/components/settings/sdk-section"
import { MarketplaceSection } from "@/components/settings/marketplace-section"
import { GitHubSection } from "@/components/settings/github-section"
import { AdvancedSection } from "@/components/settings/advanced-section"
import { useSettingsForm } from "@/hooks/use-settings-form"

const sections = [
  { id: "general", label: "General" },
  { id: "skill-building", label: "Claude SDK" },
  { id: "skills", label: "Import" },
  { id: "marketplace", label: "Marketplace" },
  { id: "github", label: "GitHub" },
  { id: "advanced", label: "Advanced" },
] as const

type SectionId = typeof sections[number]["id"]

export default function SettingsPage() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SectionId>("general")
  const [appVersion, setAppVersion] = useState<string>("dev")
  const [loginDialogOpen, setLoginDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  const pendingUpgrade = useSettingsStore((s) => s.pendingUpgradeOpen)

  const form = useSettingsForm()

  // Auto-navigate to the skills section when a pending upgrade is set
  useEffect(() => {
    if (pendingUpgrade) {
      setActiveSection("skills")
    }
  }, [pendingUpgrade])

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion("dev"))
  }, [])

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate({ to: "/" })}
            title="Back to Dashboard"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">Settings</h1>
          <span className="text-sm text-muted-foreground">v{appVersion}</span>
          {form.saved && (
            <span className="flex items-center gap-1 text-sm animate-in fade-in duration-200" style={{ color: "var(--color-seafoam)" }}>
              <CheckCircle2 className="size-3.5" />
              Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FeedbackDialog />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <nav className="flex w-48 shrink-0 flex-col space-y-1 overflow-y-auto border-r p-4">
          {sections.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors text-left",
                activeSection === id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto">
          {activeSection === "general" && (
            <GeneralSection
              industry={form.industry}
              setIndustry={form.setIndustry}
              functionRole={form.functionRole}
              setFunctionRole={form.setFunctionRole}
              appVersion={appVersion}
              onAboutOpen={() => setAboutDialogOpen(true)}
              autoSave={form.autoSave}
            />
          )}

          {activeSection === "skill-building" && (
            <SdkSection
              apiKey={form.apiKey}
              setApiKey={form.setApiKey}
              preferredModel={form.preferredModel}
              setPreferredModel={form.setPreferredModel}
              extendedThinking={form.extendedThinking}
              setExtendedThinking={form.setExtendedThinking}
              interleavedThinkingBeta={form.interleavedThinkingBeta}
              setInterleavedThinkingBeta={form.setInterleavedThinkingBeta}
              sdkEffort={form.sdkEffort}
              setSdkEffort={form.setSdkEffort}
              refinePromptSuggestions={form.refinePromptSuggestions}
              setRefinePromptSuggestions={form.setRefinePromptSuggestions}
              maxDimensions={form.maxDimensions}
              setMaxDimensions={form.setMaxDimensions}
              autoSave={form.autoSave}
            />
          )}

          {activeSection === "skills" && (
            <div className="space-y-6 p-6">
              <ImportedSkillsTab />
            </div>
          )}

          {activeSection === "marketplace" && (
            <MarketplaceSection
              autoUpdate={form.autoUpdate}
              setAutoUpdate={form.setAutoUpdate}
              autoSave={form.autoSave}
            />
          )}

          {activeSection === "github" && (
            <GitHubSection onLoginOpen={() => setLoginDialogOpen(true)} />
          )}

          {activeSection === "advanced" && (
            <AdvancedSection
              logLevel={form.logLevel}
              setLogLevel={form.setLogLevel}
              skillsPath={form.skillsPath}
              setSkillsPath={form.setSkillsPath}
              autoSave={form.autoSave}
            />
          )}
        </div>
      </div>

      <AboutDialog open={aboutDialogOpen} onOpenChange={setAboutDialogOpen} />
      <GitHubLoginDialog open={loginDialogOpen} onOpenChange={setLoginDialogOpen} />
    </div>
  )
}
