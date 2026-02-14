Example SKILL.md metadata block and pointer section:

```markdown
---
name: Terraform Module Patterns
description: Platform knowledge for structuring and managing Terraform modules, covering provider configuration, state management, and module composition patterns.
---

# Terraform Module Patterns

## Overview
This skill covers Terraform module design patterns for engineers building reusable infrastructure components. Key concepts: provider configuration, state management, module composition, and variable design.

## When to Use This Skill
- Engineer asks about structuring Terraform modules for reusability
- Questions about provider configuration or state backend patterns
- Designing module interfaces with variables and outputs
- Managing cross-module dependencies and state references

## Quick Reference
- Modules should expose a minimal variable interface with sensible defaults...
- State backends should use remote storage with locking enabled...

## Reference Files
- **references/provider-config.md** — Provider configuration patterns and version constraints. Read when setting up provider blocks or managing multi-provider scenarios.
- **references/state-management.md** — State backend patterns, locking strategies, and remote state data sources. Read when designing state architecture.
- **references/module-composition.md** — How to compose modules, handle dependencies, and design variable interfaces. Read when building reusable module libraries.
```
