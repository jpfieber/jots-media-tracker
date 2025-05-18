import { requestUrl } from 'obsidian';
import type { SimklHistoryItem, SimklResponse, TokenResponse } from './types';

const API_URL = 'https://api.trakt.tv';
const AUTH_URL = 'https://trakt.tv/oauth/authorize';
const TOKEN_URL = 'https://api.trakt.tv/oauth/token';

interface TraktEpisode {
    season: number;
    number: number;
    title: string;
    runtime?: number;
    ids: {
        trakt: number;
        tvdb?: number;
        imdb?: string;
        tmdb?: number;
    };
}

interface TraktShow {
    title: string;
    year: number;
    runtime?: number;
    ids: {
        trakt: number;
        slug: string;
        tvdb?: number;
        imdb?: string;
        tmdb?: number;
    };
}

interface TraktMovie {
    title: string;
    year: number;
    runtime?: number;
    ids: {
        trakt: number;
        slug: string;
        imdb?: string;
        tmdb?: number;
    };
}

interface TraktHistoryItem {
    id: number;
    watched_at: string;
    action: string;
    type: 'movie' | 'episode';
    episode?: TraktEpisode;
    show?: TraktShow;
    movie?: TraktMovie;
}

export class TraktAPI {
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
            redirect_uri: 'obsidian://jots-media-tracker-auth-callback',
            state: Math.random().toString(36).substring(7)
        });
        return `${AUTH_URL}?${params}`;
    }

    async exchangeCodeForToken(code: string): Promise<TokenResponse> {
        const params = {
            code,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: 'obsidian://jots-media-tracker-auth-callback',
            grant_type: 'authorization_code'
        };

        try {
            console.debug('Exchanging code for token with params:', { ...params, client_secret: '[REDACTED]' });
            const response = await requestUrl({
                url: TOKEN_URL,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'trakt-api-version': '2'
                },
                body: JSON.stringify(params)
            });

            const data = response.json as TokenResponse;
            this.setTokenData(data);
            return data;
        } catch (error) {
            console.error('Token exchange failed:', error);
            throw new Error(error instanceof Error ? error.message : 'Failed to exchange code for token');
        }
    }

    async refreshAccessToken(): Promise<TokenResponse> {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }

        const params = {
            refresh_token: this.refreshToken,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'refresh_token',
            redirect_uri: 'obsidian://jots-media-tracker-auth-callback'
        };

        try {
            const response = await requestUrl({
                url: TOKEN_URL,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });

            const data = response.json as TokenResponse;
            this.setTokenData(data);
            return data;
        } catch (error) {
            console.error('Token refresh failed:', error);
            throw new Error(error instanceof Error ? error.message : 'Failed to refresh token');
        }
    }

    private setTokenData(data: TokenResponse) {
        if (!data.access_token) {
            throw new Error('No access token received');
        }
        this.accessToken = data.access_token;
        if (data.refresh_token) {
            this.refreshToken = data.refresh_token;
        }
        if (data.expires_in) {
            this.tokenExpiresAt = Date.now() + (data.expires_in * 1000);
        }
        if (data.created_at) {
            // If the token response includes created_at, use that for more accurate expiration
            this.tokenExpiresAt = (data.created_at + data.expires_in) * 1000;
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
        const url = `${API_URL}/sync/history?start_at=${startDate}&end_at=${endDate}&extended=full`;
        console.debug('Fetching viewing info:', { url, startDate, endDate });

        const response = await requestUrl({
            url,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': this.clientId,
                'Authorization': `Bearer ${this.accessToken}`
            }
        });

        if (response.status !== 200) {
            throw new Error(`HTTP error! status: ${response.status}, details: ${response.text}`);
        }

        const data = response.json;

        // Log detailed information about the first item to see all available fields
        if (data && data.length > 0) {
            console.debug('First history item details:', {
                allFields: Object.keys(data[0]),
                item: data[0],
                episodeDetails: data[0].type === 'episode' ? {
                    fields: Object.keys(data[0].episode),
                    showFields: Object.keys(data[0].show),
                    data: {
                        episode: data[0].episode,
                        show: data[0].show
                    }
                } : undefined,
                movieDetails: data[0].type === 'movie' ? {
                    fields: Object.keys(data[0].movie),
                    data: data[0].movie
                } : undefined
            });
        }

        console.debug('Processed Trakt API Response:', {
            status: response.status,
            items: data.map((item: any) => ({
                ...item,
                episode: item.type === 'episode' ? {
                    ...item.episode,
                    runtime: item.episode.runtime,
                    first_aired: item.episode.first_aired,
                    comment_count: item.episode.comment_count
                } : undefined,
                movie: item.type === 'movie' ? {
                    ...item.movie,
                    runtime: item.movie.runtime,
                    tagline: item.movie.tagline,
                    overview: item.movie.overview
                } : undefined,
                show: item.type === 'episode' ? {
                    ...item.show,
                    runtime: item.show.runtime,
                    status: item.show.status
                } : undefined
            }))
        });

        // Ensure we have an array of items
        const historyItems = Array.isArray(data) ? data : [];

        try {
            // Convert Trakt format to SIMKL format for consistency
            return {
                items: historyItems.map((item: TraktHistoryItem): SimklHistoryItem => {
                    if (!item.watched_at) {
                        console.warn('Item missing watched_at:', item);
                        throw new Error('Invalid item format: missing watched_at timestamp');
                    } if (item.type === 'movie' && item.movie) {
                        const runtime = item.movie.runtime || 0;
                        const watchedAt = new Date(item.watched_at);
                        const startedAt = new Date(watchedAt.getTime() - runtime * 60 * 1000);

                        return {
                            watched_at: item.watched_at,
                            started_at: startedAt.toISOString(),
                            type: 'movie',
                            movie: {
                                title: item.movie.title,
                                year: item.movie.year,
                                runtime: item.movie.runtime,
                                ids: {
                                    simkl: item.movie.ids.trakt,
                                    slug: item.movie.ids.slug,
                                    imdb: item.movie.ids.imdb,
                                    tmdb: item.movie.ids.tmdb
                                }
                            }
                        };
                    } else if (item.type === 'episode' && item.show && item.episode) {
                        const runtime = item.episode.runtime || item.show.runtime || 0;
                        const watchedAt = new Date(item.watched_at);
                        const startedAt = new Date(watchedAt.getTime() - runtime * 60 * 1000);

                        return {
                            watched_at: item.watched_at,
                            started_at: startedAt.toISOString(),
                            type: 'show',
                            show: {
                                title: item.show.title,
                                year: item.show.year,
                                runtime: item.show.runtime,
                                ids: {
                                    simkl: item.show.ids.trakt,
                                    slug: item.show.ids.slug,
                                    tvdb: item.show.ids.tvdb,
                                    imdb: item.show.ids.imdb,
                                    tmdb: item.show.ids.tmdb
                                }
                            },
                            episode: {
                                title: item.episode.title,
                                season: item.episode.season,
                                episode: item.episode.number,
                                runtime: item.episode.runtime,
                                ids: {
                                    tvdb: item.episode.ids.tvdb,
                                    imdb: item.episode.ids.imdb,
                                    tmdb: item.episode.ids.tmdb
                                }
                            }
                        };
                    } else {
                        throw new Error(`Invalid item type or missing data: ${JSON.stringify(item)}`);
                    }
                })
            };
        } catch (error: unknown) {
            console.error('Failed to parse Trakt response:', error);
            console.error('Raw response:', data);
            const message = error instanceof Error ? error.message : 'Unknown error parsing response';
            throw new Error(`Failed to parse Trakt response: ${message}`);
        }
    }

    setTokens(accessToken: string, refreshToken: string | null = null, expiresIn: number | null = null) {
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
