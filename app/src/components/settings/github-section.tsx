import { Loader2, Github, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { useAuthStore } from "@/stores/auth-store"

interface GitHubSectionProps {
  onLoginOpen: () => void
}

export function GitHubSection({ onLoginOpen }: GitHubSectionProps) {
  const { user, isLoggedIn, isLoading: isAuthLoading, lastCheckedAt, logout } = useAuthStore()

  const githubStatusLabel = isAuthLoading ? "Checking" : isLoggedIn && user ? "Connected" : "Not connected"

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            GitHub Account
            <Badge variant={isLoggedIn && !isAuthLoading ? "secondary" : "outline"}>
              {githubStatusLabel}
            </Badge>
          </CardTitle>
          <CardDescription>
            Connect your GitHub account to submit feedback and report issues.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isAuthLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Checking GitHub connection...
            </div>
          ) : isLoggedIn && user ? (
            <>
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={user.avatar_url} alt={user.login} />
                  <AvatarFallback>{user.login[0].toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">@{user.login}</span>
                  {user.email && (
                    <span className="text-sm text-muted-foreground">{user.email}</span>
                  )}
                  {lastCheckedAt && (
                    <span className="text-xs text-muted-foreground">
                      Last checked {new Date(lastCheckedAt).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-fit" onClick={logout}>
                <LogOut className="size-4" />
                Sign Out
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Not connected</p>
              <Button variant="outline" size="sm" className="w-fit" onClick={onLoginOpen}>
                <Github className="size-4" />
                Sign in with GitHub
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
