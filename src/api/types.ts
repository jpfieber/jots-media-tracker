export interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
    created_at?: number;
}

export interface IDsObject {
    simkl: number;
    slug: string;
    tvdb?: number;
    imdb?: string;
    tmdb?: number;
}

export interface SimklShow {
    title: string;
    year?: number;
    runtime?: number;
    ids: IDsObject;
}

export interface SimklEpisode {
    title?: string;
    season: number;
    episode: number;
    runtime?: number;
    ids?: {
        tvdb?: number;
        imdb?: string;
        tmdb?: number;
    };
}

export interface SimklMovie {
    title: string;
    year?: number;
    runtime?: number;
    ids: IDsObject;
}

export interface SimklHistoryItem {
    watched_at: string;  // ISO date string (end time)
    started_at?: string; // ISO date string (start time)
    show?: SimklShow;
    movie?: SimklMovie;
    episode?: SimklEpisode;
    type: 'movie' | 'show';
}

export interface SimklResponse {
    items: SimklHistoryItem[];
}