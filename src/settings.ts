import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { SimklAPI } from './api/simkl';
import { OAuthServer } from './oauth-server';

export interface PluginSettings {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: number | null;
    trackMovies: boolean;
    trackTVShows: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    tokenExpiresAt: null,
    trackMovies: true,
    trackTVShows: true,
};

export class Settings {
    private settings: PluginSettings;

    constructor(initialSettings: PluginSettings = DEFAULT_SETTINGS) {
        this.settings = initialSettings;
    }

    public getSettings(): PluginSettings {
        return this.settings;
    }

    public setSettings(newSettings: PluginSettings): void {
        this.settings = newSettings;
    }
}

export class SettingsTab extends PluginSettingTab {
    plugin: any;
    private oauthServer?: OAuthServer;

    constructor(app: App, plugin: any) {
        super(app, plugin);
        this.plugin = plugin;
    }

    async onunload() {
        if (this.oauthServer) {
            await this.oauthServer.stop();
            this.oauthServer = undefined;
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Obsidian Simkl Plugin Settings' });

        const settings = this.plugin.settings.getSettings();
        const simkl = new SimklAPI(settings.clientId, settings.clientSecret);

        new Setting(containerEl)
            .setName('Client ID')
            .setDesc('Enter your SIMKL Client ID')
            .addText(text => text
                .setPlaceholder('Enter Client ID')
                .setValue(settings.clientId)
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    this.plugin.settings.setSettings({
                        ...currentSettings,
                        clientId: value
                    });
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Client Secret')
            .setDesc('Enter your SIMKL Client Secret')
            .addText(text => text
                .setPlaceholder('Enter Client Secret')
                .setValue(settings.clientSecret)
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    this.plugin.settings.setSettings({
                        ...currentSettings,
                        clientSecret: value
                    });
                    await this.plugin.saveSettings();
                }));

        if (settings.clientId && settings.clientSecret) {
            if (!settings.accessToken) {
                containerEl.createEl('p', {
                    text: 'Click the button below to authenticate with SIMKL.'
                });

                new Setting(containerEl)
                    .setName('Authentication')
                    .addButton(button => button
                        .setButtonText('Authenticate with SIMKL')
                        .onClick(async () => {
                            try {
                                // Start the OAuth server
                                this.oauthServer = new OAuthServer();
                                await this.oauthServer.start();

                                // Get the auth URL and open it
                                const authUrl = simkl.getAuthUrl();
                                window.open(authUrl, '_blank');

                                // Wait for the callback
                                const result = await this.oauthServer.waitForCallback();
                                await this.oauthServer.stop();
                                this.oauthServer = undefined;

                                if (!result.success || !result.code) {
                                    throw new Error(result.error || 'Authentication failed');
                                }

                                // Exchange the code for tokens
                                const tokenData = await simkl.exchangeCodeForToken(result.code);

                                // Save the tokens
                                const currentSettings = this.plugin.settings.getSettings();
                                this.plugin.settings.setSettings({
                                    ...currentSettings,
                                    accessToken: tokenData.access_token,
                                    refreshToken: tokenData.refresh_token || '',
                                    tokenExpiresAt: Date.now() + (tokenData.expires_in * 1000)
                                });
                                await this.plugin.saveSettings();

                                new Notice('Successfully authenticated with SIMKL!');
                                this.display();

                            } catch (error) {
                                console.error('Authentication failed:', error);
                                new Notice('Authentication failed. Please try again.');
                            }
                        }));
            } else {
                containerEl.createEl('p', {
                    text: 'You are currently authenticated with SIMKL.'
                });

                new Setting(containerEl)
                    .setName('Authentication')
                    .addButton(button => button
                        .setButtonText('Re-authenticate')
                        .onClick(async () => {
                            const currentSettings = this.plugin.settings.getSettings();
                            this.plugin.settings.setSettings({
                                ...currentSettings,
                                accessToken: '',
                                refreshToken: '',
                                tokenExpiresAt: null
                            });
                            await this.plugin.saveSettings();
                            this.display();
                        }));
            }
        }

        new Setting(containerEl)
            .setName('Track Movies')
            .addToggle(toggle => toggle
                .setValue(settings.trackMovies)
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    this.plugin.settings.setSettings({
                        ...currentSettings,
                        trackMovies: value
                    });
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Track TV Shows')
            .addToggle(toggle => toggle
                .setValue(settings.trackTVShows)
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    this.plugin.settings.setSettings({
                        ...currentSettings,
                        trackTVShows: value
                    });
                    await this.plugin.saveSettings();
                }));
    }
}