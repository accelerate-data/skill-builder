# Step 1: Research

The agent researches your domain and generates a set of clarification questions. Your job is to answer them.

---

## What happens first

When you start the workflow, the agent runs automatically. The content area streams its activity live. When it finishes, the clarifications editor appears.

---

## What's on screen after the agent finishes

**Research Complete summary card** (collapsible, shown at top)

| Column | What it shows |
|---|---|
| **Dimensions** | How many domain dimensions were evaluated vs. selected; dimension pills with scores (e.g. "Terminology 4/5") |
| **Clarifications** | Total questions, sections, "Must answer" count, and how many you've answered so far |
| **Notes** | Count of research notes; a warning count if any are flagged as blocked or a critical gap |

**Clarifications editor** (below the summary card)

A list of questions grouped into sections. Each question has a text area for your answer.

---

## How to answer clarification questions

1. Read each question. Questions marked with a red **must** badge are required — you cannot continue until all of them are answered.
2. Type your answer in the text area below the question.
3. Answers save automatically 1.5 seconds after you stop typing. The bottom-left shows **Unsaved changes**, **Saving...**, or **Saved**.
4. Once all **must** questions are answered, the **Continue** button activates.

---

## How to continue to Step 2

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

## How to re-run Step 1

Click **Re-run** at the bottom left of the editor. This opens the Reset Step dialog, which shows which files will be deleted. Click **Delete & Reset** to confirm. The agent re-runs from the beginning.
