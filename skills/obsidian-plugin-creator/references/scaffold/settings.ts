import { App, PluginSettingTab, Setting } from "obsidian";
import type MyPlugin from "./main";

export interface PluginSettings {
  enabled: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  enabled: true,
};

export class SettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: MyPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enabled")
      .setDesc("Turn the plugin's main feature on or off.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
          this.plugin.settings.enabled = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
