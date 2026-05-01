import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readTemplate = <T>(relativePath: string): T => {
  const templatePath = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(templatePath, "utf8")) as T;
};

export interface DescriptionEvalQueryFixture {
  query: string;
  should_trigger: boolean;
}

const descriptionEvalResult = readTemplate<{ queries: DescriptionEvalQueryFixture[] }>(
  "../../sidecar/mock-templates/outputs/description-evals-generator/description-evals-result.json",
);

export const GENERATED_DESCRIPTION_EVAL_QUERIES = descriptionEvalResult.queries;

export const DESCRIPTION_OPTIMIZATION_RESULT = readTemplate<{
  best_description: string;
  history: Array<Record<string, unknown>>;
  iterations_run: number;
}>("../../sidecar/mock-templates/outputs/description-optimization-loop/optimization-result.json");
