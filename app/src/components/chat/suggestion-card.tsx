import { useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Check, X, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { applySuggestion } from "@/lib/tauri";
import type { Suggestion } from "@/stores/chat-store";

interface SuggestionCardProps {
  suggestion: Suggestion;
  index: number;
  workspacePath: string;
  skillName: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDiscuss: (id: string, title: string) => void;
}

export function SuggestionCard({
  suggestion,
  index,
  workspacePath,
  skillName,
  onAccept,
  onReject,
  onDiscuss,
}: SuggestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [applying, setApplying] = useState(false);

  const handleAccept = async () => {
    setApplying(true);
    try {
      const fullPath = `${workspacePath}/${skillName}/${suggestion.filePath}`;
      await applySuggestion(fullPath, suggestion.newContent);
      onAccept(suggestion.id);
      toast.success(`Applied: ${suggestion.title}`);
    } catch (err) {
      toast.error(
        `Failed to apply: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setApplying(false);
    }
  };

  const isResolved = suggestion.status !== "pending";

  return (
    <Card className={isResolved ? "opacity-60" : ""}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Badge variant="outline" className="text-xs">
            #{index + 1}
          </Badge>
          {suggestion.title}
          {suggestion.status === "accepted" && (
            <Badge variant="default" className="gap-1 bg-green-600 text-xs">
              <Check className="size-3" />
              Applied
            </Badge>
          )}
          {suggestion.status === "rejected" && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <X className="size-3" />
              Rejected
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {suggestion.description}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {suggestion.filePath}
        </p>

        {expanded && (
          <div className="overflow-hidden rounded-md border text-xs">
            <ReactDiffViewer
              oldValue={suggestion.oldContent}
              newValue={suggestion.newContent}
              splitView={false}
              useDarkTheme={document.documentElement.classList.contains("dark")}
              compareMethod={DiffMethod.WORDS}
              hideLineNumbers={false}
            />
          </div>
        )}

        {!isResolved && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="default"
              onClick={handleAccept}
              disabled={applying}
              className="gap-1"
            >
              <Check className="size-3.5" />
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReject(suggestion.id)}
              className="gap-1"
            >
              <X className="size-3.5" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDiscuss(suggestion.id, suggestion.title)}
              className="gap-1"
            >
              <MessageSquare className="size-3.5" />
              Discuss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
