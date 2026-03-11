import {
  FileText,
  Pencil,
  Search,
  Terminal,
  Globe,
  GitBranch,
} from "lucide-react";
import { BaseItem } from "./base-item";
import { DefaultViewer } from "./tool-viewers/default-viewer";
import { EditViewer } from "./tool-viewers/edit-viewer";
import { ReadViewer } from "./tool-viewers/read-viewer";
import { BashViewer } from "./tool-viewers/bash-viewer";
import type { DisplayItem } from "@/lib/display-types";

function getToolIcon(toolName: string) {
  switch (toolName) {
    case "Read":
      return <FileText className="size-3.5" />;
    case "Write":
    case "Edit":
    case "NotebookEdit":
      return <Pencil className="size-3.5" />;
    case "Grep":
    case "Glob":
    case "Search":
      return <Search className="size-3.5" />;
    case "WebSearch":
    case "WebFetch":
      return <Globe className="size-3.5" />;
    case "Task":
    case "Agent":
      return <GitBranch className="size-3.5" />;
    default:
      return <Terminal className="size-3.5" />;
  }
}

function ToolViewer({ item }: { item: DisplayItem }) {
  const toolName = item.toolName ?? "";

  switch (toolName) {
    case "Edit":
      return <EditViewer item={item} />;
    case "Read":
      return <ReadViewer item={item} />;
    case "Bash":
      return <BashViewer item={item} />;
    default:
      return <DefaultViewer item={item} />;
  }
}

export function ToolItem({ item }: { item: DisplayItem }) {
  const toolName = item.toolName ?? "unknown";
  const summary = item.toolSummary ?? toolName;
  const hasContent =
    (item.toolInput && Object.keys(item.toolInput).length > 0) ||
    item.toolResult;

  return (
    <BaseItem
      icon={getToolIcon(toolName)}
      label={toolName}
      labelMono
      summary={summary}
      tokenCount={item.tokenCount}
      status={item.toolStatus}
      durationMs={item.toolDurationMs}
      borderColor="var(--chat-tool-border)"
      headerBg="var(--chat-tool-bg)"
      defaultExpanded={false}
    >
      {hasContent ? <ToolViewer item={item} /> : undefined}
    </BaseItem>
  );
}
