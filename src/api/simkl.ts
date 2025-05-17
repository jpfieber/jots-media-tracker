import { SimklResponse, SimklHistoryItem } from './types';

const API_URL = 'https://api.simkl.com';
const AUTH_URL = 'https://simkl.com/oauth/authorize';
const TOKEN_URL = 'https://api.simkl.com/oauth/token';

import { TokenResponse } from './types';

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
        const params = {
            grant_type: 'authorization_code',
            code,
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: 'obsidian://jots-media-tracker-auth-callback'
        };

        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to exchange code for token: ${response.status}, details: ${errorText}`);
        }

        const data = await response.json() as TokenResponse;
        this.setTokenData(data);
        return data;
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
            throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
        }

        const data = await response.json();
        console.debug('SIMKL API Response:', data);

        try {
            // Check if we got an array directly or if it's wrapped in a response object
            const items = Array.isArray(data) ? data : data.items || [];

            return {
                items: items.map((item: any): SimklHistoryItem => {
                    if (!item.watched_at) {
                        console.warn('Item missing watched_at:', item);
                        throw new Error('Invalid item format: missing watched_at timestamp');
                    }

                    return {
                        watched_at: item.watched_at,
                        type: item.movie ? 'movie' : 'show',
                        movie: item.movie,
                        show: item.show,
                        episode: item.episode
                    };
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