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

        const params = new URLSearchParams({
            date_from: startDate,
            date_to: endDate,
            extended: 'full'
        });

        const response = await fetch(`${API_URL}/sync/history?${params}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.accessToken}`,
                'simkl-api-key': this.clientId,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('SIMKL API Error Response:', {
                status: response.status,
                headers: response.headers,
                body: errorText
            });
            throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
        }

        const data = await response.json();
        console.debug('SIMKL API Response Details:', {
            rawResponse: data,
            status: response.status,
            headers: response.headers,
            responseSize: JSON.stringify(data).length,
            hasItems: Array.isArray(data) ? data.length : 0,
            firstItem: Array.isArray(data) && data.length > 0 ? data[0] : null
        });

        try {
            // Check if we got an array directly or if it's wrapped in a response object
            const items = Array.isArray(data) ? data : data.items || [];

            return {
                items: items.map((item: any): SimklHistoryItem => {
                    if (!item.watched_at) {
                        console.warn('Item missing watched_at:', item);
                        throw new Error('Invalid item format: missing watched_at timestamp');
                    }

                    // Extract runtime to calculate start time
                    let runtime = 0;
                    if (item.movie && item.movie.runtime) {
                        runtime = item.movie.runtime;
                    } else if (item.episode && item.episode.runtime) {
                        runtime = item.episode.runtime;
                    } else if (item.show && item.show.runtime) {
                        runtime = item.show.runtime;
                    }

                    const watchedAt = new Date(item.watched_at);
                    const startedAt = new Date(watchedAt.getTime() - runtime * 60 * 1000);

                    const result: SimklHistoryItem = {
                        watched_at: item.watched_at,
                        started_at: startedAt.toISOString(),
                        type: item.movie ? 'movie' : 'show'
                    };

                    if (item.movie) {
                        result.movie = {
                            title: item.movie.title,
                            year: item.movie.year,
                            runtime: item.movie.runtime,
                            ids: {
                                simkl: item.movie.ids?.simkl || 0,
                                slug: item.movie.ids?.slug || '',
                                imdb: item.movie.ids?.imdb,
                                tmdb: item.movie.ids?.tmdb
                            }
                        };
                    } else if (item.show) {
                        result.show = {
                            title: item.show.title,
                            year: item.show.year,
                            runtime: item.show.runtime,
                            ids: {
                                simkl: item.show.ids?.simkl || 0,
                                slug: item.show.ids?.slug || '',
                                tvdb: item.show.ids?.tvdb,
                                imdb: item.show.ids?.imdb,
                                tmdb: item.show.ids?.tmdb
                            }
                        };

                        if (item.episode) {
                            result.episode = {
                                title: item.episode.title,
                                season: item.episode.season,
                                episode: item.episode.number,
                                runtime: item.episode.runtime,
                                ids: {
                                    tvdb: item.episode.ids?.tvdb,
                                    imdb: item.episode.ids?.imdb,
                                    tmdb: item.episode.ids?.tmdb
                                }
                            };
                        }
                    }

                    return result;
                })
            };
        } catch (error: unknown) {
            console.error('Failed to parse SIMKL response:', error);
            console.error('Raw response:', data);
            const message = error instanceof Error ? error.message : 'Unknown error parsing response';
            throw new Error(`Failed to parse SIMKL response: ${message}`);
        }
    }

    setTokens(accessToken: string, refreshToken: string | null = null, expiresIn: number | null = null) {
        if (!accessToken) {
            throw new Error('Access token is required');
        }
        this.accessToken = accessToken;
        // Only update refresh token if provided
        if (refreshToken) {
            this.refreshToken = refreshToken;
        }
        // Only update expiration if provided
        if (expiresIn && expiresIn > 0) {
            this.tokenExpiresAt = Date.now() + (expiresIn * 1000);
        }
        console.debug('Tokens set:', {
            hasAccessToken: !!this.accessToken,
            hasRefreshToken: !!this.refreshToken,
            expiresAt: this.tokenExpiresAt
        });
    }

    getTokens() {
        return {
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            expiresAt: this.tokenExpiresAt
        };
    }
}