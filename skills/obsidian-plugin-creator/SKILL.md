---
name: obsidian-plugin-creator
description: Use when building, debugging, or iterating on an Obsidian plugin (TypeScript, `manifest.json` + `main.js`). Covers scaffolding a repo, the build/copy/reload deploy loop, registering commands and events, settings UI, vault I/O, `requestUrl` networking, `safeStorage` secrets, pure-core testing, and the `obsidian-cli` debug loop (`dev:debug on`, `dev:console`, `eval`). Invoke on requests like "scaffold an Obsidian plugin", "my plugin's event handler isn't firing", "how do I reload my plugin without restarting Obsidian", or any task that touches `.obsidian/plugins/<id>/`.
---

# Obsidian plugin creator

Distilled from building `jira-bases` (JIRA link insertion, hover preview, auto-lookup, stub sync). Everything below has been exercised end-to-end through the `obsidian-cli` deploy+debug loop.

The canonical long-form narrative lives in `references/runbook.md` — read it when this skill's summary is not enough.

---

## 0. Prerequisites

Before scaffolding anything, confirm:

- `node` and `npm` are on PATH.
- `obsidian` CLI is installed and the target vault is the **active** one. Check with:
  ```bash
  obsidian vault   # prints name<TAB>path for the active vault
  ```
- The vault has **Community plugins enabled** (`Settings → Community plugins → Turn on`). This is a one-time manual step; the CLI cannot flip it.

Cache the vault path at the start of the session. All `<vault>` placeholders refer to it.

---

## 1. Scaffold

Args: `<id> <name> <description>`.

- **id**: lowercase-with-hyphens, must match `manifest.json.id` AND the folder name under `.obsidian/plugins/`. Never change it — settings are keyed on it.
- **name**: human-readable, shown in Settings.
- **description**: one sentence for the marketplace/settings row.

Target repo layout:

```
<plugin-repo>/
  manifest.json           # id, name, version, minAppVersion, main: "main.js"
  package.json            # dev deps: obsidian, esbuild, typescript, vitest
  tsconfig.json           # strict, module: esnext, target: es2020
  esbuild.config.mjs      # src/main.ts → main.js (CJS, external: obsidian)
  vitest.config.ts
  src/
    main.ts               # Plugin subclass, lifecycle, command registration
    settings.ts           # PluginSettings + PluginSettingTab
    <feature>.ts          # pure modules, no obsidian imports where possible
    <feature>.test.ts
  main.js                 # built output; ship alongside manifest.json
```

Copy-paste templates are in `references/scaffold/` — see §11 for the exact file list. Substitute `<id>`, `<name>`, `<description>` before writing.

Commit `main.js` if you want BRAT-style GitHub installs; otherwise gitignore it and tag release builds.

**Rename every placeholder** the sample ships with: `MyPlugin`, `MyPluginSettings`, `SampleSettingTab`, etc. Reviewers flag these on submission. Organize `src/` into subfolders once the plugin outgrows a handful of files.

---

## 2. Deploy loop (build → copy → reload)

The load-bearing workflow. Once the plugin folder exists in the vault and is enabled in Settings, Claude iterates headlessly:

```bash
PLUGIN_ID=<id>
VAULT=$(obsidian vault | awk -F'\t' '/^path\t/{print $2}')
DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"

mkdir -p "$DEST"
node esbuild.config.mjs production
cp main.js manifest.json "$DEST/"
[ -f styles.css ] && cp styles.css "$DEST/"
obsidian plugin:reload id="$PLUGIN_ID"
```

**Do not** `rm -rf` the plugin folder between runs — `data.json` lives there and holds user settings (incl. encrypted secrets).

First-time only: after the first copy, open Obsidian → Settings → Community plugins and toggle the plugin on. The CLI has no "install & enable" verb.

---

## 3. Commands and events

### addCommand

```ts
this.addCommand({
  id: "do-thing",                         // plugin-id prefix is added automatically
  name: "My plugin: do the thing",
  editorCallback: (editor) => this.doThing(editor),
});
```

Pick the narrowest callback shape (official guidance):

- `callback` — runs unconditionally.
- `checkCallback` — only runs under certain conditions; return `true` from the `checking === true` branch to show it in the palette.
- `editorCallback` / `editorCheckCallback` — requires an active Markdown editor; Obsidian gates availability for you.

**Do not set a default hotkey** (`hotkeys: [...]`). Defaults collide across OSes and stomp user-configured bindings. Let the user assign one.

### Events — **always** use `registerEvent`

```ts
this.registerEvent(
  this.app.workspace.on("editor-change", (editor) => this.onEdit(editor)),
);
```

Raw `.on(...)` without `registerEvent` leaks on plugin reload. Same rule for `vault.on`, `metadataCache.on`, `workspace.on`.

For timers: `registerInterval(window.setInterval(...))`. For DOM listeners on elements you created: `registerDomEvent(el, "click", ...)`.

Editor-event catalog — the commonly useful ones:

| Event | Fires when |
| :--- | :--- |
| `workspace.on("editor-change", (editor, info) => ...)` | Any edit to a markdown editor |
| `workspace.on("file-open", (file) => ...)` | User opens a note |
| `workspace.on("active-leaf-change", (leaf) => ...)` | Focus moves between panes |
| `vault.on("modify", (file) => ...)` | File write (incl. programmatic) |
| `vault.on("rename", (file, oldPath) => ...)` | File moved/renamed |
| `vault.on("delete", (file) => ...)` | File deleted |
| `metadataCache.on("changed", (file) => ...)` | Frontmatter/headings re-parsed |

Full catalog: `node_modules/obsidian/obsidian.d.ts` — grep for `'<event>'`.

---

## 4. Settings tab

`src/settings.ts` holds `interface PluginSettings`, `DEFAULT_SETTINGS`, and the `PluginSettingTab` subclass.

```ts
async loadSettings() {
  this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
}
async saveSettings() { await this.saveData(this.settings); }
```

Persistence: `loadData`/`saveData` read/write `.obsidian/plugins/<id>/data.json` as JSON.

**Coupled controls** (one control updates another — e.g. a Mode dropdown and a Template text field): capture each Setting's `setValue` in a local variable so you can update peers without re-rendering the whole tab. See `references/settings-coupled-controls.ts`. **Never call `this.display()` on change** — it loses focus, selection, and scroll position.

---

## 5. Vault I/O

Pick the right API — this order is enforced in plugin review:

| Need | API |
| :--- | :--- |
| Edit the **active** note | `editor.replaceRange/setValue/...` via the `Editor` API |
| Modify a **background** note atomically | `app.vault.process(tFile, data => newData)` |
| Read a note as text | `app.vault.read(tFile)` / `cachedRead(tFile)` for bulk scans |
| Create a note | `app.vault.create(path, content)` |
| Create a folder | `app.vault.createFolder(path)` (ignore "already exists") |
| Delete (trash) | `app.vault.delete(tFile)` (Obsidian trash, not permanent) |
| Look up by path (file) | `app.vault.getFileByPath(path)` |
| Look up by path (folder) | `app.vault.getFolderByPath(path)` |
| Look up by path (unknown) | `app.vault.getAbstractFileByPath(path)` + `instanceof TFile`/`TFolder` |
| Update frontmatter safely | `app.fileManager.processFrontMatter(tFile, fm => { ... })` |
| Rename/move (updates links) | `app.fileManager.renameFile(tFile, newPath)` |
| List markdown notes | `app.vault.getMarkdownFiles()` |
| Normalize a user-supplied path | `normalizePath(path)` from `obsidian` |

Rules of thumb:

- **Editor > `Vault.modify` > `Vault.process`.** `Vault.modify` on the active note loses cursor/selection/fold state; the Editor API preserves it. `Vault.process` is atomic — use it for background writes so you don't race other plugins editing the same file.
- **Prefer the Vault API over the Adapter API** (`app.vault.adapter.*`). The Vault API has a read cache and serializes writes; the Adapter API is raw FS and bypasses both.
- **Never iterate `getFiles()` / `getMarkdownFiles()` to find a path.** Use `getFileByPath` / `getFolderByPath` — O(1) vs O(n).
- **Always `normalizePath`** anything that came from user input or that you stitched together yourself. It collapses `\`/`/`, strips leading/trailing slashes, replaces NBSPs, and runs Unicode NFC.
- Prefer `fileManager.processFrontMatter` over parsing YAML yourself — it preserves formatting and runs atomically. Prefer `fileManager.renameFile` over `vault.rename` so wikilinks across the vault get rewritten.

---

## 6. Network

Use `requestUrl` from `obsidian` for **all** HTTP. Raw `fetch()` hits CORS for cross-origin.

```ts
import { requestUrl } from "obsidian";
const r = await requestUrl({
  url,
  method: "GET",
  headers: { Authorization: `Bearer ${token}` },
  throw: false,                 // let the caller branch on status
});
if (r.status >= 400) { /* handle */ }
const data = r.json;            // already parsed
```

Wrap it behind a narrow adapter interface (`HttpRequest`) so the network layer is testable without Obsidian present — see §8.

---

## 6.5 DOM construction (safety)

`innerHTML`, `outerHTML`, and `insertAdjacentHTML` are **banned** by the plugin guidelines. User-supplied text concatenated into an HTML string is an XSS vector — a note title containing `<script>` is enough. Use Obsidian's helpers, which escape text for you:

```ts
// ❌ Banned
container.innerHTML = `<div class="hit"><b>${name}</b></div>`;

// ✅ Use DOM helpers
const hit = container.createDiv({ cls: "hit" });
hit.createEl("b", { text: name });

// Clear contents
container.empty();
```

`createEl`, `createDiv`, `createSpan`, and `el.empty()` are attached to every `HTMLElement` inside Obsidian. Pass `{ text, cls, attr, href }` in the options object. For anything richer, use `document.createElement` + `appendChild`.

---

## 6.6 Workspace, views, and the Editor

- **Active view**: `app.workspace.getActiveViewOfType(MarkdownView)` — returns `null` if the active view is a different type. Avoid `workspace.activeLeaf` (the field can lag and is slated for removal).
- **Active editor**: `app.workspace.activeEditor?.editor`. Works for Markdown editors across main/sidebar/popover surfaces.
- **Custom views** — register the factory, don't store the instance:
  ```ts
  // ❌ Leaks the view across plugin reloads
  this.registerView(MY_VIEW, () => (this.view = new MyView()));

  // ✅ Look it up when you need it
  this.registerView(MY_VIEW, () => new MyView());
  for (const leaf of this.app.workspace.getLeavesOfType(MY_VIEW)) {
    const v = leaf.view;
    if (v instanceof MyView) { /* ... */ }
  }
  ```
- **Don't `detach()` leaves in `onunload`.** When the user updates your plugin, Obsidian re-opens leaves in their original position; detaching throws away the user's layout.
- **Editor extensions** — to hot-swap a registered extension, mutate the same array reference and call `app.workspace.updateOptions()`:
  ```ts
  this.editorExt.length = 0;
  this.editorExt.push(this.buildExtension());
  this.app.workspace.updateOptions();
  ```
  Creating a new array breaks the registration; `updateOptions` is what flushes the change to every open editor.

---

## 6.7 UI text and settings layout

Every UI string a user sees is reviewed on submission. The rules:

- **Sentence case everywhere.** "Template folder location", not "Template Folder Location". Only the first word and proper nouns capitalize.
- **No top-level heading** in the settings tab — no "General", no "Settings", no plugin name. The tab itself is already labelled.
- **Don't put "settings" inside section headings.** "Advanced", not "Advanced settings". "Templates", not "Settings for templates".
- **Use `setHeading`**, not raw `<h1>`/`<h2>`:
  ```ts
  new Setting(containerEl).setName("Sync").setHeading();
  ```
- Use the `Notice` class for transient feedback; no custom toast widgets.
- Group related settings; keep a short "general" block at the top without a heading when you have multiple sections.

---

## 7. Secrets (safeStorage)

Never store PATs / API keys in `data.json` as plaintext. Use Electron's `safeStorage`:

```ts
function getSafeStorage() {
  const electron = require("electron");
  const ss = electron?.remote?.safeStorage
    ?? require("@electron/remote").safeStorage;
  if (!ss) throw new Error("safeStorage unavailable in this Obsidian build");
  return ss;
}

const ss = getSafeStorage();
const encrypted = ss.encryptString(token).toString("base64");    // store this
const decrypted = ss.decryptString(Buffer.from(encrypted, "base64"));
```

Key the encrypted blob in `data.json` by API base URL so one vault can hold credentials for multiple hosts.

---

## 8. Pure-core testing

Obsidian's runtime classes (`Editor`, `TFile`, `Vault`) are hostile to unit testing. The pattern that works:

- **Pure modules** (no `obsidian` imports): all non-trivial logic — parsers, scanners, templaters, schedulers. Covered by vitest.
- **Adapter interfaces** (`VaultAdapter`, `HttpRequest`, `IndexerDeps`): narrow structural types the pure core depends on. `main.ts` constructs a concrete impl backed by `app.vault.*`; tests pass a fake.
- **Thin Obsidian-aware glue** (`main.ts`, modals, setting tabs): not unit-tested. Exercised via the deploy loop + `obsidian eval` (§9).

Target: 100% of non-trivial logic in pure modules. The glue should be flat enough to read and see correct.

See `references/adapter-pattern.ts` for a worked example.

---

## 9. Debugging with obsidian-cli

Three commands do all the work:

| Command | Purpose |
| :--- | :--- |
| `obsidian dev:debug on` | Attach DevTools debugger + start capturing console into a buffer. Persists across plugin reloads. |
| `obsidian dev:console` | Dump the buffer. `obsidian dev:console clear` empties it. `level=log|warn|error|info|debug` filters. |
| `obsidian eval code='<js>'` | Run arbitrary JS in the renderer with access to `app`, `window`, every plugin instance. Returns last expression. |

`obsidian help` lists everything. **Never** `obsidian <subcommand> --help` — the CLI treats `--help` as note content and creates a junk `Untitled N.md`.

### Standard debug cycle

```bash
obsidian dev:debug on
obsidian plugin:reload id=<id>
obsidian dev:console clear

# Simulate typing at the end of the active note
obsidian eval code='(()=>{
  const ed = app.workspace.activeEditor?.editor;
  if (!ed) return "no editor";
  const p = { line: ed.lineCount()-1, ch: ed.getLine(ed.lineCount()-1).length };
  ed.replaceRange("\nSRE-2222 ", p, p);
  return "typed";
})()'

sleep 4
obsidian dev:console
```

### Live-state inspection

```bash
obsidian eval code='(()=>{
  const p = app.plugins.plugins["<id>"];
  return { enabled: p.settings.autoLookupEnabled, pending: p.scheduler?.pending };
})()'
```

### Simulating user input (no click/type possible, but eval covers ~95%)

- **Type at cursor**: `ed.replaceRange(text, ed.getCursor(), ed.getCursor())`
- **Append to end**: compute `{line: ed.lineCount()-1, ch: <len>}` and `replaceRange` there
- **Select**: `ed.setSelection(from, to)`
- **Run command**: `app.commands.executeCommandById("<id>:<command-id>")`
- **Fire event**: `app.workspace.trigger("file-open", file)`
- **Read frontmatter**: `app.metadataCache.getFileCache(tFile)?.frontmatter`

For DOM-clicky flows (modals, settings tabs, hover popovers), open Obsidian manually — don't script clicks through eval.

### Useful globals

| Expression | What it gives |
| :--- | :--- |
| `app.plugins.plugins["<id>"]` | Your plugin instance (settings, methods, private state) |
| `app.plugins.enabledPlugins` | Set of enabled plugin ids |
| `app.workspace.activeEditor.editor` | Current CodeMirror `Editor` |
| `app.workspace.getActiveFile()` | Current `TFile` |
| `app.metadataCache.getFileCache(tFile)` | Parsed frontmatter + headings + links |
| `app.commands.listCommands()` | Every registered command |
| `app.commands.executeCommandById(id)` | Run any command |

---

## 10. Gotchas — check before you ship

Every item here cost real time on `jira-bases`. Treat it as a preflight.

### 10.1 `Illegal invocation` on `setTimeout`/`setInterval`

Electron's renderer rejects `window.setTimeout` calls that arrive without the native `this`:

```ts
// ❌ Silently dies inside async paths
const deps = { setTimeout, clearTimeout };
deps.setTimeout(fn, 1000);   // "Illegal invocation"

// ✅ Wrap to preserve the binding
const deps = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};
```

Same trap for `requestAnimationFrame`, `queueMicrotask`, `fetch`, `addEventListener` when extracted onto an object. Symptom: handler logs, timer property exists, callback never runs. Error often swallows into an unawaited promise rejection.

### 10.2 Link/URL escaping in generated markdown

When the plugin writes `[text](url)` into a note:

- Backslash-escape `[`, `]`, `\`, `<`, `>` inside the anchor text.
- Percent-encode `(`, `)`, and spaces in URLs to `%28`, `%29`, `%20`.
- Escape backslashes **first** so you don't double-escape.

### 10.3 Text-transform features must skip the YAML frontmatter

Any feature that scans a markdown file and rewrites matched substrings (auto-linking, auto-tagging, inline replacement) must skip the leading `---` block, or you'll corrupt frontmatter and form a feedback loop:

1. Indexer writes `jira_issues: [KEY-1]` to frontmatter.
2. Auto-link scans the whole file, rewrites `KEY-1` inside frontmatter to `[KEY-1](url)`.
3. YAML is now invalid. `metadataCache` returns null frontmatter.
4. Indexer re-writes the list. Loop.

Also skip: code fences `` ``` ... ``` ``, inline code `` `...` ``, existing link URLs, `[[wikilinks]]`, and `[text](url)` payloads. A simple frontmatter-fence walker + "don't touch text already inside `[](...)`/`[[...]]`" catches 95% of cases without a full markdown parser.

### 10.4 obsidian-cli footguns

- `obsidian search query="prefix: FOO"` — fails. The CLI parses `<word>:` as a search operator. Use filesystem scans for frontmatter lookups.
- `obsidian search` can crash with `ENOENT` on a stale index entry. Restart Obsidian or reindex. Don't rely on it for correctness.
- `obsidian move path=<src> to=<dst>` — `to=`, not `dest=`.
- `obsidian create` forces `.md`. For `.base` / `.canvas` / `.css`, write via the filesystem.
- There is **no** `property:add` / `property:append`. To append to a list property: read → append in memory → `property:set name=... value='[...]' type=list ...`.
- Never `obsidian <sub> --help` — writes an `Untitled N.md`. Use `obsidian help` at top level only.

### 10.5 Mobile compatibility

If `manifest.json` has `"isDesktopOnly": false`, your plugin will load on iOS and Android — where **Node and Electron APIs do not exist**. Guard any `require("fs")`, `require("path")`, `require("electron")`, `child_process`, etc. behind `Platform.isDesktop` from `obsidian`, or bail out early on mobile:

```ts
import { Platform } from "obsidian";
if (Platform.isDesktopApp) {
  const fs = require("fs");
  // ...
}
```

Regex **lookbehind** (`(?<=...)`) still crashes on older iOS WebViews. If you need to match "X preceded by Y", consume Y and back off instead of using lookbehind. Lookahead is fine everywhere.

### 10.6 Styling

No hardcoded `element.style.*` for colors, sizes, or backgrounds — themes and snippets can't override it. Ship a `styles.css` alongside `manifest.json` / `main.js` and use Obsidian's CSS variables for anything that should track the theme:

```css
.my-plugin-warning {
  color: var(--text-normal);
  background-color: var(--background-modifier-error);
  border: 1px solid var(--interactive-accent);
}
```

Common variables: `--text-normal`, `--text-muted`, `--text-faint`, `--background-primary`, `--background-secondary`, `--background-modifier-{border,error,success,hover}`, `--interactive-accent`, `--interactive-hover`. Full list in the Obsidian CSS variables reference.

### 10.7 Console noise

Default Obsidian only surfaces `console.error` to users. Don't ship `console.log` / `console.debug` / `console.info` for normal operation — strip diagnostic logs before release or gate them behind a `settings.debug` flag. `console.error` is fine for actual errors.

### 10.8 General anti-patterns

- **`setInterval` in `onload`** without `registerInterval` — leaks on reload.
- **Class methods passed as handlers** without `.bind(this)` or an arrow wrapper — `this` is lost.
- **Module-scope state** instead of plugin-instance fields — survives reload, causes ghost bugs.
- **Using the global `app` / `window.app`** — always use `this.app` from your `Plugin` subclass. The global is a debugging convenience and may be removed.
- **Async work after `onunload` starts** — plugin is gone, writes are void. Guard with a `disposed` flag set in `onunload`.
- **Raw `fetch()` against third-party APIs** — CORS. Use `requestUrl`.
- **Regex over frontmatter** — use `processFrontMatter`.
- **Plaintext secrets in `data.json`** — use `safeStorage`.
- **Re-rendering the whole settings tab on change** — use captured `setValue` callbacks.
- **Hardcoded theme colors** — use CSS variables (`--text-normal`, `--background-primary`, `--interactive-accent`) from `styles.css`.

---

## 10.9 Community directory compliance

If the plugin will ship to the Obsidian Community Plugins directory, the [Developer policies](https://docs.obsidian.md/Developer+policies) are gating — violations block submission or trigger removal.

**Hard prohibitions** (never ship these, even behind a setting):

- Code obfuscation to hide behavior.
- **Dynamic ads** loaded over the network.
- **Static ads outside** the plugin's own UI surface (can't poke the editor, status bar, or other plugins' surfaces).
- **Client-side telemetry** of any kind.
- A **self-update mechanism** — updates go through Obsidian's community plugin updater.

**Disclosures required in the README** (allowed if clearly stated):

- Paywalled features / account-required features.
- Network use — list every remote service and why.
- Reading/writing files outside the vault.
- Static ads inside the plugin's own UI.
- Server-side telemetry — must link to a privacy policy.
- Closed-source builds — case-by-case.

**Repo hygiene**:

- Ship a `LICENSE` file. State the license in the README.
- Comply with upstream licenses of anything you vendor; attribute where required.
- Don't imply the plugin is first-party ("Obsidian X", "Official Obsidian ...") — trademark.
- Description ≤ 250 chars, no "This is a plugin for Obsidian that ..." boilerplate.
- Keep `manifest.json` (`version`, `minAppVersion`) and `versions.json` (historical `minAppVersion` → plugin-version map) accurate. Obsidian uses `versions.json` to decide whether a user on an older app can install a given plugin version.

---

## 11. References in this skill

Under `references/`:

- `runbook.md` — the full narrative this skill distills from.
- `scaffold/manifest.json.tmpl` — `manifest.json` with `<ID>` / `<NAME>` / `<DESCRIPTION>` placeholders.
- `scaffold/package.json.tmpl` — dev-deps + `build`/`dev`/`test` scripts.
- `scaffold/tsconfig.json` — strict, esnext, es2020.
- `scaffold/esbuild.config.mjs` — CJS bundle, `external: obsidian`.
- `scaffold/vitest.config.ts`.
- `scaffold/main.ts` — lifecycle skeleton.
- `scaffold/settings.ts` — settings + tab skeleton.
- `scaffold/.gitignore`.
- `settings-coupled-controls.ts` — §4 pattern.
- `adapter-pattern.ts` — §8 pattern.

---

## 12. Typical flow for a new feature

1. **Scope + plan** in issue/task notes. Identify what can live in a standalone pure module.
2. **Write the pure module + vitest tests.** No obsidian imports. Prove correctness in isolation.
3. **Wire into `main.ts`** behind the smallest possible glue (event handler → pure function → vault/editor API).
4. **Build + copy + reload** (§2).
5. **Simulate usage** via `obsidian eval` (§9).
6. **Read logs** via `obsidian dev:console`. If silent, add `console.log` checkpoints and repeat.
7. **Inspect live state** with `obsidian eval code='app.plugins.plugins["<id>"]...'` when logs run out.
8. **Only when the feature works in the live vault**, remove diagnostic logs and commit.

`obsidian dev:debug on` + `obsidian eval` + `obsidian dev:console` turns the plugin into a REPL-able surface. Use it before you guess.
