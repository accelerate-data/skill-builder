import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock useClarifications — Research and DetailedResearch steps use TanStack Query
const mockUseClarifications = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/clarifications", () => ({
  useClarifications: mockUseClarifications,
}));

// ClarificationsDto matching the clarificationsJson fixture (sections + notes)
const mockClarDto = {
  skill_id: "my-skill",
  version: "1",
  refinement_count: 0,
  must_answer_count: 0,
  question_count: 2,
  section_count: 2,
  title: "Clarifications",
  sections: [
    { section_id: 1, ordinal: 0, title: "Section One" },
    { section_id: 2, ordinal: 1, title: "Section Two" },
  ],
  questions: [
    { question_id: "Q1", section_id: 1, parent_question_id: null, ordinal: 0, title: "Question One", text: "Question one text", must_answer: false, answer_choice: null, answer_text: null, choices: [], refinements: [] },
    { question_id: "Q2", section_id: 2, parent_question_id: null, ordinal: 0, title: "Question Two", text: "Question two text", must_answer: false, answer_choice: null, answer_text: null, choices: [], refinements: [] },
  ],
  notes: [
    { ordinal: 0, note_type: "general", title: "Context", body: "Important research note." },
  ],
};

const mockGetStepAgentRuns = vi.fn();
const mockReadFile = vi.fn();
const mockListSkillFiles = vi.fn();
const mockGetContextFileContent = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getStepAgentRuns: (...args: unknown[]) => mockGetStepAgentRuns(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  listSkillFiles: (...args: unknown[]) => mockListSkillFiles(...args),
  getContextFileContent: (...args: unknown[]) => mockGetContextFileContent(...args),
  writeFile: vi.fn(),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div>{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

import { WorkflowStepComplete } from "@/components/step-complete";

const researchPlanMd = `---
purpose: Test purpose
---

## Research Summary
The research step produced clarification questions and notes.
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
  mockUseClarifications.mockReturnValue({ data: mockClarDto, isLoading: false, isError: false });
  mockReadFile.mockImplementation((path: string) => {
    if (path.includes("research-plan.md")) return Promise.resolve(researchPlanMd);
    if (path.includes("clarifications.json")) return Promise.resolve(clarificationsJson);
    return Promise.resolve(null);
  });
  mockGetContextFileContent.mockImplementation((_skill: string, _workspace: string, filename: string) => {
    if (filename === "clarifications.json") return Promise.resolve(clarificationsJson);
    return Promise.resolve(null);
  });
});

describe("WorkflowStepComplete collapsible clarifications coverage", () => {
  it("shows collapsible notes/sections on Research step in update mode", async () => {
    render(
      <WorkflowStepComplete
        stepName="Research"
        stepId={0}
        outputFiles={["context/clarifications.json"]}
        skillName="my-skill"
        workspacePath="/workspace"
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
        outputFiles={["context/clarifications.json"]}
        skillName="my-skill"
        workspacePath="/workspace"
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
        workspacePath="/workspace"
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
        workspacePath="/workspace"
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
