import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { SaveScenario, ScenarioDto } from "@/lib/eval-workbench";
import {
  createDraftScenario,
  getErrorMessage,
  normalizeScenario,
  scenarioToDraft,
} from "@/lib/eval-workbench";
import type { ImportedSkill, SkillSummary } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings-store";
import { formatModelName } from "@/stores/agent-store";
import { RunStatusFooter } from "@/components/run-status-footer";
import { PromptSetEditor } from "./eval-workbench/prompt-set-editor";

interface WorkspaceEvalsProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
  scenario: ScenarioDto | null;
  hasScenarios?: boolean;
  scenarioLoading?: boolean;
  onStartNewScenario: () => void;
  onCreateScenario?: () => Promise<ScenarioDto>;
  onSaveScenario: (
    scenario: ScenarioDto,
    options?: { previousScenarioName?: string | null },
  ) => Promise<ScenarioDto>;
  onDefineEvalScenario?: (scenarioName: string) => Promise<ScenarioDto>;
  onDeleteScenario?: (scenarioName: string) => Promise<void>;
  saveScenarioPending?: boolean;
  defineEvalScenarioPending?: boolean;
  deleteScenarioPending?: boolean;
  headerContent?: ReactNode;
}

export function WorkspaceEvals({
  skill,
  scenario,
  hasScenarios = Boolean(scenario),
  scenarioLoading: _scenarioLoading = false,
  onStartNewScenario,
  onCreateScenario,
  onSaveScenario,
  onDefineEvalScenario,
  onDeleteScenario,
  saveScenarioPending = false,
  defineEvalScenarioPending = false,
  deleteScenarioPending = false,
  headerContent,
}: WorkspaceEvalsProps) {
  const [suggestingScenario, setSuggestingScenario] = useState(false);
  const [draft, setDraft] = useState<SaveScenario>(() => createDraftScenario());
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedModel = useSettingsStore((s) => s.modelSettings.model);
  const skillName = "name" in skill ? skill.name : skill.skill_name;

  const isDirty = scenario
    ? JSON.stringify(normalizeScenario(scenarioToDraft(scenario))) !==
      JSON.stringify(normalizeScenario(draft))
    : false;

  useEffect(() => {
    if (scenario) {
      setDraft(scenarioToDraft(scenario));
    } else {
      setDraft(createDraftScenario());
    }
    setActionError(null);
  }, [scenario]);

  async function handleSave() {
    if (!scenario) return;
    setActionError(null);
    try {
      await onSaveScenario(
        { ...draft, id: draft.id || scenario.id },
        { previousScenarioName: scenario.name },
      );
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  }

  async function handleSuggest() {
    if (!scenario || !onDefineEvalScenario) return;
    setSuggestingScenario(true);
    setActionError(null);
    try {
      await onDefineEvalScenario(scenario.name);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setSuggestingScenario(false);
    }
  }

  async function handleDelete() {
    if (!scenario || !onDeleteScenario) return;
    setActionError(null);
    try {
      await onDeleteScenario(scenario.name);
      onStartNewScenario();
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  }

  async function handleCreateScenario() {
    if (!onCreateScenario) return;
    setActionError(null);
    try {
      await onCreateScenario();
    } catch (err) {
      setActionError(getErrorMessage(err));
    }
  }

  return (
    <div
      className="flex h-full flex-1 flex-col"
      data-testid="eval-workbench-panel"
    >
      <div className="min-h-0 flex flex-1 flex-col px-4">
        {headerContent}

        <div className="mt-4 min-h-0 flex flex-1 flex-col gap-4">
          {!hasScenarios && !scenario && (
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                No scenarios yet. Create your first scenario to get started.
              </p>
              <Button
                className="mt-3"
                size="sm"
                onClick={handleCreateScenario}
                disabled={saveScenarioPending}
              >
                New scenario
              </Button>
            </div>
          )}

          {scenario && (
            <PromptSetEditor
              draft={draft}
              onChange={setDraft}
              onNew={onCreateScenario ? handleCreateScenario : undefined}
              onSuggest={onDefineEvalScenario ? handleSuggest : undefined}
              onDelete={onDeleteScenario ? handleDelete : undefined}
              suggestDisabled={defineEvalScenarioPending}
              deleteDisabled={deleteScenarioPending}
              showDelete={true}
              showSuggest={Boolean(onDefineEvalScenario)}
              suggestBusy={suggestingScenario || defineEvalScenarioPending}
              showNew={Boolean(onCreateScenario)}
              footerStatus={
                actionError
                  ? { tone: "error", message: actionError }
                  : null
              }
            />
          )}

          {scenario && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {isDirty && (
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={saveScenarioPending}
                  >
                    {saveScenarioPending ? "Saving…" : "Save scenario"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <RunStatusFooter
        status="idle"
        label={skillName}
        model={selectedModel ? formatModelName(selectedModel) : null}
      />
    </div>
  );
}
