export interface SimklShow {
    title: string;
    year?: number;
    ids?: {
        simkl: number;
        slug: string;
    };
}

export interface SimklEpisode {
    title?: string;
    season: number;
    episode: number;
}

export interface SimklMovie {
    title: string;
    year?: number;
    ids?: {
        simkl: number;
        slug: string;
    };
}

export interface SimklHistoryItem {
    watched_at: string;  // ISO date string
    show?: SimklShow;
    movie?: SimklMovie;
    episode?: SimklEpisode;
    type: 'movie' | 'show';
}

export interface SimklResponse {
    items: SimklHistoryItem[];
}