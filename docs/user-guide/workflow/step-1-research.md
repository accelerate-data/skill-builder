# Step 1: Research

The first step researches the domain and produces `context/research-plan.md` plus `context/clarifications.json`.

---

## What happens first

When you start the workflow, the agent runs automatically. The content area streams its activity live. When it finishes, the clarifications editor appears.

---

## What you see after the run finishes

The completion view includes a research summary at the top and the clarifications editor below it.

The summary can show:

- research outcome state
- dimension counts and selected dimensions
- clarification counts
- notes and warnings
- run duration when relevant

Below that, the clarifications editor shows grouped questions and any follow-up refinements.

---

## Answer clarifications

1. Click a question card to expand it.
2. If the question has choices, click one to select it. A **recommended** badge marks the agent's suggestion. You can select a choice and edit the answer text, or ignore the choices and type freely.
3. Questions marked **must** are required — **Continue** stays disabled until all are answered.
4. Answers save automatically as you type.

## Refinements

Some questions have nested **Refinements** — follow-up sub-questions inside the same card, below the main answer. Answer them the same way. The question header shows a badge like *"2 refinements (1 unanswered)"* when they exist.

---

## Continue

1. Answer all questions marked **must**.
2. Click **Continue** at the bottom right. The button shows **Evaluating answers...** while the gate check runs.
3. A transition gate dialog appears — see [Gate 1](#gate-1-transition-dialog) below.

---

## Gate 1 transition dialog

After you click Continue, the app evaluates your answers and shows one of these dialogs:

**"Skip Detailed Research?"** — your answers are thorough

- **Run Research Anyway** — proceeds to Step 2 (Detailed Research)
- **Skip to Decisions** — skips Step 2 and jumps directly to Step 3

**"Some Answers Need Deeper Research"** — a few answers need more detail

- **Let Me Revise** — returns to the editor so you can improve your answers
- **Continue to Research** — proceeds to Step 2 anyway

**"Review Answer Quality"** — some answers are missing or too vague

- **Let Me Answer** — returns to the editor
- **Continue Anyway** — proceeds to Step 2 despite incomplete answers

**"Contradictory Answers"** — some answers conflict with each other

- **Let Me Answer** — returns to the editor (the only option; you must resolve the contradiction before continuing)

Each dialog shows a per-question breakdown: OK, Missing, Vague, Needs refinement, and Contradictory counts.

---

## Re-run Step 1

Click **Re-run** at the bottom left of the editor. This opens the Reset Step dialog, which shows which files will be deleted. Click **Delete & Reset** to confirm. The agent re-runs from the beginning.
