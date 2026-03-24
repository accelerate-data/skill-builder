# Plugins

A plugin is a named group of related skills. Every skill belongs to exactly one plugin. Plugins let you organise skills into logical bundles, share them as a single package, and import collections from marketplace registries.

---

## Key concepts

**Default plugin** — The app creates a default plugin called **Skills** automatically. New builder skills go here unless you choose otherwise. The default plugin cannot be deleted.

**Plugin sources**

| Source | Meaning |
|---|---|
| Synthetic | Created by you inside the app |
| Marketplace | Imported from a GitHub-backed registry |
| Uploaded | Imported from a `.plugin.zip` file |

**Library key** — Each skill is uniquely identified by its library key in the format `skill-builder:{plugin_slug}:{skill_name}`.

---

## Viewing plugins

Open **Settings → Plugins** to see a table of all installed plugins. Each row shows:

- Plugin display name and slug
- Version (or **—** if none)
- Source URL or source type
- A delete button (not shown for the default plugin)

When there are no plugins, an empty state card reads **No plugins** with the description "Browse the marketplace or upload a plugin package to get started."

---

## Creating a plugin

1. In **Settings → Plugins**, click **Create Plugin**.
2. Enter a plugin name. Names must be lowercase letters, numbers, and hyphens only (e.g. `my-plugin`).
3. Click **Create**.

You can also create a plugin from the skill list context menu — see [Dashboard — Plugin actions](dashboard.md#plugin-actions).

When creating a plugin from the context menu with a skill selected, the dialog offers to move that skill into the new plugin immediately.

---

## Deleting a plugin

Click the trash icon on a plugin row in **Settings → Plugins**. A confirmation toast appears. The default **Skills** plugin cannot be deleted.

---

## Moving skills between plugins

Use the **Move to Plugin** dialog to relocate a skill:

1. Open the skill's context menu in the dashboard skill list.
2. Click **Move to plugin**.
3. Select a target plugin from the radio list (shows display name and slug).
4. Click **Move**.

Restrictions:

- You cannot move a skill to a marketplace plugin.
- You cannot move a skill to the plugin it already belongs to.
- If no other plugins exist, the dialog shows "No other plugins available. Create a plugin first."

---

## Removing a skill from a plugin

For skills in a non-default plugin, the context menu shows **Remove from plugin**. This moves the skill back to the default **Skills** plugin.

---

## Importing plugins from the marketplace

1. In **Settings → Plugins**, click **Marketplace** (requires at least one enabled registry in Settings → Marketplace).
2. Browse available plugins. Each shows a name, description, and installation status badge (idle, importing, imported, or already exists).
3. Click a plugin to install it. The app downloads the entire plugin directory.
4. A success toast confirms the import.

If multiple registries are configured, each appears as a separate tab.

---

## Packaging a plugin

Packaging creates a distributable `.plugin.zip` file that contains all skills in the plugin plus its metadata. When you package an individual skill, the app packages its entire parent plugin.

---

## Storage layout

Plugins are stored on disk under your Skills Folder:

| Location | What lives there |
|---|---|
| `{skills_folder}/{plugin_slug}/skills/{skill_name}/` | Skills in non-default plugins |
| `{skills_folder}/skills/{skill_name}/` | Skills in the default **Skills** plugin (flat layout) |
| `{skills_folder}/{plugin_slug}/.claude-plugin/plugin.json` | Plugin metadata |
| `{skills_folder}/.claude-plugin/marketplace.json` | Auto-generated index of all local plugins |
