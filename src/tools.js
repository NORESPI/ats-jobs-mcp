import { ATS_NAMES, enrichSmartRecruiters, fetchAts, hiringSignal, toOutputJobs } from './ats/ats.js';
import { detectFromSite, parseCompanyInput } from './ats/detect.js';
import { sanitizeJob } from './privacy.js';

export { ATS_NAMES };

// « Acme Corp » -> ['acme-corp', 'acmecorp'] ; « stripe » -> ['stripe']
export function nameSlugs(name) {
    const base = String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!base) return [];
    return [...new Set([base, base.replace(/-/g, '')])];
}

async function probeAll(http, slugs, atsList) {
    const probes = [];
    for (const slug of slugs) {
        for (const ats of atsList) {
            const ids = ats === 'smartrecruiters' ? [...new Set([slug, slug[0].toUpperCase() + slug.slice(1)])] : [slug];
            for (const id of ids) probes.push({ ats, id });
        }
    }
    const results = await Promise.all(probes.map(async (p) => {
        const r = await fetchAts(http, p.ats, p.id, { probe: true }).catch(() => null);
        return r && r.total > 0 ? { ...p, total: r.total } : null;
    }));
    return results.filter(Boolean).sort((a, b) => b.total - a.total);
}

/**
 * Trouve le tableau d'offres d'une entreprise.
 * company : nom (« Stripe »), domaine (« stripe.com »), URL d'ATS, ou « ats:id ».
 * Retourne { ats, id, detectionMethod, otherMatches? } ou null.
 */
export async function resolveCompany({ http, probeHttp = http }, company, ats) {
    const raw = String(company || '').trim();
    if (!raw) throw new Error('company is required');
    if (ats && !ATS_NAMES.includes(ats)) throw new Error(`Unknown ATS "${ats}". Supported: ${ATS_NAMES.join(', ')}`);
    const parsed = parseCompanyInput(raw);
    if (parsed.kind === 'explicit' || parsed.kind === 'ats-url') {
        return { ats: parsed.ats, id: parsed.id, detectionMethod: parsed.kind === 'explicit' ? 'explicit-id' : 'ats-url' };
    }
    if (ats) {
        // ATS imposé : on essaie le texte tel quel puis ses variantes
        const ids = parsed.kind === 'site' ? nameSlugs(parsed.hostname.split('.').slice(0, -1).join('-')) : [raw, ...nameSlugs(raw)];
        const found = await probeAll(probeHttp, [...new Set(ids)], [ats]);
        if (found.length) return { ats, id: found[0].id, detectionMethod: 'given-ats' };
        return null;
    }
    if (parsed.kind === 'site') {
        const r = await detectFromSite(probeHttp, parsed, { fetchAts });
        return r ? { ats: r.ats, id: r.id, detectionMethod: r.detectionMethod } : null;
    }
    // Nom seul : chaque ATS est interrogé avec le nom comme identifiant
    const found = await probeAll(probeHttp, nameSlugs(raw), ATS_NAMES);
    if (!found.length) return null;
    const [best, ...rest] = found;
    return {
        ats: best.ats,
        id: best.id,
        detectionMethod: 'name-guess',
        ...(rest.length ? { otherMatches: rest.slice(0, 5).map((r) => ({ ats: r.ats, id: r.id, openJobs: r.total })) } : {}),
    };
}

function notFound(company, ats) {
    return {
        found: false,
        company,
        message: `No public job board found for "${company}"${ats ? ` on ${ats}` : ''}. `
            + 'Try the company domain (e.g. "acme.com"), the careers page URL, or "ats:board-id" (e.g. "greenhouse:stripe"). '
            + `Supported ATS: ${ATS_NAMES.join(', ')}.`,
    };
}

function matches(job, { keyword, location, remoteOnly }) {
    if (keyword) {
        const hay = `${job.title || ''} ${job.department || ''} ${job.team || ''}`.toLowerCase();
        const words = keyword.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.every((w) => hay.includes(w))) return false;
    }
    if (location && !String(job.location || '').toLowerCase().includes(location.toLowerCase())) return false;
    if (remoteOnly && !(job.remote === true || job.workplaceType === 'remote')) return false;
    return true;
}

async function loadBoard(ctx, company, ats, opts = {}) {
    const target = await resolveCompany(ctx, company, ats);
    if (!target) return { target: null };
    const res = await fetchAts(ctx.http, target.ats, target.id, opts);
    return { target, res };
}

export async function searchCompanyJobs(ctx, args) {
    const { company, ats, keyword, location } = args;
    const remoteOnly = !!args.remote_only;
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 200);
    const includeDescription = !!args.include_description;
    const descriptionMaxLength = Math.min(Math.max(Number(args.description_max_length) || 1500, 100), 10000);
    const opts = { includeDescription, descriptionMaxLength };
    const { target, res } = await loadBoard(ctx, company, ats, opts);
    if (!target || !res) return notFound(company, ats);
    const scrapedAt = new Date().toISOString();
    const jobCtx = { company: res.company, ats: target.ats, id: target.id, input: company, scrapedAt };
    const all = toOutputJobs(res.jobs, jobCtx, { includeDescription: false });
    const keepIdx = [];
    all.forEach((j, i) => { if (keepIdx.length < limit && matches(j, { keyword, location, remoteOnly })) keepIdx.push(i); });
    const matchedCount = all.filter((j) => matches(j, { keyword, location, remoteOnly })).length;
    const kept = keepIdx.map((i) => res.jobs[i]);
    if (includeDescription && target.ats === 'smartrecruiters') await enrichSmartRecruiters(ctx.http, kept);
    const jobs = toOutputJobs(kept, jobCtx, opts).map(({ input, scrapedAt: _s, ...j }) => sanitizeJob(j));
    return {
        found: true,
        company: res.company,
        ats: target.ats,
        boardId: target.id,
        detectionMethod: target.detectionMethod,
        ...(target.otherMatches ? { otherMatches: target.otherMatches } : {}),
        openJobs: res.total,
        matchingJobs: matchedCount,
        returned: jobs.length,
        jobs,
        source: `Public job board of ${res.company} on ${target.ats}`,
        scrapedAt,
    };
}

export async function detectAts(ctx, args) {
    const target = await resolveCompany(ctx, args.domain);
    if (!target) return notFound(args.domain);
    const probe = await fetchAts(ctx.probeHttp || ctx.http, target.ats, target.id, { probe: true }).catch(() => null);
    return {
        found: true,
        input: args.domain,
        ats: target.ats,
        boardId: target.id,
        detectionMethod: target.detectionMethod,
        ...(target.otherMatches ? { otherMatches: target.otherMatches } : {}),
        openJobs: probe?.total ?? null,
        hint: `Use search_company_jobs with company "${target.ats}:${target.id}" to list the jobs.`,
    };
}

export async function hiringSignals(ctx, args) {
    const { target, res } = await loadBoard(ctx, args.company, args.ats, {});
    if (!target || !res) return notFound(args.company, args.ats);
    const scrapedAt = new Date().toISOString();
    const sig = hiringSignal(res.jobs, { company: res.company, ats: target.ats, id: target.id, input: args.company, scrapedAt, detectionMethod: target.detectionMethod, total: res.total, returned: 0 }, {});
    const { input, recordType, jobsReturned, ...rest } = sig;
    return { found: true, ...rest };
}
