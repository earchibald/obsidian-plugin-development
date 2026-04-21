# obsidian-plugin-development

A Claude Code plugin providing the **obsidian-plugin-creator** skill: scaffold, build, and debug Obsidian plugins end-to-end through the `obsidian-cli` deploy + debug loop.

## What's inside

- `skills/obsidian-plugin-creator/SKILL.md` — the skill itself. 12 sections covering prerequisites, scaffolding, the build→copy→reload deploy loop, command/event registration, settings UI patterns, vault I/O, `requestUrl` networking, `safeStorage` secrets, pure-core testing with adapters, debugging via `obsidian dev:debug on` + `dev:console` + `eval`, and a gotchas preflight.
- `skills/obsidian-plugin-creator/references/scaffold/` — working `manifest.json`, `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `main.ts`, `settings.ts`, `.gitignore` templates.
- `skills/obsidian-plugin-creator/references/` — `runbook.md` (source narrative), `settings-coupled-controls.ts`, `adapter-pattern.ts`.
- `docs/superpowers/runbooks/2026-04-20-obsidian-plugin-development.md` — the original runbook this skill was distilled from.

## Install (Claude Code marketplace)

```
/plugin marketplace add earchibald/obsidian-plugin-development
/plugin install obsidian-plugin-creator@obsidian-plugin-development
```

## Use

Invoke the skill when starting any Obsidian plugin work:

> "Scaffold an Obsidian plugin that …"
> "My plugin's `editor-change` handler isn't firing."
> "How do I reload my plugin without restarting Obsidian?"

The skill triggers automatically on requests that touch `.obsidian/plugins/<id>/`, `manifest.json`, or `main.js`.

## License

MIT.
