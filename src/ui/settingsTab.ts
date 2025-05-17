import { PluginSettingTab, App, Setting } from 'obsidian';

export class SimklSettingsTab extends PluginSettingTab {
    private plugin: any;

    constructor(app: App, plugin: any) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Simkl Plugin Settings' });

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Enter your SIMKL API key here.')
            .addText(text => text
                .setPlaceholder('Enter API Key')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async (value) => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Journal Entry')
            .setDesc('Customize the default text for journal entries.')
            .addTextArea(textArea => textArea
                .setPlaceholder('Enter default journal entry text')
                .setValue(this.plugin.settings.defaultJournalEntry)
                .onChange(async (value) => {
                    this.plugin.settings.defaultJournalEntry = value;
                    await this.plugin.saveSettings();
                }));
    }
}