import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import { SimklAPI } from './api/simkl';
import { TraktAPI } from './api/trakt';
import { AuthCodeModal } from './ui/authModal';

interface APISettings {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: number | null;
    enabled: boolean;
}

export interface PluginSettings {
    simkl: APISettings;
    trakt: APISettings;
    trackMovies: boolean;
    trackTVShows: boolean;
    primaryService: 'simkl' | 'trakt' | null;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    simkl: {
        clientId: '',
        clientSecret: '',
        accessToken: '',
        refreshToken: '',
        tokenExpiresAt: null,
        enabled: false
    },
    trakt: {
        clientId: '',
        clientSecret: '',
        accessToken: '',
        refreshToken: '',
        tokenExpiresAt: null,
        enabled: false
    },
    trackMovies: true,
    trackTVShows: true,
    primaryService: null
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

    constructor(app: App, plugin: any) {
        super(app, plugin);
        this.plugin = plugin;
    }

    private async handleAuthCode(
        code: string,
        api: SimklAPI | TraktAPI,
        serviceKey: 'simkl' | 'trakt',
        serviceName: string
    ) {
        try {
            const tokenResponse = await api.exchangeCodeForToken(code);

            const currentSettings = this.plugin.settings.getSettings();
            currentSettings[serviceKey].accessToken = tokenResponse.access_token;
            currentSettings[serviceKey].refreshToken = tokenResponse.refresh_token;
            currentSettings[serviceKey].tokenExpiresAt = tokenResponse.expires_in
                ? Date.now() + (tokenResponse.expires_in * 1000)
                : null;

            this.plugin.settings.setSettings(currentSettings);
            await this.plugin.saveSettings();

            new Notice(`Successfully authenticated with ${serviceName}`);
            this.display();
        } catch (error) {
            console.error('Token exchange failed:', error);
            new Notice(`Failed to complete authentication with ${serviceName}. Please try again.`);
        }
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Media Tracker Settings' });

        const settings = this.plugin.settings.getSettings();

        // Add auth sections for each service
        this.addAuthSection(containerEl, 'SIMKL', 'simkl', settings.simkl);
        this.addAuthSection(containerEl, 'Trakt', 'trakt', settings.trakt);

        // Add service selection
        containerEl.createEl('h3', { text: 'Service Selection' });
        new Setting(containerEl)
            .setName('Primary Service')
            .setDesc('Choose which service to use primarily for fetching viewing history')
            .addDropdown(dropdown => dropdown
                .addOption('', 'Choose a service')
                .addOption('simkl', 'SIMKL')
                .addOption('trakt', 'Trakt')
                .setValue(settings.primaryService || '')
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    this.plugin.settings.setSettings({
                        ...currentSettings,
                        primaryService: value as 'simkl' | 'trakt' | null
                    });
                    await this.plugin.saveSettings();
                }));

        // Add content settings
        containerEl.createEl('h3', { text: 'Content Settings' });
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

    private addAuthSection(containerEl: HTMLElement, serviceName: string, serviceKey: 'simkl' | 'trakt', serviceSettings: APISettings) {
        const section = containerEl.createEl('div', { cls: 'media-tracker-service-settings' });

        section.createEl('h3', { text: `${serviceName} Settings` });

        // Add enable toggle
        new Setting(section)
            .setName('Enable Service')
            .addToggle(toggle => toggle
                .setValue(serviceSettings.enabled)
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    currentSettings[serviceKey].enabled = value;
                    this.plugin.settings.setSettings(currentSettings);
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (!serviceSettings.enabled) {
            return;
        }

        // Add client ID field
        new Setting(section)
            .setName('Client ID')
            .setDesc(`Enter your ${serviceName} Client ID`)
            .addText(text => text
                .setPlaceholder('Enter Client ID')
                .setValue(serviceSettings.clientId)
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    currentSettings[serviceKey].clientId = value;
                    this.plugin.settings.setSettings(currentSettings);
                    await this.plugin.saveSettings();
                }));

        // Add client secret field
        new Setting(section)
            .setName('Client Secret')
            .setDesc(`Enter your ${serviceName} Client Secret`)
            .addText(text => text
                .setPlaceholder('Enter Client Secret')
                .setValue(serviceSettings.clientSecret)
                .onChange(async (value) => {
                    const currentSettings = this.plugin.settings.getSettings();
                    currentSettings[serviceKey].clientSecret = value;
                    this.plugin.settings.setSettings(currentSettings);
                    await this.plugin.saveSettings();
                }));

        // Add authentication button if credentials are set
        if (serviceSettings.clientId && serviceSettings.clientSecret) {
            if (!serviceSettings.accessToken) {
                section.createEl('p', {
                    text: `Click the button below to authenticate with ${serviceName}.`
                });

                new Setting(section)
                    .setName('Authentication')
                    .addButton(button => button
                        .setButtonText(`Authenticate with ${serviceName}`)
                        .onClick(async () => {
                            try {
                                // Get the auth URL and open it
                                const api = serviceKey === 'simkl'
                                    ? new SimklAPI(serviceSettings.clientId, serviceSettings.clientSecret)
                                    : new TraktAPI(serviceSettings.clientId, serviceSettings.clientSecret);
                                const authUrl = api.getAuthUrl();
                                window.open(authUrl, '_blank');

                                // Show a notice to tell the user what's happening
                                new Notice('Waiting for authorization... Check your browser and complete the process.');

                                // Create and show modal in case manual code entry is needed
                                const modal = new AuthCodeModal(this.app, async (code) => {
                                    await this.handleAuthCode(code, api, serviceKey, serviceName);
                                });
                                modal.open();

                                // Also listen for the auth code from the protocol handler
                                type AuthCodeEvent = CustomEvent<{ code: string }>;
                                const authHandler = async (event: AuthCodeEvent) => {
                                    const code = event.detail.code;
                                    await this.handleAuthCode(code, api, serviceKey, serviceName);
                                    modal.close();
                                    window.removeEventListener('jots-media-tracker:auth-code', authHandler as unknown as EventListener);
                                };

                                window.addEventListener('jots-media-tracker:auth-code', authHandler as unknown as EventListener);
                            } catch (error) {
                                console.error('Authentication failed:', error);
                                new Notice('Authentication failed. Please try again.');
                            }
                        }));
            } else {
                section.createEl('p', {
                    text: `You are currently authenticated with ${serviceName}.`
                });

                new Setting(section)
                    .setName('Authentication')
                    .addButton(button => button
                        .setButtonText('Re-authenticate')
                        .onClick(async () => {
                            const currentSettings = this.plugin.settings.getSettings();
                            currentSettings[serviceKey].accessToken = '';
                            currentSettings[serviceKey].refreshToken = '';
                            currentSettings[serviceKey].tokenExpiresAt = null;
                            this.plugin.settings.setSettings(currentSettings);
                            await this.plugin.saveSettings();
                            this.display();
                        }));
            }
        }
    }
}