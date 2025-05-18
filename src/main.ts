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

    private handleAuthCallback = async (params: any) => {
        // The auth code will be in params.code
        if (params.code) {
            // Dispatch custom event that our settings tab will listen for
            const event = new CustomEvent('jots-media-tracker:auth-code', {
                detail: { code: params.code }
            });
            window.dispatchEvent(event);
        }
    };

    async onload() {
        await this.loadSettings();
        const settings = this.settings.getSettings();

        // Register our custom URI protocols
        this.registerObsidianProtocolHandler("jots-media-tracker-auth-callback", this.handleAuthCallback.bind(this));
        this.registerObsidianProtocolHandler("jots-media-tracker-simkl-callback", this.handleAuthCallback.bind(this));

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

    private getDateRange(): { startDate: string, endDate: string } {
        const now = new Date();
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);

        const start = new Date(now);
        const settings = this.settings.getSettings();
        // Extract number from format like '1day' or '7days'
        const days = parseInt(settings.viewTimeSpan.match(/\d+/)?.[0] ?? '1');
        start.setDate(now.getDate() - days);
        start.setHours(0, 0, 0, 0);

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
            const { startDate, endDate } = this.getDateRange();
            console.debug('Fetching viewing info for range:', { startDate, endDate });

            const viewingData = await api.fetchViewingInfo(startDate, endDate);

            if (!viewingData?.items?.length) {
                new Notice('No media watched yesterday');
                return;
            }

            new Notice(`Found ${viewingData.items.length} items watched yesterday`);
            console.debug('Raw viewing data:', viewingData);
            viewingData.items.forEach((item: SimklHistoryItem) => {
                console.debug('Processing item:', item);
                const endTime = new Date(item.watched_at).toLocaleString();
                const startTime = item.started_at ? new Date(item.started_at).toLocaleString() : 'unknown';

                const formatIds = (ids: any) => {
                    if (!ids) {
                        console.debug('No IDs found for item');
                        return '';
                    }
                    console.debug('Formatting IDs:', ids);
                    const formatted = [];
                    if (ids.imdb) formatted.push(`IMDb: ${ids.imdb}`);
                    if (ids.tmdb) formatted.push(`TMDb: ${ids.tmdb}`);
                    if (ids.tvdb) formatted.push(`TVDB: ${ids.tvdb}`);
                    return formatted.length > 0 ? ` [${formatted.join(', ')}]` : '';
                };

                if (item.type === 'movie' && item.movie) {
                    console.debug('Movie IDs:', item.movie.ids);
                    const runtime = item.movie.runtime ? ` (${item.movie.runtime} mins)` : '';
                    const ids = item.movie.ids ? formatIds(item.movie.ids) : '';
                    console.log(`Movie: ${item.movie.title}${item.movie.year ? ` (${item.movie.year})` : ''}${runtime}${ids} - Watched from ${startTime} to ${endTime}`);
                } else if (item.type === 'show' && item.show && item.episode) {
                    console.debug('Show IDs:', item.show.ids);
                    console.debug('Episode IDs:', item.episode.ids);
                    const runtime = item.episode.runtime || item.show.runtime;
                    const runtimeStr = runtime ? ` (${runtime} mins)` : '';
                    const showIds = item.show.ids ? formatIds(item.show.ids) : '';
                    const episodeIds = item.episode.ids ? formatIds(item.episode.ids) : '';
                    console.log(`TV: ${item.show.title}${showIds} - S${item.episode.season}E${item.episode.episode}${item.episode.title ? ` - ${item.episode.title}` : ''}${episodeIds}${runtimeStr} - Watched from ${startTime} to ${endTime}`);
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