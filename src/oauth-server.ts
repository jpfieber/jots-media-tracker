import { IncomingMessage, ServerResponse, createServer, Server } from 'http';
import { URL } from 'url';
import { Notice } from 'obsidian';
import { SimklAPI } from './api/simkl';

export interface OAuthResult {
    success: boolean;
    error?: string;
    code?: string;
}

export class OAuthServer {
    private server: Server;
    private resolveCallback?: (result: OAuthResult) => void;

    constructor() {
        this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
            if (!req.url) {
                res.writeHead(400);
                res.end('Invalid request');
                return;
            }

            const url = new URL(req.url, 'http://localhost:8080');
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');

            // Send a response that closes the window
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Complete</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 20px; }
                        .message { margin: 20px 0; }
                    </style>
                </head>
                <body>
                    <h2>Authentication ${error ? 'Failed' : 'Successful'}</h2>
                    <div class="message">${error ? 'Please try again.' : 'You can close this window now.'}</div>
                    <script>
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
                </html>
            `);

            if (this.resolveCallback) {
                this.resolveCallback({
                    success: !error,
                    error: error || undefined,
                    code: code || undefined
                });
                this.resolveCallback = undefined;
            }
        });
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(8080, 'localhost', () => {
                resolve();
            }).on('error', (err: Error) => {
                reject(err);
            });
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            this.server.close(() => resolve());
        });
    }

    waitForCallback(): Promise<OAuthResult> {
        return new Promise((resolve) => {
            this.resolveCallback = resolve;
        });
    }
}
