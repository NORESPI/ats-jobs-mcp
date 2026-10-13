// Utilitaires sans dépendance réseau : texte, XML minimal, file de concurrence.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', euro: '€' };

export function decodeEntities(s) {
    if (!s) return '';
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        const v = ENTITIES[e.toLowerCase()];
        return v === undefined ? m : v;
    });
}

// HTML (éventuellement échappé) -> texte brut lisible.
export function htmlToText(html) {
    if (!html) return '';
    let s = String(html);
    if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
    s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ' ');
    s = decodeEntities(s);
    return s.replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function truncate(text, max) {
    if (!text) return '';
    if (!max || max <= 0 || text.length <= max) return text;
    const cut = text.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return `${(sp > max * 0.7 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

// XML minimal : suffisant pour les flux RSS Teamtailor et XML Personio.
function unwrap(raw) {
    const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    return cdata ? cdata[1] : decodeEntities(raw);
}

export function xmlBlocks(xml, tag) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
    const out = [];
    let m;
    while ((m = re.exec(xml))) out.push(m[1]);
    return out;
}

export function xmlText(block, tag) {
    const b = xmlBlocks(block, tag)[0];
    return b === undefined ? null : unwrap(b).trim();
}

export function xmlTexts(block, tag) {
    return xmlBlocks(block, tag).map((b) => unwrap(b).trim()).filter(Boolean);
}

export function toIso(value) {
    if (value === null || value === undefined || value === '') return null;
    const d = typeof value === 'number' ? new Date(value) : new Date(String(value).replace(' UTC', 'Z').replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function clean(s) {
    if (s === null || s === undefined) return null;
    const t = String(s).replace(/\s+/g, ' ').trim();
    return t || null;
}

// Exécute fn sur chaque élément avec au plus `limit` tâches simultanées.
export async function mapPool(items, limit, fn) {
    const results = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx], idx);
        }
    });
    await Promise.all(workers);
    return results;
}
