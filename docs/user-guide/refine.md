# Workspace: Refine

Refine is a workspace tab for builder skills. It lets you chat with an agent, update `SKILL.md` or `references/*.md`, and inspect the resulting preview or diff.

You can reach it from:

- **More actions → Refine** on a completed skill
- the **Refine** tab inside the selected skill’s workspace shell

---

## What is on this screen

The Refine tab has two parts:

- a **Chat** panel on the left
- an optional **file viewer** panel that slides in from the right

There is no standalone Refine route with a top-bar skill picker in the current app.

---

## Start a request

1. Open a builder skill and switch to **Refine**.
2. Type your request in the editor at the bottom of the chat.
3. Press **Enter** to send, or click the send button.

`Shift+Enter` inserts a newline.

When the agent is running, the send button turns into a cancel icon button.

---

## Target files or agents with `@`

Type `@` in the editor to open the mention picker.

The picker can show:

- skill files such as `SKILL.md` or `references/...`
- available refine agents

If you mention a file, it appears as a badge above the editor and is sent as part of the request context.

---

## Quick-start suggestions

When the chat is empty, Refine shows suggestion chips such as:

- `Validate this skill`
- `Improve the skill`
- `Run benchmarks`

These fill the editor for you. They are plain prompts, not slash commands.

The current Refine UI does not expose a `/rewrite` or `/validate` command picker.

---

## Review changed files

After a successful run, Refine shows **Changed** pills below the agent turn for modified authored files.

Click a pill to open the right-side file viewer. In that panel you can:

- switch files
- toggle between **Diff** and **Preview** when a diff exists
- resize the panel by dragging the left edge
- close it with the close button or `Esc`

The file viewer can also be opened from the file button in the workspace header.

---

## States and guards

**No skill selected**

The tab shows `Select a skill to start refining`.

**Scope blocked**

If the workflow marked the skill scope as too broad, Refine shows a warning banner and disables input until the workflow is resolved.

**Session exhausted**

If the refine session reaches its limit, the tab shows:

`This refine session has reached its limit. Select the skill again to start a new session.`

**Leaving while a run is active**

If you switch away from Refine during a running turn, the app shows an **Agent Running** dialog and asks whether to **Stay** or **Leave**.
