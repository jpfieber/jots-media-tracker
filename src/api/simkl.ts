import { requestUrl } from 'obsidian';
import { SimklResponse, SimklHistoryItem, TokenResponse } from './types';

const API_URL = 'https://api.simkl.com';
const AUTH_URL = 'https://simkl.com/oauth/authorize';
const TOKEN_URL = 'https://api.simkl.com/oauth/token';

export class SimklAPI {
    private clientId: string;
    private clientSecret: string;
    private accessToken: string | null = null;
    private refreshToken: string | null = null;
    private tokenExpiresAt: number | null = null;

    constructor(clientId: string, clientSecret: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    getAuthUrl(): string {
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            scope: 'history',
            state: Math.random().toString(36).substring(7),
            redirect_uri: 'obsidian://jots-media-tracker-auth-callback'
        });
        return `${AUTH_URL}?${params}`;
    }

    async exchangeCodeForToken(code: string): Promise<TokenResponse> {
        try {
            // Log full request details for debugging
            console.debug('Starting token exchange...');

            const requestBody = {
                code: code,
                client_id: this.clientId,
                client_secret: this.clientSecret,
                redirect_uri: 'obsidian://jots-media-tracker-auth-callback',
                grant_type: 'authorization_code'
            };

            // Enhanced debug logging
            console.debug('Token request details:', {
                url: TOKEN_URL,
                headers: {
                    'Content-Type': 'application/json',
                    'simkl-api-key': this.clientId
                },
                body: { ...requestBody, client_secret: '[REDACTED]' }
            });

            const response = await requestUrl({
                url: TOKEN_URL,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'simkl-api-key': this.clientId,
                    'User-Agent': 'Obsidian Media Tracker/1.0.0',
                },
                body: JSON.stringify(requestBody)
            });

            // Log full response for debugging
            console.debug('Token response:', {
                status: response.status,
                headers: response.headers,
                text: response.text
            });

            if (response.status !== 200) {
                throw new Error(`Failed to exchange code for token: ${response.status}, details: ${response.text}`);
            }

            const responseData = response.json as TokenResponse;
            this.setTokenData(responseData);
            return responseData;
        } catch (error) {
            console.error('Token exchange failed:', error);
            throw error;
        }
    }

    async refreshAccessToken(): Promise<TokenResponse> {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret
        });

        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to refresh token: ${response.status}, details: ${errorText}`);
        }

        const data = await response.json() as TokenResponse;
        this.setTokenData(data);
        return data;
    }

    private setTokenData(data: TokenResponse) {
        if (!data.access_token) {
            throw new Error('No access token received');
        }
        this.accessToken = data.access_token;
        // Keep existing refresh token if none provided
        if (data.refresh_token) {
            this.refreshToken = data.refresh_token;
        }
        // Only set expiration if provided
        if (data.expires_in) {
            this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
        }
        console.debug('Token data updated:', {
            hasAccessToken: !!this.accessToken,
            hasRefreshToken: !!this.refreshToken,
            expiresAt: this.tokenExpiresAt
        });
    }

    private async ensureValidToken() {
        if (!this.accessToken) {
            throw new Error('Not authenticated');
        }

        // Only check expiration if we have it
        if (this.tokenExpiresAt) {
            // Refresh token if it expires in less than 5 minutes
            if (this.tokenExpiresAt - Date.now() < 300000) {
                try {
                    await this.refreshAccessToken();
                } catch (error) {
                    console.error('Token refresh failed:', error);
                    // If refresh fails and token is expired, throw auth error
                    if (Date.now() > this.tokenExpiresAt) {
                        throw new Error('Authentication token expired');
                    }
                }
            }
        }
    }

    async fetchViewingInfo(startDate: string, endDate: string): Promise<SimklResponse> {
        await this.ensureValidToken();

        try {
            // Validate and normalize date inputs
            const startDateTime = new Date(startDate);
            const endDateTime = new Date(endDate);

            if (isNaN(startDateTime.getTime()) || isNaN(endDateTime.getTime())) {
                throw new Error('Invalid date format. Please use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)');
            }

            if (startDateTime > endDateTime) {
                throw new Error('Start date must be before end date');
            }

            // Convert to UTC timestamps for consistent comparison
            const startTimestamp = startDateTime.getTime();
            const endTimestamp = endDateTime.getTime();

            const params = new URLSearchParams({
                from: startDateTime.toISOString(),
                to: endDateTime.toISOString(),
                extended: 'full'
            });

            const url = `${API_URL}/sync/all-items/history?${params}`;

            const response = await requestUrl({
                url,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'simkl-api-key': this.clientId,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status !== 200) {
                const error = `SIMKL API error: ${response.status} - ${response.text}`;
                throw new Error(error);
            }

            const data = response.json;

            const items: SimklHistoryItem[] = [];

            // Process movies
            if (data.movies && Array.isArray(data.movies)) {
                const movieItems = data.movies
                    .filter((item: Record<string, any>) => {
                        const watchedAt = new Date(item.watched_at || item.last_watched_at);
                        if (isNaN(watchedAt.getTime())) {
                            console.debug('Invalid watched_at date for movie item:', item);
                            return false;
                        }
                        const timestamp = watchedAt.getTime();
                        return timestamp >= startTimestamp && timestamp <= endTimestamp;
                    })
                    .map((item: Record<string, any>): SimklHistoryItem | null => {
                        const watched_at = item.watched_at || item.last_watched_at;
                        if (!watched_at) {
                            console.debug('Movie item missing watched_at:', item);
                            return null;
                        }

                        const movieData = item.movie || item;
                        if (!movieData.title) {
                            console.debug('Movie data missing title:', item);
                            return null;
                        }

                        try {
                            const runtime = movieData.runtime || 0;
                            const watchedAt = new Date(watched_at);
                            const startedAt = new Date(watchedAt.getTime() - runtime * 60 * 1000);

                            return {
                                watched_at,
                                started_at: startedAt.toISOString(),
                                type: 'movie',
                                movie: {
                                    title: movieData.title,
                                    year: movieData.year,
                                    runtime: movieData.runtime,
                                    ids: {
                                        simkl: movieData.ids?.simkl || 0,
                                        slug: movieData.ids?.slug || '',
                                        imdb: movieData.ids?.imdb,
                                        tmdb: movieData.ids?.tmdb
                                    }
                                }
                            };
                        } catch (error) {
                            console.warn('Error processing movie item:', error, item);
                            return null;
                        }
                    })
                    .filter((item: SimklHistoryItem | null): item is SimklHistoryItem => item !== null);

                items.push(...movieItems);
            }

            // Process shows
            if (data.shows && Array.isArray(data.shows)) {
                const showItems = data.shows
                    .filter((item: Record<string, any>) => {
                        const watchedAt = new Date(item.watched_at || item.last_watched_at);
                        if (isNaN(watchedAt.getTime())) {
                            console.debug('Invalid watched_at date for show item:', item);
                            return false;
                        }
                        const timestamp = watchedAt.getTime();
                        return timestamp >= startTimestamp && timestamp <= endTimestamp;
                    })
                    .map((item: Record<string, any>): SimklHistoryItem | null => {
                        const watched_at = item.watched_at || item.last_watched_at;
                        if (!watched_at) {
                            console.debug('Show item missing watched_at:', item);
                            return null;
                        }

                        const showData = item.show || item;
                        if (!showData.title) {
                            console.debug('Show data missing title:', item);
                            return null;
                        }

                        try {
                            // If episode data is not directly available, try to parse from last_watched field
                            let finalEpisodeData = item.episode;
                            if (!finalEpisodeData && item.last_watched) {
                                const match = item.last_watched.match(/S(\d+)E(\d+)/);
                                if (match) {
                                    finalEpisodeData = {
                                        title: "", // Title not available from last_watched
                                        season: parseInt(match[1], 10),
                                        episode: parseInt(match[2], 10),
                                        runtime: showData.runtime // Use show runtime as fallback
                                    };
                                }
                            }

                            if (!finalEpisodeData) {
                                // Skip this item - no episode data available
                                console.debug('Skipping show item - no episode data available:', item);
                                return null;
                            }

                            const runtime = finalEpisodeData.runtime || showData.runtime || 0;
                            const watchedAt = new Date(watched_at);
                            const startedAt = new Date(watchedAt.getTime() - runtime * 60 * 1000);

                            return {
                                watched_at,
                                started_at: startedAt.toISOString(),
                                type: 'show',
                                show: {
                                    title: showData.title,
                                    year: showData.year,
                                    runtime: showData.runtime,
                                    ids: {
                                        simkl: showData.ids?.simkl || 0,
                                        slug: showData.ids?.slug || '',
                                        tvdb: showData.ids?.tvdb,
                                        imdb: showData.ids?.imdb,
                                        tmdb: showData.ids?.tmdb
                                    }
                                },
                                episode: {
                                    title: finalEpisodeData.title || "",
                                    season: finalEpisodeData.season,
                                    episode: finalEpisodeData.episode,
                                    runtime: finalEpisodeData.runtime,
                                    ids: finalEpisodeData.ids || {}
                                }
                            };
                        } catch (error) {
                            console.warn('Error processing show item:', error, item);
                            return null;
                        }
                    })
                    .filter((item: SimklHistoryItem | null): item is SimklHistoryItem => item !== null);

                items.push(...showItems);
            }

            if (items.length === 0) {
                console.debug('No items found in date range', {
                    start: startDateTime.toISOString(),
                    end: endDateTime.toISOString()
                });
            }

            return { items };
        } catch (error) {
            console.error('SIMKL API Error:', error);
            throw error;
        }
    }

    setTokens(accessToken: string, refreshToken: string | null = null, expiresIn: number | null = null): void {
        if (!accessToken) {
            throw new Error('Access token is required');
        }
        this.accessToken = accessToken;
        if (refreshToken) {
            this.refreshToken = refreshToken;
        }
        if (expiresIn && expiresIn > 0) {
            this.tokenExpiresAt = Date.now() + (expiresIn * 1000);
        }
    }

    getTokens(): { accessToken: string | null; refreshToken: string | null; expiresAt: number | null; } {
        return {
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiresAt: this.tokenExpiresAt
        };
    }
}