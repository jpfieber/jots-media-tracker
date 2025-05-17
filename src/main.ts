// This is the entry point of the plugin. It initializes the plugin, sets up commands, and handles the integration with Obsidian.

import { Plugin } from 'obsidian';
import { Settings, DEFAULT_SETTINGS, PluginSettings, SettingsTab } from './settings';
import { SimklAPI } from './api/simkl';
import { SimklHistoryItem, SimklResponse } from './api/types';

export default class ObsidianSimklPlugin extends Plugin {
    settings!: Settings;
    private simklAPI!: SimklAPI;

    async onload() {
        await this.loadSettings();
        const settings = this.settings.getSettings();
        if (settings.clientId && settings.clientSecret) {
            this.simklAPI = new SimklAPI(settings.clientId, settings.clientSecret);
            if (settings.accessToken) {
                this.simklAPI.setTokens(
                    settings.accessToken,
                    settings.refreshToken,
                    settings.tokenExpiresAt ? Math.floor((settings.tokenExpiresAt - Date.now()) / 1000) : null
                );
            }
        }

        this.addCommand({
            id: 'track-viewing',
            name: 'Track Viewing',
            callback: () => this.trackViewing(),
        });

        // Add settings tab
        this.addSettingTab(new SettingsTab(this.app, this));
    }

    private getYesterdayDateString(): string {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        return yesterday.toISOString().split('T')[0];
    }

    async trackViewing() {
        try {
            const settings = this.settings.getSettings();
            if (!settings.clientId) {
                console.error('Please configure your SIMKL Client ID in the settings');
                return;
            }

            // Re-initialize API if needed
            if (!this.simklAPI) {
                this.simklAPI = new SimklAPI(settings.clientId, settings.clientSecret);
                if (settings.accessToken) {
                    this.simklAPI.setTokens(
                        settings.accessToken,
                        settings.refreshToken,
                        settings.tokenExpiresAt ? Math.floor((settings.tokenExpiresAt - Date.now()) / 1000) : null
                    );
                }
            }

            const yesterday = this.getYesterdayDateString();
            const viewingData = await this.simklAPI.fetchViewingInfo(yesterday, yesterday);

            if (!viewingData?.items?.length) {
                console.log('No media watched yesterday');
                return;
            }

            console.log('Views from yesterday:', yesterday);
            viewingData.items.forEach((item: SimklHistoryItem) => {
                const watchedAt = new Date(item.watched_at).toLocaleString();
                if (item.type === 'movie' && item.movie) {
                    console.log(`Movie: ${item.movie.title}${item.movie.year ? ` (${item.movie.year})` : ''} - Watched at ${watchedAt}`);
                } else if (item.type === 'show' && item.show && item.episode) {
                    console.log(`TV: ${item.show.title} - S${item.episode.season}E${item.episode.episode}${item.episode.title ? ` - ${item.episode.title}` : ''} - Watched at ${watchedAt}`);
                }
            });
        } catch (error) {
            console.error('Error tracking viewing:', error);
            if (error instanceof Error) {
                console.error('Error details:', error.message);
            }
        }
    }

    async loadSettings() {
        const savedData = await this.loadData() as Partial<PluginSettings>;
        const mergedSettings = {
            ...DEFAULT_SETTINGS,
            ...savedData
        };
        this.settings = new Settings(mergedSettings);
    }

    async saveSettings() {
        const settings = this.settings.getSettings();
        await this.saveData(settings);

        // Re-initialize API if credentials changed
        if (settings.clientId && settings.clientSecret) {
            this.simklAPI = new SimklAPI(settings.clientId, settings.clientSecret);
            if (settings.accessToken) {
                this.simklAPI.setTokens(
                    settings.accessToken,
                    settings.refreshToken,
                    settings.tokenExpiresAt ? Math.floor((settings.tokenExpiresAt - Date.now()) / 1000) : null
                );
            }
        }
    }

    onunload() {
        // Clean up any resources
        this.simklAPI = undefined as any;
    }
}