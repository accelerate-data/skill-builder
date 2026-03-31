# Settings

Open Settings from the gear icon in the left rail, or press **Cmd+,** / **Ctrl+,**.

The current sections are:

- **General**
- **Claude SDK**
- **Plugins**
- **Marketplace**
- **GitHub**
- **Advanced**
- **Usage**

Most changes save immediately.

---

## General

### User Profile

- **Industry**
- **Function / Role**

These fields help tailor research and skill content.

### Appearance

Choose **System**, **Light**, or **Dark**.

### About

The section shows the current app version and an **About Skill Builder** button.

The API key no longer lives in **General**. It lives in **Claude SDK**.

---

## Claude SDK

### API Configuration

- **Anthropic API Key**
- **Test** / **Valid** button

### Model

Select the preferred Claude model from the currently available model list.

### Agent Features

- **Extended thinking**
- **Interleaved thinking beta**
- **Reasoning effort**
- **Refine prompt suggestions**

### Research Scope Limit

Use **Max dimensions** to control how broad the initial research pass can be before the app recommends a narrower scope.

---

## Plugins

This section manages plugins — named groups of related skills. See [Plugins](plugins.md) for full details.

The action bar provides:

- **Create Plugin** — create a new empty plugin
- **Marketplace** — browse and install plugins from configured registries (disabled until at least one enabled registry exists in **Marketplace**)
- **Upload** — import a skill package from a `.skill` or `.zip` file

Below the actions, a table lists installed non-default plugins with their display name, slug, version, and source. Click the trash icon on a row to delete a plugin.

The default **Skills** plugin is managed automatically and does not appear as a row in this table.

When no non-default plugins exist, an empty state card reads "No plugins".

---

## Marketplace

### Registries

Each row shows:

- the repository identifier
- an **Enabled** switch
- a test/check button
- a remove button for non-built-in registries

Use **Add registry** to add `owner/repo` or `owner/repo#branch`.

### Auto-update

Use **Enable auto-update** to let the app apply marketplace updates at startup.

---

## GitHub

The GitHub section shows the current account status.

- If signed out, it shows **Sign in with GitHub**.
- If signed in, it shows the avatar, login, optional email, last checked time, and **Sign Out**.

---

## Advanced

### Logging

Choose a log level:

- **Error**
- **Warn**
- **Info**
- **Debug**

### Storage

The current Advanced section exposes:

- **Skills Folder** with **Browse**
- **Data Directory** as read-only information

The current Settings UI does not expose a workspace-folder reset control here.

---

## Usage

Usage is now a Settings section, not a separate top-level route. See [Usage](usage.md).
