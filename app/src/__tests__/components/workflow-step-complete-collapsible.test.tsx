import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const mockGetStepAgentRuns = vi.fn();
const mockReadFile = vi.fn();
const mockListSkillFiles = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getStepAgentRuns: (...args: unknown[]) => mockGetStepAgentRuns(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  listSkillFiles: (...args: unknown[]) => mockListSkillFiles(...args),
  writeFile: vi.fn(),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

import { WorkflowStepComplete } from "@/components/workflow-step-complete";

const researchPlanMd = `---
purpose: Test purpose
dimensions_evaluated: 2
dimensions_selected: 1
---

## Dimension Scores
| Dimension | Score | Reason |
| --- | --- | --- |
| depth | 5 | test |
| breadth | 3 | test |

## Selected Dimensions
| Dimension |
| --- |
| depth |
`;

const clarificationsJson = JSON.stringify({
  version: "1",
  metadata: {
    title: "Clarifications",
    question_count: 2,
    section_count: 2,
    refinement_count: 0,
    must_answer_count: 0,
    priority_questions: [],
  },
  sections: [
    {
      id: "S1",
      title: "Section One",
      questions: [
        {
          id: "Q1",
          title: "Question One",
          must_answer: false,
          text: "Question one text",
          choices: [],
          answer_choice: null,
          answer_text: null,
          refinements: [],
        },
      ],
    },
    {
      id: "S2",
      title: "Section Two",
      questions: [
        {
          id: "Q2",
          title: "Question Two",
          must_answer: false,
          text: "Question two text",
          choices: [],
          answer_choice: null,
          answer_text: null,
          refinements: [],
        },
      ],
    },
  ],
  notes: [
    {
      type: "general",
      title: "Context",
      body: "Important research note.",
    },
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetStepAgentRuns.mockResolvedValue([]);
  mockListSkillFiles.mockResolvedValue([]);
  mockReadFile.mockImplementation((path: string) => {
    if (path.includes("research-plan.md")) return Promise.resolve(researchPlanMd);
    if (path.includes("clarifications.json")) return Promise.resolve(clarificationsJson);
    return Promise.resolve(null);
  });
});

describe("WorkflowStepComplete collapsible clarifications coverage", () => {
  it("shows collapsible notes/sections on Research step in update mode", async () => {
    render(
      <WorkflowStepComplete
        stepName="Research"
        stepId={0}
        outputFiles={["context/research-plan.md", "context/clarifications.json"]}
        skillName="my-skill"
        skillsPath="/skills"
        clarificationsEditable
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Research Notes/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Section One/i })).toBeInTheDocument();
  });

  it("shows collapsible notes/sections on Research step in review mode", async () => {
    render(
      <WorkflowStepComplete
        stepName="Research"
        stepId={0}
        outputFiles={["context/research-plan.md", "context/clarifications.json"]}
        skillName="my-skill"
        skillsPath="/skills"
        reviewMode
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Research Notes/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Section One/i })).toBeInTheDocument();
  });

  it("shows collapsible notes/sections on Detailed Research step in update mode", async () => {
    render(
      <WorkflowStepComplete
        stepName="Detailed Research"
        stepId={1}
        outputFiles={["context/clarifications.json"]}
        skillName="my-skill"
        skillsPath="/skills"
        clarificationsEditable
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Research Notes/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Section One/i })).toBeInTheDocument();
  });

  it("shows collapsible notes/sections on Detailed Research step in review mode", async () => {
    render(
      <WorkflowStepComplete
        stepName="Detailed Research"
        stepId={1}
        outputFiles={["context/clarifications.json"]}
        skillName="my-skill"
        skillsPath="/skills"
        reviewMode
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Research Notes/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Section One/i })).toBeInTheDocument();
  });
});
