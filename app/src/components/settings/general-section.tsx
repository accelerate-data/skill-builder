import { Monitor, Sun, Moon, Info } from "lucide-react"
import { useTheme } from "next-themes"
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
import { cn } from "@/lib/utils"

interface GeneralSectionProps {
  industry: string
  setIndustry: (v: string) => void
  functionRole: string
  setFunctionRole: (v: string) => void
  appVersion: string
  onAboutOpen: () => void
  autoSave: (overrides: Record<string, unknown>) => void
}

export function GeneralSection({
  industry,
  setIndustry,
  functionRole,
  setFunctionRole,
  appVersion,
  onAboutOpen,
  autoSave,
}: GeneralSectionProps) {
  const { theme, setTheme } = useTheme()

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>User Profile</CardTitle>
          <CardDescription>
            Optional context about you and your work. Agents use this to tailor research and skill content.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="industry">Industry</Label>
            <Input
              id="industry"
              placeholder="e.g., Financial Services, Healthcare, Retail"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              onBlur={() => autoSave({ industry: industry || null })}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="function-role">Function / Role</Label>
            <Input
              id="function-role"
              placeholder="e.g., Analytics Engineer, Data Platform Lead"
              value={functionRole}
              onChange={(e) => setFunctionRole(e.target.value)}
              onBlur={() => autoSave({ functionRole: functionRole || null })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            Choose a theme for the application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-1 rounded-md bg-muted p-1">
            {([
              { value: "system", icon: Monitor, label: "System" },
              { value: "light", icon: Sun, label: "Light" },
              { value: "dark", icon: Moon, label: "Dark" },
            ] as const).map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
                  theme === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
          <CardDescription>
            Skill Builder v{appVersion}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" size="sm" onClick={onAboutOpen}>
            <Info className="size-4" />
            About Skill Builder
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
