// Client HTTP : délais, retries avec attente croissante, proxy optionnel.
import { fetch as undiciFetch, ProxyAgent } from 'undici';

const UA = 'Mozilla/5.0 (compatible; NORESPI-ATS-Jobs-MCP/0.1)';
const agents = new Map();

export class HttpError extends Error {
    constructor(status, url) {
        super(`HTTP ${status} for ${url}`);
        this.status = status;
    }
}

export function createHttp({ getProxyUrl = async () => null, retries = 3, timeoutMs = 25000, log = () => {} } = {}) {
    async function request(url, { type = 'json', method = 'GET', body, headers = {} } = {}) {
        let lastErr;
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const proxyUrl = await getProxyUrl();
                let dispatcher;
                if (proxyUrl) {
                    if (!agents.has(proxyUrl)) agents.set(proxyUrl, new ProxyAgent(proxyUrl));
                    dispatcher = agents.get(proxyUrl);
                }
                const res = await undiciFetch(url, {
                    method,
                    body,
                    dispatcher,
                    redirect: 'follow',
                    signal: AbortSignal.timeout(timeoutMs),
                    headers: {
                        'user-agent': UA,
                        accept: type === 'json' ? 'application/json' : type === 'xml' ? 'application/xml,text/xml,application/rss+xml,*/*' : 'text/html,*/*',
                        'accept-language': 'en,fr;q=0.8',
                        ...headers,
                    },
                });
                if (res.status === 404 || res.status === 410) return null; // absent : pas de retry
                if (res.status === 429 || res.status >= 500) throw new HttpError(res.status, url);
                if (res.status >= 400) {
                    const e = new HttpError(res.status, url);
                    e.fatal = true;
                    throw e;
                }
                const text = await res.text();
                if (type === 'json') {
                    try {
                        return JSON.parse(text);
                    } catch {
                        const e = new Error(`Non-JSON response from ${url}`);
                        e.fatal = true;
                        throw e;
                    }
                }
                return { text, finalUrl: res.url || url };
            } catch (err) {
                lastErr = err;
                if (err.fatal || attempt === retries) break;
                const wait = 1000 * 2 ** attempt + Math.floor(Math.random() * 300);
                log(`Nouvel essai dans ${wait} ms (${err.message})`);
                await new Promise((r) => setTimeout(r, wait));
            }
        }
        throw lastErr;
    }
    return {
        json: (url, opts) => request(url, { ...opts, type: 'json' }),
        text: (url, opts) => request(url, { ...opts, type: 'text' }),
        xml: (url, opts) => request(url, { ...opts, type: 'xml' }),
    };
}
