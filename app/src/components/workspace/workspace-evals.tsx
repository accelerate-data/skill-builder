import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { SaveScenario, ScenarioDto } from "@/lib/eval-workbench";
import {
  getErrorMessage,
  normalizeScenario,
  scenarioToDraft,
} from "@/lib/eval-workbench";
import type { ImportedSkill, SkillSummary } from "@/lib/types";
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
  onGenerateEvalScenarioAssertions?: (scenarioName: string) => Promise<ScenarioDto>;
  onDeleteScenario?: (scenarioName: string) => Promise<void>;
  saveScenarioPending?: boolean;
  generateEvalScenarioAssertionsPending?: boolean;
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
  onGenerateEvalScenarioAssertions,
  onDeleteScenario,
  saveScenarioPending = false,
  generateEvalScenarioAssertionsPending = false,
  deleteScenarioPending = false,
  headerContent,
}: WorkspaceEvalsProps) {
  const [generatingScenario, setGeneratingScenario] = useState(false);
  const [draft, setDraft] = useState<SaveScenario>(() => {
    if (scenario) {
      return scenarioToDraft(scenario);
    }
    return {
      id: `case-${crypto.randomUUID().slice(0, 8)}`,
      pluginSlug: "plugin" in skill ? skill.plugin_slug : "default",
      skillName: "name" in skill ? skill.name : skill.skill_name,
      name: "",
      prompt: "",
      assertions: [],
      tags: ["performance"],
    };
  });
  const [actionError, setActionError] = useState<string | null>(null);

  const isDirty = scenario
    ? JSON.stringify(normalizeScenario(scenarioToDraft(scenario))) !==
      JSON.stringify(normalizeScenario(draft))
    : false;

  useEffect(() => {
    if (scenario) {
      setDraft(scenarioToDraft(scenario));
    } else {
      setDraft({
        id: `case-${crypto.randomUUID().slice(0, 8)}`,
        pluginSlug: "plugin" in skill ? skill.plugin_slug : "default",
        skillName: "name" in skill ? skill.name : skill.skill_name,
        name: "",
        prompt: "",
        assertions: [],
        tags: ["performance"],
      });
    }
    setActionError(null);
  }, [scenario, skill]);

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

  async function handleGenerate() {
    if (!scenario || !onGenerateEvalScenarioAssertions) return;
    setGeneratingScenario(true);
    setActionError(null);
    try {
      await onGenerateEvalScenarioAssertions(scenario.name);
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setGeneratingScenario(false);
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
              onGenerate={onGenerateEvalScenarioAssertions ? handleGenerate : undefined}
              onDelete={onDeleteScenario ? handleDelete : undefined}
              generateDisabled={generateEvalScenarioAssertionsPending}
              deleteDisabled={deleteScenarioPending}
              showDelete={true}
              showGenerate={Boolean(onGenerateEvalScenarioAssertions)}
              generateBusy={generatingScenario || generateEvalScenarioAssertionsPending}
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
    </div>
  );
}
