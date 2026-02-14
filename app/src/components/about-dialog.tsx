import { useEffect, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <button
      className="underline underline-offset-2 hover:text-foreground transition-colors"
      onClick={() => openUrl(href)}
    >
      {children}
    </button>
  )
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [version, setVersion] = useState("dev")

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v))
      .catch(() => setVersion("dev"))
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex flex-col items-center gap-4 pt-2">
            <img
              src="/icon-256.png"
              alt="Skill Builder"
              className="size-16 rounded-xl"
            />
            <div className="flex flex-col items-center gap-1">
              <DialogTitle className="text-center">Skill Builder</DialogTitle>
              <DialogDescription className="text-center">
                Version {version}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-3 pb-2 text-center text-sm text-muted-foreground">
          <p>
            Build domain-specific Claude skills with AI-powered multi-agent
            workflows. Create domain knowledge packages that help data and
            analytics engineers build silver and gold layer models.
          </p>

          <p>
            Powered by{" "}
            <ExternalLink href="https://anthropic.com/claude">Claude</ExternalLink>
            {" "}from{" "}
            <ExternalLink href="https://anthropic.com">Anthropic</ExternalLink>
          </p>

          <Separator />

          <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs">
            <ExternalLink href="https://acceleratedata.ai">Website</ExternalLink>
            <ExternalLink href="https://github.com/hbanerjee74/skill-builder">GitHub</ExternalLink>
            <ExternalLink href="mailto:hi@acceleratedata.ai">hi@acceleratedata.ai</ExternalLink>
          </div>

          <Separator />

          <div className="text-xs leading-relaxed">
            <p className="font-medium text-muted-foreground/80">
              Experimental Software — No Warranty
            </p>
            <p className="mt-1">
              Provided &ldquo;as is&rdquo; without warranty of any kind, express
              or implied. This software is for demonstration and evaluation
              purposes only. Not intended for production use. Accelerate Data
              assumes no liability for any damages arising from its use.
            </p>
          </div>

          <Separator />

          <div className="text-xs">
            <p>
              Built with{" "}
              <ExternalLink href="https://v2.tauri.app">Tauri</ExternalLink>,{" "}
              <ExternalLink href="https://docs.anthropic.com/en/docs/agents/claude-agent-sdk">Claude Agent SDK</ExternalLink>,{" "}
              and{" "}
              <ExternalLink href="https://react.dev">React</ExternalLink>
            </p>
          </div>

          <p className="text-xs text-muted-foreground/60">
            &copy; {new Date().getFullYear()} Accelerate Data, Inc. All rights reserved.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
