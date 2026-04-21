// Pattern: two Settings controls that mirror each other without re-rendering
// the whole tab (calling `this.display()` would lose focus/selection).
//
// Capture each control's setValue callback in a local variable so peers can
// update it directly.

import { Setting, PluginSettingTab } from "obsidian";

type Mode = "minimal" | "custom";
const MINIMAL_TEMPLATE = "# {title}\n";

export function renderModeAndTemplate(
  tab: PluginSettingTab,
  containerEl: HTMLElement,
  settings: { mode: Mode; template: string },
  save: () => Promise<void>,
): void {
  let templateSetValue: ((v: string) => void) | null = null;
  let modeSetValue: ((v: string) => void) | null = null;

  new Setting(containerEl)
    .setName("Mode")
    .addDropdown((d) => {
      modeSetValue = (v) => d.setValue(v);
      d.addOption("minimal", "Minimal")
        .addOption("custom", "Custom")
        .setValue(settings.mode)
        .onChange(async (v) => {
          settings.mode = v as Mode;
          if (v === "minimal") templateSetValue?.(MINIMAL_TEMPLATE);
          await save();
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
        await save();
      });
    });
}
