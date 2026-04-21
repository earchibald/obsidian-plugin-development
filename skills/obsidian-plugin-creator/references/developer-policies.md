# Obsidian developer policies — cheat sheet

Trimmed from <https://docs.obsidian.md/Developer+policies>. Applies to plugins submitted to the Obsidian Community Plugins directory. Violations block submission or trigger removal.

## Hard prohibitions

Never ship these, even behind a setting:

- Code obfuscation to hide behavior.
- Dynamic ads loaded over the network.
- Static ads outside the plugin's own UI surface.
- Client-side telemetry of any kind.
- A self-update mechanism — updates go through Obsidian's updater.
- (Themes only) Loading assets from the network. Bundle them.

## Requires README disclosure

Allowed if clearly stated up front:

- Paywalled features.
- Account-required features.
- Network use — list every remote service and why.
- Reading/writing files outside the vault — explain why.
- Static ads inside the plugin's own UI.
- Server-side telemetry — link a privacy policy.
- Closed-source builds — case-by-case.

## Repo hygiene

- Ship a `LICENSE` file; state the license in the README.
- Comply with upstream licenses of vendored code; attribute where required.
- Don't imply first-party status ("Obsidian X", "Official Obsidian ...") — trademark.
- Description ≤ 250 chars; no "This is a plugin for Obsidian that ..." boilerplate.
- Keep `manifest.json` (`version`, `minAppVersion`) and `versions.json` accurate. `versions.json` maps each plugin version to the minimum Obsidian version it supports; the updater uses it to decide installability.

## Removal

Obsidian may remove a plugin for policy violation, unmaintained status, or being severely broken. Immediate removal if the plugin appears malicious, the developer is uncooperative, or it's a repeated violation.
