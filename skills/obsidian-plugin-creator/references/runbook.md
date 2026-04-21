---
project: jira-bases
type: doc
doc_type: runbook
created: 2026-04-20
status: draft
tags:
  - project/jira-bases
  - doc
  - runbook
  - obsidian-plugin
---

# Building & debugging Obsidian plugins with Claude in the loop

Source: lessons learned building the `jira-bases` plugin — JIRA link insertion, bare-key indexing, hover preview, stub sync, and JB-2 auto-lookup. This document is the raw material for a future `obsidian-plugin-creator` skill.

---

## 1. Repo layout that works

```
<plugin-repo>/
  manifest.json           # id, name, version, minAppVersion, main: "main.js"
  package.json            # dev deps: obsidian, esbuild, typescript, vitest
  tsconfig.json           # strict, module: esnext, target: es2020
  esbuild.config.mjs      # bundle src/main.ts → main.js (CJS, external: obsidian)
  vitest.config.ts        # enables vitest; pure logic tests only
  src/
    main.ts               # Plugin subclass, lifecycle, command registration
    settings.ts           # PluginSettings + PluginSettingTab
    <feature>.ts          # one module per feature area
    <feature>.test.ts     # vitest tests for pure logic only
  main.js                 # built output; shipped alongside manifest.json
```

Keep `main.js` under source control if you want BRAT-style installs from GitHub. Otherwise gitignore it. Most published plugins commit the built artifact on release tags.

## 2. esbuild config (minimal)

```js
// esbuild.config.mjs
import esbuild from "esbuild";
const prod = process.argv[2] === "production";
await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@electron/remote", /^node:.*/],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  minify: prod,
  logLevel: "info",
});
```

`external: ["obsidian"]` is non-negotiable. `electron` and `@electron/remote` only matter if the plugin touches `safeStorage` or IPC.

## 3. The deploy loop

Claude + Obsidian CLI hot-reload cycle — this is the load-bearing workflow:

```bash
# 1. Build
node esbuild.config.mjs production

# 2. Copy artifacts into the vault
cp main.js manifest.json <vault>/.obsidian/plugins/<plugin-id>/

# 3. Reload without restarting Obsidian
obsidian plugin:reload id=<plugin-id>
```

Put the plugin folder in place once (manually enable it in Obsidian → Community plugins once), after that Claude can iterate fully headlessly. Do **not** delete the plugin folder between runs — it holds `data.json` (user settings) and you'll nuke real state.

Find the vault:

```bash
obsidian vault         # prints name<TAB>path for the active vault
obsidian vaults        # lists all known vaults
```

## 4. Debugging via obsidian-cli

Three commands do all the work:

| Command | Purpose |
| :--- | :--- |
| `obsidian dev:debug on` | Attach a DevTools debugger and start capturing console output into a buffer you can read. Persists across plugin reloads. |
| `obsidian dev:console` | Dump the console buffer. `obsidian dev:console clear` empties it. `level=log|warn|error|info|debug` filters. |
| `obsidian eval code='<js>'` | Run arbitrary JS in the renderer with access to `app`, `window`, every plugin instance. Returns the last expression's value. |

`obsidian help` at the top level lists everything. **Never** `obsidian <subcommand> --help` — it treats `--help` as note content and creates a junk `Untitled N.md`.

### Typical debugging session

```bash
# Turn on capture, reload plugin to get fresh console
obsidian dev:debug on
obsidian plugin:reload id=jira-bases
obsidian dev:console clear

# Simulate user typing at the end of the active note
obsidian eval code='(()=>{
  const ed = app.workspace.activeEditor?.editor;
  if (!ed) return "no editor";
  const p = { line: ed.lineCount()-1, ch: ed.getLine(ed.lineCount()-1).length };
  ed.replaceRange("\nSRE-2222 ", p, p);
  return "typed";
})()'

# Wait for the feature to fire, then read logs
sleep 4
obsidian dev:console
```

Peek at live plugin state:

```bash
obsidian eval code='(()=>{
  const p = app.plugins.plugins["jira-bases"];
  return {
    enabled: p.settings.autoLookupEnabled,
    scheduler: !!p.autoLookupScheduler,
    pending: p.autoLookupScheduler?.pending,
  };
})()'
```

This is how we diagnosed the `setTimeout` binding bug (§8) — we observed the scheduler existed but pending was always false, ran `bump()` manually, and got `Illegal invocation`.

## 5. Simulating user input

Claude cannot click or type into Obsidian directly, but `obsidian eval` plus the `app.workspace.activeEditor.editor` handle is enough for 95% of cases:

- **Type text at cursor**: `ed.replaceRange(text, ed.getCursor(), ed.getCursor())`
- **Append to end of doc**: compute `{line: ed.lineCount()-1, ch: <len of last line>}` and replaceRange there
- **Select**: `ed.setSelection(from, to)`
- **Run a command**: `app.commands.executeCommandById("jira-bases:insert-issue-link")`
- **Fire an event**: `app.workspace.trigger("file-open", file)`
- **Read frontmatter**: `app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(path))?.frontmatter`

For anything DOM-clicky (modals, settings tabs, hover popovers), open Obsidian normally — don't try to script clicks through eval.

## 6. Editor events that matter

| Event | Fires when |
| :--- | :--- |
| `workspace.on("editor-change", (editor, info) => ...)` | Any edit to a markdown editor |
| `workspace.on("file-open", (file) => ...)` | User opens a note |
| `workspace.on("active-leaf-change", (leaf) => ...)` | Focus moves to another pane |
| `vault.on("modify", (file) => ...)` | Any file write (including programmatic) |
| `vault.on("rename", (file, oldPath) => ...)` | File moved/renamed |
| `vault.on("delete", (file) => ...)` | File deleted |
| `metadataCache.on("changed", (file) => ...)` | Obsidian finished parsing a note's metadata |

The full event catalog is in `node_modules/obsidian/obsidian.d.ts` — grep for `'<event-name>'` to confirm signatures.

## 7. Plugin lifecycle shape

```ts
export default class MyPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new MySettingTab(this.app, this));

    this.addCommand({
      id: "do-thing",
      name: "My plugin: do the thing",
      editorCallback: (editor) => this.doThing(editor),
    });

    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => this.onEdit(editor)),
    );
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

- **Always** use `registerEvent` for `workspace.on` / `vault.on` subscriptions. Raw `.on` without registration leaks on reload.
- `addCommand` supports `callback`, `editorCallback`, `checkCallback`, `editorCheckCallback`. Pick the narrowest.
- `loadData`/`saveData` persist JSON to `.obsidian/plugins/<id>/data.json`.

## 8. The `Illegal invocation` trap (biggest gotcha)

Electron's renderer rejects calls to `window.setTimeout` / `window.clearTimeout` that arrive without the native `this` binding. This code **throws silently** inside an async-ish callback:

```ts
// ❌ Broken: deps.setTimeout is detached from window
const deps = { setTimeout, clearTimeout };
deps.setTimeout(fn, 1000);   // Illegal invocation
```

```ts
// ✅ Works: wrap to preserve binding
const deps = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};
```

This extends to any DOM API called via an object property: `requestAnimationFrame`, `queueMicrotask`, `fetch` (when extracted off `window`), `addEventListener`.

The error is hostile because it often swallows into promise rejections that nothing awaits, leaving the feature silently dead. Symptom: the handler fires (event logs), timer is "set" (property exists), but the timeout callback never runs.

## 9. Vault I/O — use the right adapter

| Need | API |
| :--- | :--- |
| Read a note as text | `app.vault.read(tFile)` |
| Modify a note | `app.vault.modify(tFile, content)` |
| Create a note | `app.vault.create(path, content)` |
| Create a folder | `app.vault.createFolder(path)` (ignore "already exists") |
| Delete (trash) | `app.vault.delete(tFile)` (goes to Obsidian trash, not permanent) |
| Check existence | `app.vault.getAbstractFileByPath(path) instanceof TFile` |
| Update frontmatter safely | `app.fileManager.processFrontMatter(tFile, fm => {...})` |
| Rename/move | `app.fileManager.renameFile(tFile, newPath)` (updates backlinks) |
| List markdown notes | `app.vault.getMarkdownFiles()` |

Prefer `fileManager.processFrontMatter` over parsing frontmatter yourself — it preserves formatting, comments, and trailing newlines. Prefer `fileManager.renameFile` over `vault.rename` because it rewrites wikilinks across the vault.

## 10. Secrets (safeStorage)

Never store PATs/API keys in `data.json` as plaintext. Use Electron's `safeStorage`:

```ts
function getSafeStorage() {
  const electron = require("electron");
  const ss = electron?.remote?.safeStorage
    ?? require("@electron/remote").safeStorage;
  if (!ss) throw new Error("safeStorage unavailable in this Obsidian build");
  return ss;
}

const encrypted = ss.encryptString(token).toString("base64");
// store `encrypted` in data.json
const decrypted = ss.decryptString(Buffer.from(encrypted, "base64"));
```

Keep the encrypted blob in `data.json` keyed by the API base URL so one vault can hold credentials for multiple hosts. This is what jira-bases does.

## 11. Network requests

Use `requestUrl` from `obsidian` for any HTTP. It bypasses CORS (renderer-side fetch hits CORS for cross-origin), returns text + parsed JSON, and does not throw on non-2xx when `throw: false` is passed:

```ts
import { requestUrl } from "obsidian";
const r = await requestUrl({
  url,
  headers: { Authorization: `Bearer ${token}` },
  method: "GET",
  throw: false,
});
if (r.status >= 400) { /* handle */ }
const data = r.json;
```

Wrap it behind a small adapter interface so the network layer is testable without Obsidian present (see `src/jira-client.ts`).

## 12. Testability — draw the line

Obsidian's types are hostile to testing (Editor, TFile, Vault are runtime classes). Pattern that worked every time:

- **Pure modules** (`jira-key.ts`, `template.ts`, `auto-lookup.ts`, `ref-scanner.ts`, `issue-suggest-helpers.ts`): no Obsidian imports, export pure functions, vitest covers them.
- **Adapter interfaces** (`IndexerDeps`, `VaultAdapter`, `HttpRequest`): narrow structural types the pure core depends on. Main.ts constructs a concrete impl that calls `app.vault.*`, tests pass a fake.
- **Thin Obsidian-aware glue** (`main.ts`, modals, setting tabs): not unit-tested. Exercised via the deploy loop + `obsidian eval`.

Target: 100% of non-trivial logic is in pure modules. The glue should be flat enough that a human can read it and see correctness.

## 13. Settings UX patterns

Tying a dropdown and a text field together (e.g., "mode" picker that updates a template string in place, and a template editor that flips the mode to Custom):

```ts
// Capture Setting instances' setValue callbacks in local vars so
// each control can update the other without a full re-render.
let templateSetValue: ((v: string) => void) | null = null;
let modeSetValue: ((v: string) => void) | null = null;

new Setting(containerEl)
  .setName("Mode")
  .addDropdown((d) => {
    modeSetValue = (v) => d.setValue(v);
    d.setValue(settings.mode).onChange(async (v) => {
      settings.mode = v as Mode;
      if (v === "minimal") templateSetValue?.(MINIMAL_TEMPLATE);
      await plugin.saveSettings();
    });
  });

new Setting(containerEl)
  .setName("Custom template")
  .addText((t) => {
    templateSetValue = (v) => t.setValue(v);
    t.setValue(settings.template).onChange(async (v) => {
      settings.template = v;
      if (settings.mode !== "custom") {
        settings.mode = "custom";
        modeSetValue?.("custom");
      }
      await plugin.saveSettings();
    });
  });
```

Don't call `this.display()` to re-render — it loses focus and selection and makes the UI feel jumpy.

## 14. Hover preview / markdown rendering

Obsidian ships a hover preview system. Register a source:

```ts
this.registerHoverLinkSource("jira-bases", {
  display: "JIRA",
  defaultMod: true,
});
```

And listen for hover events (`workspace.on("hover-link", ctx => ...)`), then call `app.workspace.trigger("link-hover", ...)` with an HTML popover. `renderMarkdown` / `MarkdownRenderer.render` turns markdown strings into Obsidian-styled HTML inside your popover.

## 15. Link/URL escaping for generated markdown

Generated `[text](url)` links have three footguns:

- `[` / `]` / `\` / `<` / `>` in the anchor text can break link parsing or get eaten as HTML — backslash-escape them.
- `(` / `)` / spaces in URLs break link parsing — percent-encode to `%28` / `%29` / `%20`.
- Escape backslashes first when building a multi-step escaper so you don't double-escape.

See `src/template.ts` for the reference implementation. Apply these every time the plugin writes user-visible markdown.

## 16. CSS + theming

Plugins ship an optional `styles.css` adjacent to `main.js`. Obsidian loads it automatically. Use CSS variables from the active theme (`--text-normal`, `--background-primary`, `--interactive-accent`) — never hardcode colors, or your plugin looks broken in half of users' themes.

## 17. Useful app globals during eval debugging

| Expression | What it gives |
| :--- | :--- |
| `app` | The Obsidian `App` instance |
| `app.plugins.plugins["<id>"]` | Your plugin instance (settings, methods, private state) |
| `app.plugins.enabledPlugins` | Set of enabled plugin IDs |
| `app.workspace.activeEditor.editor` | Current CodeMirror `Editor` |
| `app.workspace.getActiveFile()` | Current `TFile` |
| `app.vault.getMarkdownFiles()` | All markdown TFiles |
| `app.metadataCache.getFileCache(tFile)` | Parsed frontmatter + headings + links |
| `app.commands.executeCommandById(id)` | Run any command |
| `app.commands.listCommands()` | Browse every registered command |

## 18. Workflow for a new feature (the loop)

1. **Scope + plan** in issue/task notes. Pure-core-first: identify what can live in a standalone module.
2. **Write the pure module + vitest tests.** No Obsidian imports. Prove correctness in isolation.
3. **Wire into main.ts** behind the smallest possible glue — event handler → pure function → Vault/Editor API.
4. **Build + copy + reload**:
   ```bash
   node esbuild.config.mjs production \
     && cp main.js manifest.json <vault>/.obsidian/plugins/<id>/ \
     && obsidian plugin:reload id=<id>
   ```
5. **Simulate usage** via `obsidian eval` — inject text, run command, trigger event.
6. **Read logs** via `obsidian dev:console`. If silent, add `console.log` at each checkpoint and repeat.
7. **Inspect live state** via `obsidian eval code='app.plugins.plugins["<id>"]. …'` when the log trail runs out.
8. **Only when the feature works in the live vault**, remove diagnostic logs and commit.

## 19. Known CLI gotchas (from the op skill)

- `obsidian search query="prefix: FOO"` — fails. The CLI parses `<word>:` as a search operator. Use filesystem scans for frontmatter lookups.
- `obsidian search` can crash wholesale with `ENOENT` on a stale index entry. Restart Obsidian or reindex. Don't depend on `search` for correctness.
- `obsidian move path=<src> to=<dst>` — `to=`, not `dest=`.
- `obsidian create` forces `.md`. Use the filesystem `Write` tool for `.base`, `.canvas`, `.css`.
- Never `obsidian <sub> --help`. Use `obsidian help` (top level) or reference docs.

## 19b. Text-transform features must skip the YAML frontmatter

Any feature that scans a markdown file and rewrites matched substrings (auto-linking, auto-tagging, inline replacement) has to **skip the leading `---` YAML block**. Feedback loops form easily:

1. Indexer writes `jira_issues: [KEY-1, KEY-2]` to frontmatter.
2. User edits the body.
3. Auto-lookup scans the whole file, finds `KEY-1` / `KEY-2` *inside the frontmatter list*, rewrites them to `[KEY-1](url)`.
4. Frontmatter is now invalid YAML. `metadataCache` returns no frontmatter for the file.
5. Next indexer pass reads nothing → tries to "fix" the frontmatter → the loop continues.

Detect the fence with a simple line walk: if line 0 is `---`, find the next `---` line; scan only lines after it. `frontmatterEndLine` in `src/auto-lookup.ts` is the reference impl.

The same trap applies to: code fences (``` ... ```), inline code `` `...` ``, link URLs `[text](...)`, embedded LaTeX `$...$`. For a first pass, skipping frontmatter + not touching anything already inside `[](...)` / `[[...]]` covers 95% of cases without a full markdown parser.

## 20. Anti-patterns observed

- **`setInterval` in `onload`** without `registerInterval` — leaks on reload.
- **Event handlers bound directly to class methods** without `.bind(this)` or arrow wrappers — `this` gets lost.
- **Accumulating state in module scope** instead of on the plugin instance — survives reload, causes ghost bugs.
- **Async work after `onunload` starts** — the plugin is gone, writes to its state are void. Guard with a `disposed` flag.
- **Direct `fetch()` against third-party APIs** — CORS. Use `requestUrl`.
- **Parsing frontmatter by regex** — use `processFrontMatter`.
- **Writing secrets to `data.json`** — use `safeStorage`.
- **Re-rendering entire settings tab on every change** — use captured setValue callbacks.
- **Trusting `setTimeout` extracted from an object** — bind to window (see §8).

## 21. Shape of the future `obsidian-plugin-creator` skill

Sketch of the skill's sections, in the order a plugin-author needs them:

1. **Scaffold** — repo layout, manifest, esbuild, tsconfig, test harness; takes `<id> <name> <description>` as args.
2. **Deploy loop** — symlink or copy path, how to enable the plugin once, reload command, how to find the vault.
3. **Command/event registration** — addCommand shapes, registerEvent patterns, editor hooks.
4. **Settings tab** — PluginSettings + coupled-controls pattern.
5. **Vault I/O** — the adapter table in §9.
6. **Network** — requestUrl + adapter-testable client.
7. **Secrets** — safeStorage.
8. **Pure-core testing** — the adapter interface pattern.
9. **Debugging with obsidian-cli** — eval, dev:console, simulated input recipes.
10. **Gotchas** — §8, §15, §19, §20 rolled into a "check before you ship" list.

Each section should come with a working minimal example snippet and a "copy this into main.ts" block.

---

**Closing note for future-Claude**: the single highest-leverage insight from JB-2 was that `obsidian dev:debug on` + `obsidian eval` + `obsidian dev:console` turns the plugin into a REPL-able surface. You are not flying blind. Use it before you guess.
