# Refine

The Refine page lets you edit a skill by chatting with an agent. Describe a change, the agent updates the files, and you can preview the diff before reviewing.

---

## What's on this screen

The page has three zones:

- **Top bar** — skill picker dropdown
- **Main area** — two columns: Chat panel (left) and Preview panel (right), separated by a draggable divider
- **Status bar** — pinned to the bottom; shows agent status, skill name, model, and elapsed time while running

---

## How to make a change request

1. Select a skill from the **skill picker** in the top bar.
2. Wait for the preview panel to load the skill files.
3. Type your request in the input bar at the bottom of the chat panel (e.g. *"Add an example for handling edge cases"*).
4. Press **Enter** or click the **send** button (arrow icon). The agent streams its response in the chat.

> **Enter** sends. **Shift+Enter** adds a newline.

---

## How to target a specific file

1. In the input bar, type `@` to open the file picker popup.
2. Use arrow keys or click to select a file (e.g. `SKILL.md`).
3. A badge labelled `@SKILL.md` appears above the textarea. Add your message and send.
4. To remove the file target before sending, click the **×** on the badge.

---

## How to use commands

Type `/` in the input bar to open the command picker. Two commands are available:

| Command | What it does |
|---|---|
| **Rewrite skill** (`/rewrite`) | Instructs the agent to rewrite the skill from scratch based on your instructions |
| **Validate skill** (`/validate`) | Instructs the agent to check the skill for issues and report them |

Select a command, optionally add instructions in the textarea, and send.

---

## How to review a diff

1. After the agent finishes a run, click **Diff** in the preview panel toolbar.
2. The panel shows a line-by-line comparison. Green `+` lines are additions; red `-` lines are removals; grey lines are unchanged.
3. Click **Preview** to return to the rendered markdown view.

> **Diff** is disabled until the agent has completed at least one run (there is no baseline before that).

---

## How to resize the panels

- Click and drag the vertical divider between the chat and preview panels. It moves between 20% and 80% of the window width.
- Or focus the divider and use the **Left/Right arrow keys** to move it in 2% steps.

---

## How to switch skills

Click the skill picker in the top bar and select a different skill. The chat clears, a new session starts, and the preview loads the new skill's files.

> Switching skills is disabled while the agent is running.

---

## Controls reference

| Control | Location | What it does |
|---|---|---|
| Skill picker | Top bar | Select which skill to refine |
| Textarea | Chat input bar | Type your change request |
| Send button (arrow icon) | Chat input bar | Send the message |
| `@` file picker | Chat input bar | Target a specific skill file |
| `/` command picker | Chat input bar | Attach a `/rewrite` or `/validate` command |
| Badge × buttons | Chat input bar | Remove a file target or command before sending |
| File picker button | Preview panel toolbar | Switch which file is shown in the preview |
| Diff / Preview toggle | Preview panel toolbar | Switch between rendered markdown and line diff |

---

## States

**No skill selected** — chat shows: *"Select a skill to start refining"*

**Skill selected, no messages** — chat shows: *"Send a message to start refining"*

**Session limit reached** — a banner appears above the input bar: *"This refine session has reached its limit. Select the skill again to start a new session."* The input bar is disabled. Re-select the skill from the picker to start fresh.

**Scope block** — an amber banner appears: *"Scope recommendation active — refine is blocked until resolved."* with a **Go to Workflow →** link. The input bar is disabled until you resolve the scope recommendation in the workflow.

**Agent running** — the textarea and send button are disabled. The skill picker is also disabled.

**Navigating away while agent runs** — a dialog appears: *"Agent Running — An agent is still running. Leaving will abandon it and end the session."* Click **Stay** or **Leave**.
