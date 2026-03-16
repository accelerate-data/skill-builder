import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Settings, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import SkillDialog from "@/components/skill-dialog";
import { useSettingsStore } from "@/stores/settings-store";

export function SkillListPanel() {
  const [createOpen, setCreateOpen] = useState(false);
  const workspacePath = useSettingsStore((s) => s.workspacePath);

  return (
    <div className="flex h-full w-[260px] flex-shrink-0 flex-col border-r bg-background">
      {/* Topbar */}
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <span className="flex-1 text-[13px] font-semibold">Skills</span>
        <Badge variant="secondary" className="rounded-full px-1.5 py-px text-[11px]">0</Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={() => setCreateOpen(true)}
          title="New skill"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-2.5 py-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search skills…"
            className="h-7 pl-6 text-xs"
          />
        </div>
      </div>

      {/* Skill rows — stub; wired in VU-603 */}
      <ScrollArea className="flex-1" />

      {/* Footer */}
      <div className="border-t p-2">
        <Link
          to="/settings"
          className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Settings className="size-4" />
          Settings
        </Link>
      </div>

      {workspacePath && (
        <SkillDialog
          mode="create"
          workspacePath={workspacePath}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={async () => {}}
        />
      )}
    </div>
  );
}
