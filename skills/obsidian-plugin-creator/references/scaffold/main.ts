import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, PluginSettings, SettingTab } from "./settings";

export default class MyPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  private disposed = false;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new SettingTab(this.app, this));

    this.addCommand({
      id: "do-thing",
      name: "Do the thing",
      editorCallback: (editor) => {
        editor.replaceRange("hello from plugin\n", editor.getCursor());
      },
    });

    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        if (this.disposed) return;
        // pass to a pure module rather than doing work inline
      }),
    );
  }

  onunload() {
    this.disposed = true;
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
