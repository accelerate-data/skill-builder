import { memo } from "react";
import { Sparkles } from "lucide-react";
import { BaseItem } from "./base-item";
import type { DisplayItem } from "@/lib/display-types";

export const SkillItem = memo(function SkillItem({ item }: { item: DisplayItem }) {
  const description = item.subagentDescription ?? "";
  const summary = item.toolSummary ?? "Using skill";

  return (
    <BaseItem
      icon={<Sparkles className="size-3.5" />}
      label="Skill"
      summary={description || summary}
      status={item.subagentStatus}
      borderColor="var(--chat-skill-border)"
      headerBg="var(--chat-skill-bg)"
      defaultExpanded={false}
    />
  );
});
