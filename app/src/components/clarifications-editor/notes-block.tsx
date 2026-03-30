import { ChevronRight, AlertTriangle, Info } from "lucide-react";
import type { Note } from "@/lib/clarifications-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWarnNote(type: string): boolean {
  return type === "blocked" || type === "critical_gap";
}

function resolveNoteIcon(type: string): typeof AlertTriangle {
  if (isWarnNote(type)) return AlertTriangle;
  return Info;
}

// ─── Notes Block ─────────────────────────────────────────────────────────────

export function NotesBlock({
  notes, isExpanded, onToggle,
}: {
  notes: Note[];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        className="mt-6 flex w-full items-center gap-2.5 px-6 py-2.5 text-left transition-colors hover:bg-muted/40"
        style={{
          borderTop: "2px solid var(--color-ocean)",
          background: "color-mix(in oklch, var(--color-ocean), transparent 90%)",
        }}
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls="research-notes-content"
      >
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150"
          style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden="true"
        />
        <Info className="size-4" style={{ color: "var(--color-ocean)" }} />
        <span
          className="flex-1 text-sm font-semibold tracking-tight"
          style={{ color: "var(--color-ocean)" }}
        >
          Research Notes
        </span>
        <span className="text-[11px] text-muted-foreground">{notes.length} {notes.length === 1 ? "note" : "notes"}</span>
      </button>
      {isExpanded && (
        <div id="research-notes-content">
          {notes.map((note, i) => (
            <NoteCard key={i} note={note} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Note Card ───────────────────────────────────────────────────────────────

function NoteCard({ note }: { note: Note }) {
  const warn = isWarnNote(note.type);
  const Icon = resolveNoteIcon(note.type);

  return (
    <div className={`mx-6 mt-3 rounded-lg border p-4 ${warn ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/30"}`}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className={`size-3.5 ${warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
        <span className={`text-xs font-semibold ${warn ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
          {note.title}
        </span>
        <span className="rounded border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          {(note.type ?? "note").replace(/_/g, " ")}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{note.body}</p>
    </div>
  );
}
