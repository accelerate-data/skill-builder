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
3. The screen shows **Analyzing Responses** while the app evaluates answer quality.
4. If the answers are strong enough, the workflow advances. If anything needs attention, the editor stays open with review feedback and the app shows a toast.

---

## Answer review

After you click Continue, the app evaluates answer completeness, specificity, and consistency.

Possible outcomes:

- Step 2 runs when more detailed research is useful.
- Step 2 is skipped when the Step 1 answers are already strong enough for decisions.
- The editor remains open when required answers are missing, vague, or contradictory.

Use the highlighted feedback to revise answers before continuing again.

---

## Re-run Step 1

Click **Re-run** at the bottom left of the editor. This opens the Reset Step dialog, which shows which files will be deleted. Click **Delete N files & Reset** to confirm. The agent re-runs from the beginning.
