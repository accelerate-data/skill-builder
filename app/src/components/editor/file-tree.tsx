import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Lock,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/lib/types";

interface TreeNode {
  name: string;
  entry?: FileEntry;
  children: TreeNode[];
  isDirectory: boolean;
  isReadonly: boolean;
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", children: [], isDirectory: true, isReadonly: false };

  for (const file of files) {
    const parts = file.relative_path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          entry: isLast ? file : undefined,
          children: [],
          isDirectory: isLast ? file.is_directory : true,
          isReadonly: isLast ? file.is_readonly : file.relative_path.startsWith("context/"),
        };
        current.children.push(child);
      }

      if (isLast && !child.entry) {
        child.entry = file;
      }
      current = child;
    }
  }

  // Sort: directories first, then alphabetical
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root.children);

  return root.children;
}

function TreeItem({
  node,
  depth,
  activeFilePath,
  onFileSelect,
}: {
  node: TreeNode;
  depth: number;
  activeFilePath: string | null;
  onFileSelect: (entry: FileEntry) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = node.entry?.absolute_path === activeFilePath;

  if (node.isDirectory) {
    return (
      <div>
        <button
          className={cn(
            "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-sm hover:bg-accent/50",
          )}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {expanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
          {node.isReadonly && (
            <Lock className="size-3 shrink-0 text-muted-foreground/60" />
          )}
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeItem
                key={child.name}
                node={child}
                depth={depth + 1}
                activeFilePath={activeFilePath}
                onFileSelect={onFileSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-sm hover:bg-accent/50",
        isActive && "bg-accent text-accent-foreground",
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => node.entry && onFileSelect(node.entry)}
    >
      <span className="size-3.5 shrink-0" /> {/* spacer for alignment */}
      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{node.name}</span>
      {node.isReadonly && (
        <Lock className="size-3 shrink-0 text-muted-foreground/60" />
      )}
    </button>
  );
}

interface FileTreeProps {
  files: FileEntry[];
  activeFilePath: string | null;
  onFileSelect: (entry: FileEntry) => void;
}

export function FileTree({ files, activeFilePath, onFileSelect }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
        No files
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-2">
        {tree.map((node) => (
          <TreeItem
            key={node.name}
            node={node}
            depth={0}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
