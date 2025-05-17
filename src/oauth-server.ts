import { requestUrl, Notice } from 'obsidian';

export interface OAuthResult {
    success: boolean;
    error?: string;
    code?: string;
    data?: any;
}

export class OAuthHandler {
    async exchangeCodeForToken(tokenUrl: string, params: Record<string, string>): Promise<OAuthResult> {
        try {
            const response = await requestUrl({
                url: tokenUrl,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(params)
            });

            if (response.status !== 200) {
                throw new Error(`Failed to exchange code for token: ${response.status}, details: ${response.text}`);
            }

            return {
                success: true,
                data: response.json
            };
        } catch (error) {
            console.error('Token exchange failed:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error during token exchange'
            };
        }
    }
}
