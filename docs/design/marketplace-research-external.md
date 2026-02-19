# Skills Marketplace — External Research

> Research on how Claude Code and other AI coding tools handle plugin/extension marketplaces.
> Conducted Feb 2026 to inform skills marketplace design for the skill-builder project.

---

## 1. Claude Code Plugin Marketplace

### 1.1 Architecture Overview

Claude Code's plugin system uses a **two-tier marketplace model**:

1. **Marketplace** = a catalog of plugins (like an app store)
2. **Plugin** = a self-contained directory of components (skills, agents, hooks, MCP servers, LSP servers)

Users first add a marketplace (registers the catalog), then install individual plugins from it. The official Anthropic marketplace (`claude-plugins-official`) is bundled automatically.

**Source**: [Discover and install prebuilt plugins](https://code.claude.com/docs/en/discover-plugins)

### 1.2 Discovery & Browse UX

- **Interactive TUI**: `/plugin` command opens a tabbed interface with four tabs:
  - **Discover**: Browse available plugins from all added marketplaces (with type-to-filter search)
  - **Installed**: View and manage installed plugins
  - **Marketplaces**: Add, remove, or update marketplaces
  - **Errors**: View plugin loading errors
- **CLI commands**: `claude plugin install`, `claude plugin list`, `claude plugin update`, etc.
- **Auto-suggestion**: Claude may prompt users to install relevant plugins based on project context (e.g., prompting to install a TypeScript LSP plugin when opening a TypeScript project)
- **No web-based browse UI** in the official system — it's all CLI/TUI

**Source**: [Discover plugins docs](https://code.claude.com/docs/en/discover-plugins)

### 1.3 Plugin Manifest Format (`plugin.json`)

Located at `.claude-plugin/plugin.json`. Only `name` is required if manifest is present; it can be omitted entirely for auto-discovery.

```json
{
  "name": "plugin-name",           // Required, kebab-case
  "version": "1.2.0",              // Semver
  "description": "Brief description",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://github.com/author"
  },
  "homepage": "https://docs.example.com/plugin",
  "repository": "https://github.com/author/plugin",
  "license": "MIT",
  "keywords": ["keyword1", "keyword2"],  // Discovery tags
  "commands": ["./custom/commands/"],
  "agents": "./custom/agents/",
  "skills": "./custom/skills/",
  "hooks": "./config/hooks.json",
  "mcpServers": "./mcp-config.json",
  "outputStyles": "./styles/",
  "lspServers": "./.lsp.json"
}
```

**Source**: [Plugins reference](https://code.claude.com/docs/en/plugins-reference)

### 1.4 Marketplace Registry Format (`marketplace.json`)

Located at `.claude-plugin/marketplace.json`. Defines the catalog:

```json
{
  "name": "company-tools",         // Marketplace identifier, kebab-case
  "owner": {
    "name": "DevTools Team",
    "email": "devtools@example.com"
  },
  "metadata": {
    "description": "Brief marketplace description",
    "version": "1.0.0",
    "pluginRoot": "./plugins"      // Base dir for relative paths
  },
  "plugins": [
    {
      "name": "code-formatter",
      "source": "./plugins/formatter",    // or GitHub/npm/git object
      "description": "Automatic code formatting",
      "version": "2.1.0",
      "author": { "name": "DevTools Team" },
      "homepage": "https://...",
      "repository": "https://...",
      "license": "MIT",
      "keywords": ["formatting", "linter"],
      "category": "productivity",         // Marketplace-specific field
      "tags": ["typescript", "python"],   // Marketplace-specific field
      "strict": true                      // Controls manifest authority
    }
  ]
}
```

**Plugin source types**: relative path (`"./plugins/x"`), GitHub (`{ source: "github", repo: "owner/repo", ref?, sha? }`), git URL, npm package, pip package.

**Source**: [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)

### 1.5 Install Flow

1. **Add marketplace**: `/plugin marketplace add owner/repo` (or git URL, local path, remote URL)
2. **Browse**: `/plugin` → Discover tab, or CLI `claude plugin install plugin-name@marketplace-name`
3. **Choose scope**: User (personal, all projects), Project (shared via `.claude/settings.json`), Local (gitignored)
4. **What happens on install**: Plugin directory is copied to `~/.claude/plugins/cache/`. Commands become available immediately, namespaced as `plugin-name:command-name`
5. **Uninstall**: `/plugin uninstall plugin-name@marketplace-name` or via the Installed tab

### 1.6 Versioning & Updates

- **Semver** (`MAJOR.MINOR.PATCH`) in `plugin.json` or `marketplace.json`
- **Auto-update**: Official marketplaces have auto-update enabled by default. At startup, Claude Code refreshes marketplace data and updates installed plugins. Notification shown if updates were applied.
- **Manual update**: `/plugin marketplace update marketplace-name` or `claude plugin update plugin-name`
- **Release channels**: Support for stable/latest channels by pointing two marketplaces at different git refs
- **Version pinning**: `sha` field for exact commit pinning

### 1.7 Team & Enterprise Features

- **Team marketplaces**: Add to `.claude/settings.json` → `extraKnownMarketplaces` to auto-prompt team members
- **Managed settings**: Admins can push plugins via managed settings (read-only for users)
- **`strictKnownMarketplaces`**: Restrict which marketplaces users can add (allowlist or complete lockdown)
- **Private repos**: Works with existing git credential helpers; token env vars for background auto-updates

### 1.8 Community & Popularity Signals

- **No ratings, reviews, or download counts** in the official marketplace
- **No community contribution directly** to the official marketplace — external plugins submitted via [plugin directory submission form](https://clau.de/plugin-directory-submission) and vetted by Anthropic
- **Trust model**: "Make sure you trust a plugin before installing it" — Anthropic does not verify third-party plugins
- **Official marketplace**: ~7.6k GitHub stars, curated by Anthropic with internal + vetted external plugins

### 1.9 Categories in Official Marketplace

| Category | Examples |
|---|---|
| **Code Intelligence** | LSP plugins for 11+ languages (TypeScript, Python, Rust, Go, etc.) |
| **External Integrations** | GitHub, GitLab, Linear, Jira, Slack, Figma, Vercel, Firebase, Supabase, Sentry |
| **Development Workflows** | commit-commands, pr-review-toolkit, agent-sdk-dev, plugin-dev |
| **Output Styles** | explanatory-output-style, learning-output-style |

---

## 2. Community Plugin Registries for Claude Code

### 2.1 claude-plugins.dev (Kamalnrf/claude-plugins)

A **community-driven registry** that automatically discovers and indexes public Claude Code plugins and skills from GitHub.

- **Scale**: 11,989+ plugins, 63,065+ skills indexed
- **CLI tools**: `claude-plugins` (for Claude Code) and `skills-installer` (multi-client, supports 15+ clients including Cursor, Windsurf, VS Code)
- **Discovery**: Interactive terminal search with sorting by relevance/stars/installs
- **Popularity signals**: GitHub stars, install counts, relevance scoring
- **Web browse**: claude-plugins.dev provides web-based browsing alongside CLI
- **Multi-client**: Same skills installable across Claude Code, Cursor, Codex, etc.

**Source**: [claude-plugins.dev](https://claude-plugins.dev/), [GitHub](https://github.com/Kamalnrf/claude-plugins)

### 2.2 Other Community Hubs

- **claudepluginhub.com**: Community directory browsing 29+ categories (DevOps, security, testing, data, AI/ML)
- **claudecodeplugins.io**: Skills hub with plugin and agent skill listings
- **buildwithclaude.com/plugins**: Curated plugin listings
- **aitmpl.com/plugins**: Template and plugin directory

These community sites fill a gap by providing web-based browsing, search, and categorization that the official CLI-only marketplace lacks.

---

## 3. Cursor: Rules Directory Pattern

### 3.1 Architecture

Cursor does **not have a plugin/extension marketplace of its own**. Instead:
- It uses the **VS Code extension marketplace** for IDE extensions (with some Microsoft restrictions)
- Community has built **rules directories** as the primary sharing mechanism

### 3.2 Cursor Directory (cursor.directory)

The de facto community hub for Cursor customization:

- **Content types**: Rules (.cursorrules files), MCP servers, community profiles
- **Community**: 63.3k+ members
- **Key features**:
  - Browse pre-made rule files by framework/language (React, Vue, Python, Go, etc.)
  - **Rule generator**: Describe your tech stack → generates a tailored .cursorrules file
  - Copy-paste installation (no CLI)
  - Community-contributed rules
- **No formal registry** — it's a curated website with copy-to-clipboard UX
- **Popularity**: Social sharing, community voting

### 3.3 Other Cursor Rule Directories

- **bestcursorrules.com**: 55.8k+ developers, "discover, share, contribute" model
- **dotcursorrules.com**: Focused on mastering .cursorrules format
- **playbooks.com**: Free curated directory of skills, docs, and context — browse and copy, no account required

**Key pattern**: Cursor's ecosystem evolved around **file-based sharing** (copy a text file into your project) rather than a formal install/package system. This is similar to how skills work in our skill-builder.

**Source**: [cursor.directory](https://cursor.directory/), [bestcursorrules.com](https://www.bestcursorrules.com/)

---

## 4. Continue.dev: Hub Model

### 4.1 Architecture

Continue.dev uses a **centralized Hub** model at [hub.continue.dev](https://hub.continue.dev/):

- **Assistants**: Pre-configured AI coding assistants composed of models + rules + tools (MCP servers)
- **Rules**: Instruction blocks that guide model behavior (inserted into system messages)
- **Models**: Configuration for various providers (Anthropic, OpenAI, Gemini, Ollama, etc.)
- **Packages**: Reusable building blocks

### 4.2 Key Features

- **One-click install**: Browse assistants, add with a single click
- **Web-based management**: Configure models and settings through web UI (no JSON editing required)
- **Auto-sync**: Changes reflect immediately across all IDE instances
- **Team sharing**: Share custom assistants with team members
- **Open-source**: Community can contribute blocks

### 4.3 Relevance to Skill Builder

Continue's Hub is the closest analog to what a skills marketplace could look like:
- Web-based browse + one-click install
- Composable building blocks (rules ≈ skills, assistants ≈ skill bundles)
- Team sharing as a first-class feature
- Sync across environments

**Source**: [Continue Hub](https://www.continue.dev/hub), [Hub docs](https://docs.continue.dev/guides/understanding-assistants)

---

## 5. Windsurf: Distributed Plugin Model

### 5.1 Architecture

Windsurf operates as a **distributed plugin ecosystem** rather than a centralized marketplace:

- Plugins distributed through **platform-native stores** (VS Code Marketplace, JetBrains, Chrome Web Store, Eclipse Marketplace)
- No centralized Windsurf-specific marketplace
- Plugins are primarily the Windsurf extension itself (AI autocomplete, chat, Cascade agent) rather than a marketplace of extensions

### 5.2 Key Features

- **Pre-release channel**: Users can switch to pre-release versions
- **Maintenance tiers**: Some plugins in "maintenance mode" (VS Code, Vim) vs active development (JetBrains)
- **Enterprise support**: Configurable enterprise URLs and tokens for self-hosted deployments

### 5.3 Relevance to Skill Builder

Windsurf shows that AI coding tools can succeed without a custom marketplace by leveraging existing distribution channels. However, this only works when the "extension" is monolithic (one plugin per platform) rather than a diverse ecosystem.

**Source**: [Windsurf Plugins Docs](https://docs.windsurf.com/plugins/getting-started)

---

## 6. Pattern Comparison Matrix

| Aspect | Claude Code | Cursor | Continue.dev | Windsurf |
|---|---|---|---|---|
| **Marketplace type** | CLI/TUI catalog | Community web directories | Centralized web hub | Platform-native stores |
| **Discovery UX** | `/plugin` TUI with Discover tab | Web browse + copy-paste | Web browse + one-click | IDE marketplace search |
| **Install mechanism** | CLI command + scope selection | Copy file into project | One-click from hub | IDE extension install |
| **Registry format** | `marketplace.json` + `plugin.json` | None (file-based) | Hub API (proprietary) | Platform-specific |
| **Versioning** | Semver + auto-update | N/A (file-based) | Hub-managed | Platform-managed |
| **Team features** | Managed settings, team marketplaces | None | Team sharing, sync | Enterprise config |
| **Community signals** | None officially | Community voting, stars | N/A | Platform ratings |
| **Content granularity** | Plugins (bundles of skills/agents/hooks) | Rules (single files) | Assistants (bundles) | Extensions (monolithic) |
| **Multi-tool support** | Claude Code only | Cursor only | VS Code + JetBrains + CLI | 7+ IDEs |

---

## 7. Patterns That Translate Well to Skills Marketplace

### 7.1 High-Value Patterns

1. **Web-based browse + CLI install** (Continue.dev + Claude Code hybrid)
   - Users browse in a visual interface but install via CLI or app
   - Our desktop app already provides the visual layer

2. **Category/tag system** (Claude Code marketplace.json)
   - `category` and `tags`/`keywords` fields in metadata
   - Pre-defined categories: code-quality, testing, documentation, deployment, etc.

3. **Scope-based installation** (Claude Code)
   - User-level (personal), Project-level (shared), Local (private)
   - Maps well to skill-builder's workspace concept

4. **One-click install from browse UI** (Continue.dev)
   - Critical for desktop app UX — avoid requiring CLI knowledge
   - Preview skill details → Install → Immediately available

5. **Auto-update with version tracking** (Claude Code)
   - Semver in skill metadata
   - Background refresh at app startup
   - Notification when updates available

6. **Community popularity signals** (claude-plugins.dev, Cursor Directory)
   - Download/install counts
   - GitHub stars (for GitHub-sourced skills)
   - "Featured" or "Popular" sections

7. **Composable bundles** (Continue.dev assistants)
   - A "skill pack" = curated collection of related skills
   - E.g., "Python Development Pack" = python-review + pytest-generator + docstring-writer

### 7.2 Anti-Patterns to Avoid

1. **CLI-only discovery** (Claude Code official): Desktop app users need visual browse
2. **Copy-paste installation** (Cursor Directory): No versioning, no updates, no tracking
3. **No community signals** (Claude Code official): Makes it hard to find quality content
4. **Monolithic extensions** (Windsurf): Skills should be granular and composable
5. **Fragmented community hubs** (Cursor/Claude Code): Multiple competing directories confuse users — have one official source

### 7.3 Recommended Metadata Schema for Skills

Based on the patterns above, a skill marketplace entry should include:

```json
{
  "name": "python-code-reviewer",
  "version": "1.2.0",
  "description": "Reviews Python code for bugs, security issues, and PEP 8 compliance",
  "author": {
    "name": "Author Name",
    "url": "https://github.com/author"
  },
  "category": "code-quality",
  "tags": ["python", "review", "security", "linting"],
  "license": "MIT",
  "repository": "https://github.com/author/python-reviewer-skill",
  "homepage": "https://...",
  "agents": ["reviewer", "security-scanner"],
  "model_tier": "mid",
  "estimated_cost": "low",
  "stats": {
    "installs": 1234,
    "stars": 56,
    "last_updated": "2026-02-15"
  }
}
```

### 7.4 Recommended UX Flow

1. **Browse**: Grid/list view in desktop app with search, category filters, and sort (popular, recent, featured)
2. **Preview**: Click a skill to see description, agents involved, sample output, author info, install count
3. **Install**: One-click install with scope selection (workspace / global)
4. **Manage**: Installed skills tab with enable/disable, update, uninstall
5. **Publish**: "Share to Marketplace" button that packages and submits a skill from the builder

---

## 8. Key Takeaways

1. **Claude Code's marketplace infrastructure is mature** — marketplace.json + plugin.json is a well-designed registry format worth studying, but the UX is CLI-focused
2. **Visual browse is table stakes** — every successful marketplace (VS Code, Continue Hub, community directories) has a visual browse experience
3. **Community signals matter** — the community-built directories (claude-plugins.dev, cursor.directory) exist specifically because official marketplaces lack popularity signals and web-based browsing
4. **Skills ≈ Claude Code plugins** — our skills are structurally similar to Claude Code plugins (markdown-based, composable, directory-structured), so the marketplace.json pattern is directly applicable
5. **Team sharing is a differentiator** — Claude Code's scope system and Continue's team sync are features enterprise users expect
6. **Auto-update builds trust** — users are more likely to install if they know they'll get fixes automatically
7. **The gap we can fill**: A desktop app with visual browse + one-click install + community signals combines the best of all patterns and avoids the CLI-only limitation that drives users to community alternatives
