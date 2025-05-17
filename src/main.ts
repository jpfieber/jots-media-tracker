// This is the entry point of the plugin. It initializes the plugin, sets up commands, and handles the integration with Obsidian.

import { Plugin, Notice } from 'obsidian';
import { Settings, DEFAULT_SETTINGS, PluginSettings, SettingsTab } from './settings';
import { SimklAPI } from './api/simkl';
import { TraktAPI } from './api/trakt';
import { SimklHistoryItem, SimklResponse } from './api/types';

export default class MediaTrackerPlugin extends Plugin {
    settings!: Settings;
    private simklAPI?: SimklAPI;
    private traktAPI?: TraktAPI;

    async onload() {
        await this.loadSettings();
        const settings = this.settings.getSettings();

        // Register our custom URI protocol
        this.registerObsidianProtocolHandler("jots-media-tracker-auth-callback", async (params) => {
            // The auth code will be in params.code
            if (params.code) {
                // Dispatch custom event that our settings tab will listen for
                const event = new CustomEvent('jots-media-tracker:auth-code', {
                    detail: { code: params.code }
                });
                window.dispatchEvent(event);
            }
        });

        if (settings.simkl.enabled && settings.simkl.clientId && settings.simkl.clientSecret) {
            this.simklAPI = new SimklAPI(settings.simkl.clientId, settings.simkl.clientSecret);
            if (settings.simkl.accessToken) {
                this.simklAPI.setTokens(
                    settings.simkl.accessToken,
                    settings.simkl.refreshToken,
                    settings.simkl.tokenExpiresAt ? Math.floor((settings.simkl.tokenExpiresAt - Date.now()) / 1000) : null
                );
            }
        }

        if (settings.trakt.enabled && settings.trakt.clientId && settings.trakt.clientSecret) {
            this.traktAPI = new TraktAPI(settings.trakt.clientId, settings.trakt.clientSecret);
            if (settings.trakt.accessToken) {
                this.traktAPI.setTokens(
                    settings.trakt.accessToken,
                    settings.trakt.refreshToken,
                    settings.trakt.tokenExpiresAt ? Math.floor((settings.trakt.tokenExpiresAt - Date.now()) / 1000) : null
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

    private getYesterdayDateRange(): { startDate: string, endDate: string } {
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);

        // Start of yesterday in local time
        const start = new Date(yesterday);
        start.setHours(0, 0, 0, 0);

        // End of yesterday in local time
        const end = new Date(yesterday);
        end.setHours(23, 59, 59, 999);

        return {
            startDate: start.toISOString(),
            endDate: end.toISOString()
        };
    }

    private async getActiveAPI() {
        const settings = this.settings.getSettings();
        const service = settings.primaryService;

        if (!service) {
            throw new Error('Please select a primary service in settings');
        }

        const serviceSettings = settings[service];
        if (!serviceSettings.enabled) {
            throw new Error(`${service.toUpperCase()} is not enabled`);
        }

        if (!serviceSettings.clientId || !serviceSettings.clientSecret) {
            throw new Error(`Please configure your ${service.toUpperCase()} credentials in settings`);
        }

        if (service === 'simkl') {
            if (!this.simklAPI) {
                this.simklAPI = new SimklAPI(serviceSettings.clientId, serviceSettings.clientSecret);
                if (serviceSettings.accessToken) {
                    this.simklAPI.setTokens(
                        serviceSettings.accessToken,
                        serviceSettings.refreshToken,
                        serviceSettings.tokenExpiresAt ? Math.floor((serviceSettings.tokenExpiresAt - Date.now()) / 1000) : null
                    );
                }
            }
            return this.simklAPI;
        } else if (service === 'trakt') {
            if (!this.traktAPI) {
                this.traktAPI = new TraktAPI(serviceSettings.clientId, serviceSettings.clientSecret);
                if (serviceSettings.accessToken) {
                    this.traktAPI.setTokens(
                        serviceSettings.accessToken,
                        serviceSettings.refreshToken,
                        serviceSettings.tokenExpiresAt ? Math.floor((serviceSettings.tokenExpiresAt - Date.now()) / 1000) : null
                    );
                }
            }
            return this.traktAPI;
        }

        throw new Error(`Unknown service: ${service}`);
    }

    async trackViewing() {
        try {
            const api = await this.getActiveAPI();
            const { startDate, endDate } = this.getYesterdayDateRange();
            console.debug('Fetching viewing info for range:', { startDate, endDate });

            const viewingData = await api.fetchViewingInfo(startDate, endDate);

            if (!viewingData?.items?.length) {
                new Notice('No media watched yesterday');
                return;
            }

            new Notice(`Found ${viewingData.items.length} items watched yesterday`);
            console.log('Views from yesterday:', { startDate, endDate });
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
                new Notice(`Error: ${error.message}`);
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
        if (settings.simkl.enabled && settings.simkl.clientId && settings.simkl.clientSecret) {
            this.simklAPI = new SimklAPI(settings.simkl.clientId, settings.simkl.clientSecret);
            if (settings.simkl.accessToken) {
                this.simklAPI.setTokens(
                    settings.simkl.accessToken,
                    settings.simkl.refreshToken,
                    settings.simkl.tokenExpiresAt ? Math.floor((settings.simkl.tokenExpiresAt - Date.now()) / 1000) : null
                );
            }
        }

        if (settings.trakt.enabled && settings.trakt.clientId && settings.trakt.clientSecret) {
            this.traktAPI = new TraktAPI(settings.trakt.clientId, settings.trakt.clientSecret);
            if (settings.trakt.accessToken) {
                this.traktAPI.setTokens(
                    settings.trakt.accessToken,
                    settings.trakt.refreshToken,
                    settings.trakt.tokenExpiresAt ? Math.floor((settings.trakt.tokenExpiresAt - Date.now()) / 1000) : null
                );
            }
        }
    }

    onunload() {
        // Clean up any resources
        this.simklAPI = undefined;
        this.traktAPI = undefined;
    }
}