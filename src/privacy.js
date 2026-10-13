// Aucune donnée personnelle ne sort du serveur : les descriptions d'offres contiennent parfois
// l'e-mail, le téléphone ou le profil du recruteur. On les masque avant de répondre.

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
const MAILTO_RE = /mailto:\S+/gi;
// Téléphones au format international (« +33 6 12 34 56 78 », « +1 (415) 555-0100 »).
const PHONE_RE = /\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,6}/g;
const URL_END = `[^\\s)\\]>"'<,;]*`;
const PERSONAL_URL_RE = new RegExp(
    '(?:https?:\\/\\/)?(?:[a-z]{2,3}\\.)?(?:'
    + `linkedin\\.com\\/(?:in|pub)\\/${URL_END}`
    + `|(?:twitter|x)\\.com\\/(?!(?:home|search|intent|share|hashtag|i)\\b)[A-Za-z0-9_]{1,15}${URL_END}`
    + `|calendly\\.com\\/${URL_END}`
    + `|cal\\.com\\/${URL_END}`
    + `|t\\.me\\/${URL_END}`
    + `|wa\\.me\\/${URL_END}`
    + ')',
    'gi',
);

export function isPersonalUrl(url) {
    if (!url) return false;
    PERSONAL_URL_RE.lastIndex = 0;
    return PERSONAL_URL_RE.test(String(url)) || /^mailto:/i.test(String(url));
}

export function redactPersonal(text) {
    if (text === null || text === undefined) return text;
    return String(text)
        .replace(MAILTO_RE, '[redacted]')
        .replace(PERSONAL_URL_RE, '[redacted]')
        .replace(EMAIL_RE, '[redacted]')
        .replace(PHONE_RE, '[redacted]');
}

// Nettoie une offre de sortie : textes libres masqués, URL personnelle supprimée.
export function sanitizeJob(job) {
    const out = { ...job };
    for (const k of ['title', 'description', 'department', 'team', 'location']) {
        if (typeof out[k] === 'string') out[k] = redactPersonal(out[k]);
    }
    if (isPersonalUrl(out.url)) out.url = null;
    return out;
}
