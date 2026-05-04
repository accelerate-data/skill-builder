# Settings

Open Settings from the gear icon in the left rail, or press **Cmd+,** / **Ctrl+,**.

The current sections are:

- **General**
- **Models**
- **Plugins**
- **Marketplace**
- **GitHub**
- **Advanced**
- **Documents**
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

The API key no longer lives in **General**. It lives in **Models**.

---

## Models

Configure the language model used by workflow agents.

### Provider

- **Provider** — select from the available catalog (Anthropic, OpenAI, Google, Ollama) or choose **Custom** to enter any OpenHands-compatible endpoint.
- **API Key** — the key for the selected provider. Use the **Test** / **Valid** button to verify the connection.
- **Base URL** — optional override for the provider endpoint. Required for Ollama and custom backends.

### Model

Select a model from the catalog picker, or type any OpenHands-compatible model ID when a catalog is unavailable. The required capabilities (reasoning and tool calling) are shown as a reference.

### Model Details

Read-only catalog metadata for the selected model: tool calling, reasoning, structured output, temperature support, context window, max output, and pricing.

### Request Options

- **Reasoning effort** — Auto, Low, Medium, or High.
- **Timeout** — request timeout in seconds.
- **Retries** — number of retries on transient failures.

### App Behavior

- **Prompt suggestions** — allow refine chat sessions to request prompt suggestions when supported.

### Advanced Provider Overrides

- **Provider API version** — optional version string passed to compatible provider backends.

### Research Scope Limit

Use **Max dimensions** to control how broad the initial research pass can be before the app recommends a narrower scope.

---

## Plugins

This section manages plugins — named groups of related skills. See [Plugins](plugins.md) for full details.

The action bar provides:

- **Create Plugin** — create a new empty plugin
- **Marketplace** — browse and install plugins from configured registries (disabled until at least one enabled registry exists in **Marketplace**)
- **Upload** — import a skill package from a `.skill` or `.zip` file

Below the actions, a table lists installed non-default plugins with their display name, slug, version, source, status, and whether upgrades are locked. Click the trash icon on a row to delete a plugin.

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

## Documents

Documents is a Settings section for adding files, URLs, and folders as reference context for skill workflows. See [Documents](documents.md).

## Usage

Usage is now a Settings section, not a separate top-level route. See [Usage](usage.md).
