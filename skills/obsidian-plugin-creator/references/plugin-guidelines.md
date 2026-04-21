# Obsidian plugin guidelines — cheat sheet

Trimmed from <https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines>. These are the rules reviewers check on community-directory submission. The main SKILL.md covers the ones you'll most often hit; this file is the full checklist.

## General

- Use `this.app` — never the global `app` / `window.app`.
- No `console.log` / `console.debug` / `console.info` in release builds. `console.error` for actual errors only.
- Organize `src/` into folders once it exceeds a handful of files.
- Rename every sample-plugin placeholder: `MyPlugin`, `MyPluginSettings`, `SampleSettingTab`, etc.

## Mobile

- `"isDesktopOnly": false` in `manifest.json` means the plugin loads on iOS/Android — no Node, no Electron. Guard `require("fs"|"path"|"electron"|...)` behind `Platform.isDesktopApp`.
- Avoid regex lookbehind (`(?<=...)`) — crashes on older iOS WebViews. Lookahead is fine.

## UI text

- **Sentence case** everywhere. "Template folder location", not "Template Folder Location".
- **No top-level heading** in the settings tab. No "General" / "Settings" / plugin name.
- **No "settings" inside headings.** "Advanced", not "Advanced settings".
- Use `new Setting(el).setName("...").setHeading()`, not raw `<h1>`/`<h2>`.
- Use `Notice` for transient feedback.

## Security

- **Banned:** `innerHTML`, `outerHTML`, `insertAdjacentHTML`. XSS vector.
- Use `createEl`, `createDiv`, `createSpan`, `el.empty()`. Options: `{ text, cls, attr, href }`.

## Resource management

- Use `registerEvent`, `registerInterval`, `registerDomEvent`, `addCommand` — they auto-clean on unload.
- **Don't `detach()` leaves in `onunload`.** Obsidian re-opens leaves in original position on plugin update; detaching destroys the user's layout.

## Commands

- No default hotkeys — they collide across OSes and stomp user bindings.
- Pick the narrowest callback:
  - `callback` — always runnable.
  - `checkCallback` — conditional; return `true` from `checking` branch to show in palette.
  - `editorCallback` / `editorCheckCallback` — needs active Markdown editor.

## Workspace

- Avoid `workspace.activeLeaf`. Use `getActiveViewOfType(MarkdownView)` or `activeEditor?.editor`.
- Register views by factory, don't store the instance:
  ```ts
  this.registerView(VIEW, () => new MyView());            // ✅
  this.registerView(VIEW, () => (this.view = new MyView())); // ❌
  ```
  Retrieve via `workspace.getLeavesOfType(VIEW)`.

## Vault

- **Editor > `Vault.modify` > `Vault.process`.** Editor preserves cursor/selection/fold. `Vault.process` is atomic for background writes.
- Prefer Vault API over Adapter API (`app.vault.adapter.*`) — Vault has a read cache and serializes writes.
- Use `getFileByPath` / `getFolderByPath` / `getAbstractFileByPath`. Never iterate `getFiles()` to find a path.
- `normalizePath(path)` anything user-supplied or path-concatenated.
- `fileManager.processFrontMatter` for frontmatter (atomic, preserves formatting).
- `fileManager.renameFile` for moves (rewrites wikilinks).

## Editor extensions

Hot-swap by mutating the registered array in-place and calling `updateOptions()`:

```ts
this.editorExt.length = 0;
this.editorExt.push(this.buildExtension());
this.app.workspace.updateOptions();
```

A new array breaks registration.

## Styling

- No inline `element.style.*` for colors, sizes, backgrounds — themes can't override.
- Ship `styles.css`. Use Obsidian CSS variables:
  - Text: `--text-normal`, `--text-muted`, `--text-faint`.
  - Background: `--background-primary`, `--background-secondary`, `--background-modifier-{border,error,success,hover}`.
  - Accent: `--interactive-accent`, `--interactive-hover`.

## TypeScript

- `const` / `let`, never `var`.
- `async`/`await`, not raw `.then` chains.

## Network

- `requestUrl` from `obsidian` for all HTTP. Raw `fetch` hits CORS cross-origin.
