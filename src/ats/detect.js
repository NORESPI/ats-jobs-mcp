// Détection de l'ATS : identifiant explicite, URL d'ATS, page carrières, puis devinette par le nom de domaine.
import { ATS_NAMES } from './ats.js';

const BAD_SLUGS = new Set(['www', 'api', 'app', 'apply', 'assets', 'cdn', 'static', 'embed', 'images', 'img', 'media', 'jobs', 'widget', 'js', 'css', 'eu', 'boards', 'job-boards', 'v1', 'v0', 'posting-api', 'careers', 'help', 'support', 'blog', 'status', 'docs', 'login', 'signup', 'favicon.ico', 'robots.txt']);

const PATTERNS = [
    ['greenhouse', /boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)/i],
    ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/embed\/job_board(?:\/js)?\?(?:[^"'\s]*&(?:amp;)?)?for=([A-Za-z0-9_-]+)/i],
    ['greenhouse', /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([A-Za-z0-9_-]+)/i],
    ['lever', /api\.(?:eu\.)?lever\.co\/v0\/postings\/([A-Za-z0-9_.-]+)/i],
    ['lever', /jobs\.(?:eu\.)?lever\.co\/([A-Za-z0-9_.-]+)/i],
    ['ashby', /api\.ashbyhq\.com\/posting-api\/job-board\/([A-Za-z0-9_.-]+)/i],
    ['ashby', /jobs\.ashbyhq\.com\/([A-Za-z0-9_.%-]+)/i],
    ['recruitee', /\/\/([a-z0-9-]+)\.recruitee\.com/i],
    ['workable', /apply\.workable\.com\/api\/v\d\/(?:widget\/)?accounts\/([A-Za-z0-9_-]+)/i],
    ['workable', /apply\.workable\.com\/([A-Za-z0-9_-]+)/i],
    ['workable', /\/\/([a-z0-9-]+)\.workable\.com/i],
    ['smartrecruiters', /api\.smartrecruiters\.com\/v1\/companies\/([A-Za-z0-9_-]+)/i],
    ['smartrecruiters', /(?:jobs|careers)\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i],
    ['teamtailor', /\/\/([a-z0-9-]+)\.teamtailor\.com/i],
    ['personio', /\/\/([a-z0-9-]+)\.jobs\.personio\.(?:de|com)/i],
];

// Cherche dans un texte (URL ou HTML) toutes les références à un ATS ; renvoie [{ats, id}] uniques.
export function findAtsRefs(text) {
    const found = [];
    const seen = new Set();
    for (const [ats, re] of PATTERNS) {
        const g = new RegExp(re.source, 'gi');
        let m;
        while ((m = g.exec(text))) {
            let id = decodeURIComponent(m[1]).replace(/[.]+$/, '');
            if (ats !== 'smartrecruiters' && ats !== 'ashby') id = id.toLowerCase();
            if (!id || BAD_SLUGS.has(id.toLowerCase())) continue;
            const key = `${ats}:${id.toLowerCase()}`;
            if (seen.has(key)) continue;
            // une référence générique à un même ATS ne doit pas doubler une référence déjà trouvée
            seen.add(key);
            found.push({ ats, id });
        }
    }
    return found;
}

// Teamtailor sur domaine personnalisé (ex. careers.exemple.com) : marqueurs dans le HTML.
export function looksLikeTeamtailor(html) {
    return /teamtailor-cdn\.com|assets\.teamtailor|content="Teamtailor"|data-teamtailor|teamtailor\.com\/assets/i.test(html);
}

export function parseCompanyInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const explicit = s.match(/^([a-z]+)\s*:\s*([^\s/]+)$/i);
    if (explicit && ATS_NAMES.includes(explicit[1].toLowerCase())) {
        return { kind: 'explicit', ats: explicit[1].toLowerCase(), id: explicit[2] };
    }
    const asUrl = /^https?:\/\//i.test(s) ? s : `https://${s}`;
    let url;
    try {
        url = new URL(asUrl);
    } catch {
        return { kind: 'invalid', raw: s };
    }
    if (!url.hostname.includes('.')) return { kind: 'invalid', raw: s };
    const refs = findAtsRefs(url.href);
    if (refs.length) return { kind: 'ats-url', ats: refs[0].ats, id: refs[0].id, url: url.href };
    return { kind: 'site', url: url.href, hostname: url.hostname.replace(/^www\./, ''), hasPath: url.pathname.length > 1 };
}

// « careers.acme-corp.co.uk » -> ['acme-corp', 'acmecorp']
export function slugGuesses(hostname) {
    const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
    const SECOND = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);
    let label;
    if (parts.length >= 3 && SECOND.has(parts[parts.length - 2])) label = parts[parts.length - 3];
    else label = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const out = [label];
    if (label.includes('-')) out.push(label.replace(/-/g, ''));
    return [...new Set(out)].filter((x) => x && x.length >= 2);
}

const CAREER_LINK_RE = /href=["']([^"'#]*?(?:career|karriere|jobs?\b|jobs\/|join-us|joinus|join|work-with-us|vacatures|vacancies|emplois?|carrieres?|carri%C3%A8res|stellen|offres)[^"']*)["']/gi;

export function careerLinks(html, baseUrl, max = 3) {
    const links = [];
    let m;
    const re = new RegExp(CAREER_LINK_RE.source, 'gi');
    while ((m = re.exec(html)) && links.length < 20) {
        try {
            const u = new URL(m[1].replace(/&amp;/g, '&'), baseUrl);
            if (!/^https?:$/.test(u.protocol)) continue;
            if (/\.(png|jpe?g|svg|css|js|pdf|webp)(\?|$)/i.test(u.pathname)) continue;
            if (!links.includes(u.href)) links.push(u.href);
        } catch { /* lien invalide */ }
    }
    // priorité aux liens les plus courts (souvent la page principale « /careers »)
    return links.sort((a, b) => a.length - b.length).slice(0, max);
}

// Lit une page et renvoie la première référence ATS trouvée (ou Teamtailor sur domaine propre).
async function scanPage(http, url) {
    const res = await http.text(url).catch(() => null);
    if (!res?.text) return { ref: null, html: '' };
    const refs = findAtsRefs(`${res.finalUrl}\n${res.text}`);
    if (refs.length) return { ref: refs[0], html: res.text, finalUrl: res.finalUrl };
    if (looksLikeTeamtailor(res.text)) {
        const origin = new URL(res.finalUrl).origin;
        return { ref: { ats: 'teamtailor', id: origin }, html: res.text, finalUrl: res.finalUrl };
    }
    return { ref: null, html: res.text, finalUrl: res.finalUrl };
}

export async function detectFromSite(http, parsed, { fetchAts, guessFromDomain = true, log = () => {} } = {}) {
    // 1. page fournie (ou page d'accueil), 2. liens « carrières » de cette page, 3. chemins usuels
    const first = await scanPage(http, parsed.url);
    if (first.ref) return { ...first.ref, detectionMethod: 'careers-page' };
    const tried = new Set([parsed.url]);
    const candidates = careerLinks(first.html, first.finalUrl || parsed.url);
    if (!parsed.hasPath) {
        const origin = new URL(parsed.url).origin;
        for (const p of ['/careers', '/jobs']) candidates.push(origin + p);
    }
    for (const u of candidates.slice(0, 4)) {
        if (tried.has(u)) continue;
        tried.add(u);
        const r = await scanPage(http, u);
        if (r.ref) return { ...r.ref, detectionMethod: 'careers-page' };
    }
    if (!guessFromDomain || !fetchAts) return null;
    // 4. devinette : le nom de domaine comme identifiant sur chaque ATS ; on garde celui qui a le plus d'offres
    log(`No ATS link found on ${parsed.hostname}, trying the domain name as board id.`);
    const probes = [];
    for (const slug of slugGuesses(parsed.hostname)) {
        for (const ats of ATS_NAMES) {
            const ids = ats === 'smartrecruiters' ? [...new Set([slug, slug[0].toUpperCase() + slug.slice(1)])] : [slug];
            for (const id of ids) probes.push({ ats, id });
        }
    }
    const results = await Promise.all(probes.map(async (p) => {
        const r = await fetchAts(http, p.ats, p.id, { probe: true }).catch(() => null);
        return r && r.total > 0 ? { ...p, total: r.total } : null;
    }));
    const best = results.filter(Boolean).sort((a, b) => b.total - a.total)[0];
    return best ? { ats: best.ats, id: best.id, detectionMethod: 'domain-guess' } : null;
}
