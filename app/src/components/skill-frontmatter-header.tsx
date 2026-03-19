import { Badge } from "@/components/ui/badge";
import type { SkillFrontmatter } from "@/lib/frontmatter";

interface SkillFrontmatterHeaderProps {
  frontmatter: SkillFrontmatter;
}

const BADGE_FIELDS = ["domain", "type", "model"] as const;

export function SkillFrontmatterHeader({ frontmatter }: SkillFrontmatterHeaderProps) {
  const { name, description, version, tools, author, ...rest } = frontmatter;
  const badges = BADGE_FIELDS.map((key) => rest[key] ?? frontmatter[key as keyof SkillFrontmatter])
    .filter(Boolean) as string[];

  // Add tools as individual badges (comma-separated list)
  const toolList = tools?.split(",").map((t) => t.trim()).filter(Boolean) ?? [];

  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3">
      {name && <h3 className="text-sm font-semibold tracking-tight">{name}</h3>}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {version && (
          <Badge variant="outline" className="font-mono text-[11px]">
            v{version}
          </Badge>
        )}
        {badges.map((value) => (
          <Badge key={value} variant="secondary" className="text-[11px]">
            {value}
          </Badge>
        ))}
        {toolList.map((tool) => (
          <Badge
            key={tool}
            variant="outline"
            className="text-[11px]"
            style={{
              background: "color-mix(in oklch, var(--color-pacific), transparent 90%)",
              borderColor: "color-mix(in oklch, var(--color-pacific), transparent 70%)",
              color: "var(--color-pacific)",
            }}
          >
            {tool}
          </Badge>
        ))}
        {author && (
          <span className="text-[11px] text-muted-foreground">by {author}</span>
        )}
      </div>
    </div>
  );
}
