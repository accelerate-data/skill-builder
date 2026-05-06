import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  EvalWorkbenchMode,
  ScenarioDto,
} from "@/lib/eval-workbench";
import {
  getErrorMessage,
  scenarioSupportsMode,
} from "@/lib/eval-workbench";
import {
  useCreateScenario,
  useDeleteScenario,
  useSaveScenario,
  useScenario,
  useScenarios,
  useSuggestScenario,
} from "@/lib/queries/eval-scenarios";
import type { ImportedSkill, SkillSummary } from "@/lib/types";
import { WorkspaceDescription } from "./workspace-description";
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
  initialMode = "performance",
  onRunningChange,
  onNavigateToRefine,
  onApplyDescription,
}: WorkspaceEvalWorkbenchProps) {
  const skillName = "name" in skill ? skill.name : skill.skill_name;
  const pluginSlug = skill.plugin_slug;
  const [activeMode, setActiveMode] = useState<EvalWorkbenchMode>(initialMode);
  const [performanceRunning, setPerformanceRunning] = useState(false);
  const [triggerRunning, setTriggerRunning] = useState(false);
  const [selectedScenarioName, setSelectedScenarioName] = useState<string | null>(
    null,
  );
  const isRunning = performanceRunning || triggerRunning;

  const scenariosQuery = useScenarios(skillName, pluginSlug);
  const createScenarioMutation = useCreateScenario(skillName, pluginSlug);
  const saveScenarioMutation = useSaveScenario(skillName, pluginSlug);
  const suggestScenarioMutation = useSuggestScenario(skillName, pluginSlug);
  const deleteScenarioMutation = useDeleteScenario(skillName, pluginSlug);
  const scenarios = scenariosQuery.data ?? [];
  const visibleScenarios = scenarios.filter((scenario) =>
    scenarioSupportsMode(scenario, activeMode),
  );
  const selectedScenarioQuery = useScenario(
    skillName,
    pluginSlug,
    selectedScenarioName,
  );
  const selectedScenario = selectedScenarioQuery.data ?? null;

  useEffect(() => {
    setActiveMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    onRunningChange?.(isRunning);
  }, [isRunning, onRunningChange]);

  useEffect(() => {
    const nextSelectedScenario =
      visibleScenarios.find((scenario) => scenario.name === selectedScenarioName) ??
      visibleScenarios[0] ??
      null;
    setSelectedScenarioName(nextSelectedScenario?.name ?? null);
  }, [selectedScenarioName, visibleScenarios]);

  const triggerSkill =
    "name" in skill
      ? (skill as SkillSummary)
      : ({
          ...(skill as ImportedSkill),
          name: (skill as ImportedSkill).skill_name,
        } as unknown as SkillSummary);

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

  async function handleSuggestScenario(scenarioName: string) {
    const savedScenario = await suggestScenarioMutation.mutateAsync({ scenarioName });
    setSelectedScenarioName(savedScenario.name);
    return savedScenario;
  }

  async function handleDeleteScenario(scenarioName: string) {
    await deleteScenarioMutation.mutateAsync({ scenarioName });
    const nextSelectedScenario =
      visibleScenarios.find((scenario) => scenario.name !== scenarioName) ?? null;
    setSelectedScenarioName(nextSelectedScenario?.name ?? null);
  }

  function handleStartNewScenario() {
    setSelectedScenarioName(null);
  }

  return (
    <Tabs
      value={activeMode}
      onValueChange={(value) => {
        if (isRunning) {
          return;
        }
        setActiveMode(value === "trigger" ? "trigger" : "performance");
      }}
      className="flex h-full flex-col gap-4"
    >
      <div className="px-6 pt-6">
        <TabsList variant="line" className="w-full justify-start border-b px-0">
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="trigger">Trigger</TabsTrigger>
        </TabsList>
      </div>

      <section className="px-6">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Scenarios</h2>
              <p className="text-xs text-muted-foreground">
                Shared scenario files filtered by the active Eval Workbench tab.
              </p>
            </div>
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {activeMode}
            </span>
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
            visibleScenarios.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {visibleScenarios.map((scenario) => (
                  <Button
                    key={scenario.name}
                    type="button"
                    size="sm"
                    variant={
                      selectedScenarioName === scenario.name
                        ? "secondary"
                        : "outline"
                    }
                    onClick={() => {
                      setSelectedScenarioName(scenario.name);
                    }}
                  >
                    {scenario.name}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                No {activeMode} scenarios yet. Create one below.
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
        </div>
      </section>

      <TabsContent
        value="performance"
        className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
      >
        <WorkspaceEvals
          key={`performance-${skillName}`}
          skill={skill}
          workspacePath={workspacePath}
          scenario={selectedScenario}
          scenarioLoading={selectedScenarioQuery.isLoading}
          onStartNewScenario={handleStartNewScenario}
          onCreateScenario={handleCreateScenario}
          onSaveScenario={handleSaveScenario}
          onSuggestScenario={handleSuggestScenario}
          onDeleteScenario={handleDeleteScenario}
          saveScenarioPending={
            createScenarioMutation.isPending || saveScenarioMutation.isPending
          }
          suggestScenarioPending={suggestScenarioMutation.isPending}
          deleteScenarioPending={deleteScenarioMutation.isPending}
          onNavigateToRefine={onNavigateToRefine}
          onRunningChange={setPerformanceRunning}
        />
      </TabsContent>

      <TabsContent
        value="trigger"
        className="min-h-0 flex-1 overflow-y-auto px-6 pb-6"
      >
        <WorkspaceDescription
          key={`trigger-${triggerSkill.name}-${selectedScenarioName ?? "new"}`}
          skill={triggerSkill}
          workspacePath={workspacePath ?? ""}
          scenario={selectedScenario}
          scenarioLoading={selectedScenarioQuery.isLoading}
          onStartNewScenario={handleStartNewScenario}
          onCreateScenario={handleCreateScenario}
          onSaveScenario={handleSaveScenario}
          onDeleteScenario={handleDeleteScenario}
          saveScenarioPending={saveScenarioMutation.isPending}
          onNavigateToRefine={onNavigateToRefine}
          onRunningChange={setTriggerRunning}
          onApply={(description, version) =>
            onApplyDescription?.(description, version)
          }
        />
      </TabsContent>
    </Tabs>
  );
}
