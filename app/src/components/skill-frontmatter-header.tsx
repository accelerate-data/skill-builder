import type { SkillFrontmatter } from "@/lib/frontmatter";

interface SkillFrontmatterHeaderProps {
  frontmatter: SkillFrontmatter;
}

/** Renders parsed YAML frontmatter as a two-column table (GitHub-style). */
export function SkillFrontmatterHeader({ frontmatter }: SkillFrontmatterHeaderProps) {
  const entries = Object.entries(frontmatter).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );

  if (entries.length === 0) return null;

  return (
    <table className="m-4 w-auto border-collapse text-sm">
      <thead>
        <tr className="border-b">
          <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">key</th>
          <th className="px-3 py-1.5 text-left text-xs font-semibold text-muted-foreground">value</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b last:border-b-0">
            <td className="px-3 py-1.5 align-top font-medium">{key}</td>
            <td className="px-3 py-1.5 align-top">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
