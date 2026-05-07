import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  EvalWorkbenchMode,
  ScenarioDto,
} from "@/lib/eval-workbench";
import { getErrorMessage } from "@/lib/eval-workbench";
import {
  useCreateScenario,
  useDeleteScenario,
  useSaveScenario,
  useScenario,
  useScenarios,
  useDefineEvalScenario,
} from "@/lib/queries/eval-scenarios";
import type { ImportedSkill, SkillSummary } from "@/lib/types";
import { WorkspaceEvals } from "./workspace-evals";

interface WorkspaceEvalWorkbenchProps {
  skill: SkillSummary | ImportedSkill;
  workspacePath: string | null;
  initialMode?: EvalWorkbenchMode;
  onRunningChange?: (running: boolean) => void;
  onNavigateToRefine?: () => void;
  onApplyDescription?: (newDescription: string, newVersion: string) => void;
}

type SaveScenarioOptions = {
  previousScenarioName?: string | null;
};

export function WorkspaceEvalWorkbench({
  skill,
  workspacePath,
  initialMode: _initialMode = "performance",
  onRunningChange,
  onNavigateToRefine,
  onApplyDescription: _onApplyDescription,
}: WorkspaceEvalWorkbenchProps) {
  const skillName = "name" in skill ? skill.name : skill.skill_name;
  const pluginSlug = skill.plugin_slug;
  const [running, setRunning] = useState(false);
  const [selectedScenarioName, setSelectedScenarioName] = useState<string | null>(
    null,
  );
  const isRunning = running;

  const scenariosQuery = useScenarios(skillName, pluginSlug);
  const createScenarioMutation = useCreateScenario(skillName, pluginSlug);
  const saveScenarioMutation = useSaveScenario(skillName, pluginSlug);
  const defineEvalScenarioMutation = useDefineEvalScenario(skillName, pluginSlug);
  const deleteScenarioMutation = useDeleteScenario(skillName, pluginSlug);
  const scenarios = scenariosQuery.data ?? [];
  const selectedScenarioQuery = useScenario(
    skillName,
    pluginSlug,
    selectedScenarioName,
  );
  const selectedScenario = selectedScenarioQuery.data ?? null;

  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  useEffect(() => {
    if (!selectedScenarioName) {
      return;
    }
    const nextSelectedScenario = scenarios.find(
      (scenario) => scenario.name === selectedScenarioName,
    );
    if (!nextSelectedScenario) {
      setSelectedScenarioName(null);
    }
  }, [scenarios, selectedScenarioName]);

  async function handleSaveScenario(
    scenario: ScenarioDto,
    options?: SaveScenarioOptions,
  ) {
    const previousScenarioName =
      options && "previousScenarioName" in options
        ? (options.previousScenarioName ?? null)
        : (selectedScenario?.name ?? null);
    const savedScenario = await saveScenarioMutation.mutateAsync({
      scenario,
      previousScenarioName,
    });
    setSelectedScenarioName(savedScenario.name);
    return savedScenario;
  }

  async function handleCreateScenario(mode: EvalWorkbenchMode) {
    const createdScenario = await createScenarioMutation.mutateAsync({ mode });
    setSelectedScenarioName(createdScenario.name);
    return createdScenario;
  }

  async function handleDefineEvalScenario(scenarioName: string) {
    const savedScenario = await defineEvalScenarioMutation.mutateAsync({ scenarioName });
    setSelectedScenarioName(savedScenario.name);
    return savedScenario;
  }

  async function handleDeleteScenario(scenarioName: string) {
    await deleteScenarioMutation.mutateAsync({ scenarioName });
    setSelectedScenarioName(null);
  }

  function handleStartNewScenario() {
    setSelectedScenarioName(null);
  }

  const scenariosSection = (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Scenarios</h2>
          <p className="text-xs text-muted-foreground">
            Create and edit performance evaluation scenarios for this skill.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={isRunning || createScenarioMutation.isPending}
          onClick={() => void handleCreateScenario("performance")}
        >
          New scenario
        </Button>
      </div>

      {scenariosQuery.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Loading scenarios…
        </p>
      ) : null}

      {scenariosQuery.error ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p className="text-sm text-destructive">
            {getErrorMessage(scenariosQuery.error)}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void scenariosQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : null}

      {!scenariosQuery.isLoading && !scenariosQuery.error ? (
        scenarios.length > 0 ? (
          <div className="mt-4 space-y-2">
            {scenarios.map((scenario) => (
              <Button
                key={scenario.name}
                type="button"
                size="sm"
                variant={
                  selectedScenarioName === scenario.name
                    ? "secondary"
                    : "outline"
                }
                className="flex h-auto w-full items-start justify-start p-3 text-left"
                onClick={() => {
                  setSelectedScenarioName((current) =>
                    current === scenario.name ? null : scenario.name,
                  );
                }}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{scenario.name}</p>
                </div>
              </Button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No scenarios yet. Create one below.
          </p>
        )
      ) : null}

      {!scenariosQuery.isLoading && !scenariosQuery.error && selectedScenarioName ? (
        selectedScenarioQuery.isLoading ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Loading scenario…
          </p>
        ) : selectedScenarioQuery.error ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">
              {getErrorMessage(selectedScenarioQuery.error)}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void selectedScenarioQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : null
      ) : null}
    </section>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex flex-1 flex-col">
        <WorkspaceEvals
          key={`performance-${skillName}`}
          skill={skill}
          workspacePath={workspacePath}
          scenario={selectedScenario}
          hasScenarios={scenarios.length > 0}
          scenarioLoading={selectedScenarioQuery.isLoading}
          onStartNewScenario={handleStartNewScenario}
          onCreateScenario={handleCreateScenario}
          onSaveScenario={handleSaveScenario}
          onDefineEvalScenario={handleDefineEvalScenario}
          onDeleteScenario={handleDeleteScenario}
          saveScenarioPending={
            createScenarioMutation.isPending || saveScenarioMutation.isPending
          }
          defineEvalScenarioPending={defineEvalScenarioMutation.isPending}
          deleteScenarioPending={deleteScenarioMutation.isPending}
          onNavigateToRefine={onNavigateToRefine}
          onRunningChange={setRunning}
          headerContent={scenariosSection}
        />
      </div>
    </div>
  );
}
