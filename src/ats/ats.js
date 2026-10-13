// Lecture des API publiques des ATS et normalisation vers un format commun.
import { clean, htmlToText, mapPool, toIso, truncate, xmlBlocks, xmlText, xmlTexts } from './util.js';

export const ATS_NAMES = ['greenhouse', 'lever', 'ashby', 'recruitee', 'workable', 'smartrecruiters', 'teamtailor', 'personio'];

const REMOTE_RE = /\b(remote|télétravail|teletravail|home ?office|anywhere|fully distributed)\b/i;
const HYBRID_RE = /\b(hybrid|hybride|híbrido|hibrido|ibrido)\b/i;

// Départements Greenhouse préfixés d'un code interne : « 8611 Security Analytics » → « Security Analytics ».
export function cleanDepartment(name) {
    const s = clean(name);
    if (!s) return null;
    const stripped = s.replace(/^\d{3,}\s*[-–—:.|]?\s+(?=\S)/, '');
    return stripped || s;
}

function finalize(job, opts) {
    const out = { ...job };
    if (out.workplaceType) out.workplaceType = normWorkplace(out.workplaceType);
    if (out.remote === null || out.remote === undefined) {
        if (out.workplaceType) out.remote = out.workplaceType === 'remote';
        else if (out.location && REMOTE_RE.test(out.location)) out.remote = true;
        else if (out.location && HYBRID_RE.test(out.location)) {
            out.remote = false;
            out.workplaceType = 'hybrid';
        }
        else if (out.title && REMOTE_RE.test(out.title)) out.remote = true;
        else out.remote = null;
    }
    if (!out.workplaceType && out.remote === true) out.workplaceType = 'remote';
    out.employmentType = normEmployment(out.employmentType);
    if (opts.includeDescription) {
        out.description = truncate(out.descriptionText || '', opts.descriptionMaxLength) || null;
    }
    delete out.descriptionText;
    return out;
}

export function normWorkplace(v) {
    if (!v) return null;
    const s = String(v).toLowerCase().replace(/[^a-z]/g, '');
    if (s.includes('remote') || s === 'telecommute') return 'remote';
    if (s.includes('hybrid')) return 'hybrid';
    if (s.includes('onsite') || s.includes('office') || s === 'inperson') return 'onsite';
    return null;
}

export function normEmployment(v) {
    if (!v) return null;
    const s = String(v).toLowerCase().replace(/[^a-z]/g, '');
    if (s.includes('unbefristet')) return 'full-time';
    if (s.includes('intern') || s.includes('stage') || s.includes('praktikum')) return 'internship';
    if (s.includes('apprentice') || s.includes('ausbildung') || s.includes('trainee')) return 'apprenticeship';
    if (s.includes('student')) return 'working-student';
    if (s.includes('parttime') || s.includes('teilzeit')) return 'part-time';
    if (s.includes('temp') || s.includes('contract') || s.includes('freelance') || s.includes('fixedterm') || s.includes('befristet')) return 'contract';
    if (s.includes('fulltime') || s.includes('permanent') || s.includes('vollzeit') || s.includes('festanstellung')) return 'full-time';
    return clean(v);
}

// ---------- Parseurs purs (testés hors réseau) ----------

export function parseGreenhouse(data, { slug, departmentsById = new Map(), companyName } = {}) {
    return (data?.jobs || []).map((j) => ({
        company: companyName || clean(j.company_name) || slug,
        jobId: String(j.id),
        title: clean(j.title),
        department: cleanDepartment(j.departments?.[0]?.name) || cleanDepartment(departmentsById.get(j.id)) || null,
        team: null,
        location: clean(j.location?.name),
        workplaceType: null,
        remote: null,
        employmentType: null,
        postedAt: toIso(j.first_published || j.updated_at),
        url: j.absolute_url || null,
        descriptionText: j.content ? htmlToText(j.content) : '',
    }));
}

export function greenhouseDepartmentMap(data) {
    const map = new Map();
    for (const d of data?.departments || []) for (const j of d.jobs || []) if (!map.has(j.id)) map.set(j.id, d.name);
    return map;
}

export function parseLever(data, { slug, eu } = {}) {
    return (Array.isArray(data) ? data : []).map((j) => ({
        company: slug,
        jobId: j.id,
        title: clean(j.text),
        department: clean(j.categories?.department) || clean(j.categories?.team),
        team: clean(j.categories?.team),
        location: clean(j.categories?.location) || clean((j.categories?.allLocations || []).join(' / ')),
        workplaceType: j.workplaceType && j.workplaceType !== 'unspecified' ? j.workplaceType : null,
        remote: null,
        employmentType: clean(j.categories?.commitment),
        postedAt: toIso(j.createdAt),
        url: j.hostedUrl || `https://jobs.${eu ? 'eu.' : ''}lever.co/${slug}/${j.id}`,
        descriptionText: [j.descriptionPlain, ...(j.lists || []).map((l) => `${l.text}\n${htmlToText(l.content)}`), j.additionalPlain].filter(Boolean).join('\n\n'),
    }));
}

export function parseAshby(data, { slug } = {}) {
    return (data?.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
        company: slug,
        jobId: j.id || j.jobUrl,
        title: clean(j.title),
        department: clean(j.department),
        team: clean(j.team),
        location: clean([j.location, ...(j.secondaryLocations || []).map((l) => l.location)].filter(Boolean).join(' / ')),
        workplaceType: j.workplaceType || null,
        remote: typeof j.isRemote === 'boolean' ? j.isRemote : null,
        employmentType: clean(j.employmentType),
        postedAt: toIso(j.publishedAt),
        url: j.jobUrl || null,
        descriptionText: j.descriptionPlain || htmlToText(j.descriptionHtml),
    }));
}

export function parseRecruitee(data, { slug } = {}) {
    return (data?.offers || []).filter((o) => !o.status || o.status === 'published').map((o) => {
        const wp = o.remote ? 'remote' : o.hybrid ? 'hybrid' : o.on_site ? 'onsite' : null;
        return {
            company: clean(o.company_name) || slug,
            jobId: String(o.id),
            title: clean(o.title),
            department: clean(o.department),
            team: null,
            location: clean(o.location) || clean([o.city, o.country].filter(Boolean).join(', ')),
            workplaceType: wp,
            remote: typeof o.remote === 'boolean' ? o.remote : null,
            employmentType: clean(o.employment_type_code),
            postedAt: toIso(o.published_at || o.created_at),
            url: o.careers_url || `https://${slug}.recruitee.com/o/${o.slug}`,
            descriptionText: [htmlToText(o.description), htmlToText(o.requirements)].filter(Boolean).join('\n\n'),
        };
    });
}

export function parseWorkable(data, { slug } = {}) {
    return (data?.jobs || []).map((j) => {
        const loc = j.locations?.length
            ? j.locations.map((l) => [l.city, l.region, l.country].filter(Boolean).join(', ')).filter(Boolean).join(' / ')
            : [j.city, j.state, j.country].filter(Boolean).join(', ');
        return {
            company: clean(data.name) || slug,
            jobId: j.shortcode,
            title: clean(j.title),
            department: clean(j.department) || clean(j.function),
            team: null,
            location: clean(loc),
            workplaceType: j.telecommuting ? 'remote' : null,
            remote: j.telecommuting === true ? true : null,
            employmentType: clean(j.employment_type),
            postedAt: toIso(j.published_on || j.created_at),
            url: j.url || j.shortlink || `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
            descriptionText: htmlToText(j.description),
        };
    });
}

export function parseSmartRecruiters(data, { slug } = {}) {
    return (data?.content || []).map((j) => {
        const l = j.location || {};
        return {
            company: clean(j.company?.name) || slug,
            jobId: String(j.id),
            title: clean(j.name),
            department: clean(j.department?.label) || clean(j.function?.label),
            team: null,
            location: clean(l.fullLocation) || clean([l.city, l.region, l.country?.toUpperCase()].filter(Boolean).join(', ')),
            workplaceType: l.remote ? 'remote' : l.hybrid ? 'hybrid' : l.remote === false ? 'onsite' : null,
            remote: typeof l.remote === 'boolean' ? l.remote : null,
            employmentType: clean(j.typeOfEmployment?.label),
            postedAt: toIso(j.releasedDate),
            url: `https://jobs.smartrecruiters.com/${encodeURIComponent(j.company?.identifier || slug)}/${j.id}`,
            descriptionText: '',
            _ref: j.ref,
        };
    });
}

export function parseTeamtailor(xml, { slug } = {}) {
    const channelTitle = clean(xmlText(xml.split('<item')[0], 'title'));
    const company = channelTitle ? channelTitle.replace(/\s*[-–|:]\s*(jobs?|careers?|karriere|emplois?).*$/i, '').replace(/^(jobs?|careers?)\s+(at|bei|chez)\s+/i, '') : slug;
    return xmlBlocks(xml, 'item').map((it) => {
        const link = xmlText(it, 'link');
        const locs = xmlBlocks(it, 'tt:location').map((b) => clean([xmlText(b, 'tt:city'), xmlText(b, 'tt:country')].filter(Boolean).join(', '))).filter(Boolean);
        const remoteStatus = xmlText(it, 'remoteStatus') || xmlText(it, 'tt:remoteStatus');
        return {
            company: company || slug,
            jobId: xmlText(it, 'guid') || link,
            title: clean(xmlText(it, 'title')),
            department: clean(xmlText(it, 'tt:department')) || clean(xmlText(it, 'department')),
            team: null,
            location: clean(locs.join(' / ')),
            workplaceType: remoteStatus && remoteStatus !== 'none' ? (remoteStatus === 'fully' ? 'remote' : remoteStatus === 'hybrid' ? 'hybrid' : remoteStatus) : remoteStatus === 'none' ? 'onsite' : null,
            remote: remoteStatus ? remoteStatus === 'fully' : null,
            employmentType: clean(xmlText(it, 'tt:employmentType')),
            postedAt: toIso(xmlText(it, 'pubDate')),
            url: link,
            descriptionText: htmlToText(xmlText(it, 'description')),
        };
    });
}

export function parsePersonio(xml, { slug, host } = {}) {
    return xmlBlocks(xml, 'position').map((p) => {
        const head = p.replace(/<jobDescriptions>[\s\S]*?<\/jobDescriptions>/i, '').replace(/<additionalOffices>[\s\S]*?<\/additionalOffices>/i, '');
        const id = xmlText(head, 'id');
        const offices = [xmlText(head, 'office'), ...xmlTexts(xmlBlocks(p, 'additionalOffices')[0] || '', 'office')].filter(Boolean);
        const descs = xmlBlocks(p, 'jobDescription').map((d) => {
            const name = xmlText(d, 'name');
            const value = htmlToText(xmlText(d, 'value'));
            return [name, value].filter(Boolean).join('\n');
        });
        return {
            company: clean(xmlText(head, 'subcompany')) || slug,
            jobId: id,
            title: clean(xmlText(head, 'name')),
            department: clean(xmlText(head, 'department')) || clean(xmlText(head, 'recruitingCategory')),
            team: null,
            location: clean([...new Set(offices)].join(' / ')),
            workplaceType: null,
            remote: null,
            employmentType: clean(xmlText(head, 'schedule')) || clean(xmlText(head, 'employmentType')),
            postedAt: toIso(xmlText(head, 'createdAt')),
            url: `https://${host || `${slug}.jobs.personio.de`}/job/${id}`,
            descriptionText: descs.join('\n\n'),
        };
    });
}

// ---------- Lecture réseau ----------

// Renvoie { company, total, jobs } ; jobs = null si l'entreprise n'existe pas sur cet ATS.
export async function fetchAts(http, ats, id, opts = {}) {
    const slug = id;
    const max = opts.maxJobsPerCompany > 0 ? opts.maxJobsPerCompany : Infinity;
    let jobs;
    let total;
    switch (ats) {
        case 'greenhouse': {
            const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`;
            const data = await http.json(`${base}/jobs${opts.includeDescription ? '?content=true' : ''}`);
            if (!data) return null;
            let deps = new Map();
            if (!opts.includeDescription && data.jobs?.length && !opts.probe) {
                deps = greenhouseDepartmentMap(await http.json(`${base}/departments`).catch(() => null));
            }
            jobs = parseGreenhouse(data, { slug, departmentsById: deps });
            break;
        }
        case 'lever': {
            let eu = false;
            let data = await http.json(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
            if (!data || !Array.isArray(data)) {
                data = await http.json(`https://api.eu.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
                eu = true;
            }
            if (!data || !Array.isArray(data)) return null;
            jobs = parseLever(data, { slug, eu });
            break;
        }
        case 'ashby': {
            const data = await http.json(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
            if (!data || !Array.isArray(data.jobs)) return null;
            jobs = parseAshby(data, { slug });
            break;
        }
        case 'recruitee': {
            const data = await http.json(`https://${slug}.recruitee.com/api/offers/`);
            if (!data || !Array.isArray(data.offers)) return null;
            jobs = parseRecruitee(data, { slug });
            break;
        }
        case 'workable': {
            const data = await http.json(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}${opts.includeDescription ? '?details=true' : ''}`);
            if (!data || !Array.isArray(data.jobs)) return null;
            jobs = parseWorkable(data, { slug });
            break;
        }
        case 'smartrecruiters': {
            const pageSize = 100;
            const limit = Number.isFinite(max) ? Math.max(max, pageSize) : 1000;
            jobs = [];
            for (let offset = 0; offset < limit; offset += pageSize) {
                const data = await http.json(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=${pageSize}&offset=${offset}`);
                if (!data || !Array.isArray(data.content)) return offset === 0 ? null : { company: jobs[0]?.company || slug, total, jobs };
                total = data.totalFound;
                jobs.push(...parseSmartRecruiters(data, { slug }));
                if (opts.probe || data.content.length < pageSize || jobs.length >= total) break;
            }
            if (!total) return opts.probe ? null : { company: slug, total: 0, jobs: [] };
            break;
        }
        case 'teamtailor': {
            const origin = /^https?:\/\//.test(slug) ? slug.replace(/\/+$/, '') : `https://${slug}.teamtailor.com`;
            const res = await http.xml(`${origin}/jobs.rss`);
            if (!res || !/<rss|<channel/i.test(res.text)) return null;
            jobs = parseTeamtailor(res.text, { slug });
            break;
        }
        case 'personio': {
            for (const tld of ['de', 'com']) {
                const host = `${slug}.jobs.personio.${tld}`;
                const res = await http.xml(`https://${host}/xml`);
                if (res && /<workzag-jobs|<position/i.test(res.text)) {
                    jobs = parsePersonio(res.text, { slug, host });
                    break;
                }
                if (res && /<workzag-jobs/i.test(res.text)) {
                    jobs = [];
                    break;
                }
            }
            if (!jobs) return null;
            break;
        }
        default:
            throw new Error(`Unknown ATS: ${ats}`);
    }
    total = total ?? jobs.length;
    const company = jobs[0]?.company || slug;
    if (opts.probe) return { company, total, jobs: [] };
    return { company, total, jobs };
}

// Complète les descriptions SmartRecruiters (un appel par offre, uniquement pour les offres gardées).
export async function enrichSmartRecruiters(http, jobs) {
    await mapPool(jobs, 5, async (j) => {
        if (!j._ref) return;
        const d = await http.json(j._ref).catch(() => null);
        const s = d?.jobAd?.sections || {};
        j.descriptionText = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
            .map((k) => (s[k]?.text ? [s[k].title, htmlToText(s[k].text)].filter(Boolean).join('\n') : ''))
            .filter(Boolean)
            .join('\n\n');
    });
}

export function toOutputJobs(jobs, ctx, opts) {
    return jobs.map((j) => {
        const { _ref, ...rest } = j;
        const f = finalize(rest, opts);
        return {
            company: ctx.company || f.company,
            ats: ctx.ats,
            atsCompanyId: ctx.id,
            jobId: f.jobId,
            title: f.title,
            department: f.department,
            team: f.team,
            location: f.location,
            remote: f.remote,
            workplaceType: f.workplaceType,
            employmentType: f.employmentType,
            postedAt: f.postedAt,
            url: f.url,
            ...(opts.includeDescription ? { description: f.description } : {}),
            input: ctx.input,
            scrapedAt: ctx.scrapedAt,
        };
    });
}

// Résumé « hiring signal » calculé sur toutes les offres lues (pas seulement celles poussées).
export function hiringSignal(allJobs, ctx, opts, now = new Date()) {
    const norm = allJobs.map((j) => finalize({ ...j }, { includeDescription: false }));
    const byDep = new Map();
    const wp = { remote: 0, hybrid: 0, onsite: 0, unknown: 0 };
    let last30 = 0;
    let newest = null;
    for (const j of norm) {
        const d = j.department || '(unspecified)';
        byDep.set(d, (byDep.get(d) || 0) + 1);
        wp[j.workplaceType || 'unknown'] = (wp[j.workplaceType || 'unknown'] || 0) + 1;
        if (j.postedAt) {
            if (!newest || j.postedAt > newest) newest = j.postedAt;
            if (now - new Date(j.postedAt) <= 30 * 86400000) last30++;
        }
    }
    const byDepartment = [...byDep.entries()].map(([department, openJobs]) => ({ department, openJobs })).sort((a, b) => b.openJobs - a.openJobs || a.department.localeCompare(b.department));
    return {
        recordType: 'hiring_signal',
        company: ctx.company,
        ats: ctx.ats,
        atsCompanyId: ctx.id,
        status: 'ok',
        detectionMethod: ctx.detectionMethod,
        openJobs: ctx.total ?? norm.length,
        jobsAnalyzed: norm.length,
        jobsReturned: ctx.returned ?? 0,
        departments: byDepartment.length,
        byDepartment,
        byWorkplaceType: wp,
        postedLast30Days: last30,
        newestPostedAt: newest,
        input: ctx.input,
        scrapedAt: ctx.scrapedAt,
    };
}
