interface TaoPanelProps {
  thought?: string;
  action?: string;
  observation?: string;
  error?: string;
}

const SECTION_LABEL_WIDTH = "72px";

export function TaoPanel({ thought, action, observation, error }: TaoPanelProps) {
  const hasAny = thought || action || observation || error;
  if (!hasAny) return null;

  return (
    <div className="text-xs">
      {thought && (
        <TaoSection
          title="THOUGHT"
          bg="var(--chat-thinking-bg)"
          labelColor="var(--chat-thinking-border)"
        >
          <p className="text-muted-foreground whitespace-pre-wrap">{thought}</p>
        </TaoSection>
      )}
      {action && (
        <TaoSection
          title="ACTION"
          bg="var(--chat-tool-bg)"
          labelColor="var(--chat-tool-border)"
        >
          <pre className="font-mono text-muted-foreground whitespace-pre-wrap overflow-x-auto">
            {action}
          </pre>
        </TaoSection>
      )}
      {observation && (
        <TaoSection
          title="OBSERVATION"
          bg="var(--chat-result-bg)"
          labelColor="var(--chat-result-border)"
        >
          <p className="text-muted-foreground whitespace-pre-wrap">{observation}</p>
        </TaoSection>
      )}
      {error && (
        <TaoSection
          title="ERROR"
          bg="var(--chat-error-bg)"
          labelColor="var(--chat-error-border)"
        >
          <p className="text-muted-foreground whitespace-pre-wrap">{error}</p>
        </TaoSection>
      )}
    </div>
  );
}

function TaoSection({
  title,
  bg,
  labelColor,
  children,
}: {
  title: string;
  bg: string;
  labelColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 px-3 py-2 border-t border-border" style={{ background: bg }}>
      <span
        className="shrink-0 font-semibold uppercase tracking-wide pt-px"
        style={{ width: SECTION_LABEL_WIDTH, color: labelColor, fontSize: "10px" }}
      >
        {title}
      </span>
      <div className="min-w-0 flex-1" style={{ fontSize: "11px" }}>
        {children}
      </div>
    </div>
  );
}
