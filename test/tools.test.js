import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { isPersonalUrl, redactPersonal, sanitizeJob } from '../src/privacy.js';
import { detectAts, hiringSignals, nameSlugs, resolveCompany, searchCompanyJobs } from '../src/tools.js';
import { createServer } from '../src/server.js';

const now = new Date().toISOString();
const ghJob = (id, title, location, dept, content = '') => ({
    id, title, absolute_url: `https://boards.greenhouse.io/acme/jobs/${id}`,
    location: { name: location }, updated_at: now, first_published: now,
    departments: [{ id: 1, name: dept }], offices: [], metadata: [], content,
});
const GH = {
    jobs: [
        ghJob(1, 'Senior Data Engineer', 'Remote - Canada', 'Engineering',
            '&lt;p&gt;Questions: jane.doe@acme.com or https://www.linkedin.com/in/jane-doe-123 or +1 (415) 555-0100. Salary 120 000 - 150 000.&lt;/p&gt;'),
        ghJob(2, 'Account Executive', 'Berlin, Germany', 'Sales'),
        ghJob(3, 'Data Analyst', 'Toronto, Canada', 'Engineering'),
        ghJob(4, 'Backend Engineer', 'Remote', 'Engineering'),
        ghJob(5, 'Office Manager', 'Berlin, Germany', 'Operations'),
    ],
    meta: { total: 5 },
};

// Faux client HTTP : seul greenhouse/acme existe, tout le reste rend 404 (null).
function fakeHttp(calls = []) {
    const handler = async (url) => {
        calls.push(url);
        if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/acme/jobs')) return GH;
        if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/acme/departments')) return null;
        if (url.startsWith('https://boards-api.greenhouse.io/v1/boards/acme')) return { name: 'Acme' };
        return null;
    };
    return { json: handler, text: handler, xml: handler };
}
const ctx = () => ({ http: fakeHttp(), probeHttp: fakeHttp() });

test('privacy: e-mails, personal profiles and phones are redacted', () => {
    const t = 'Write to jane.doe@acme.com, mailto:hr@acme.com, see linkedin.com/in/jane, x.com/janedoe, calendly.com/jane/30min, t.me/jane, wa.me/15551234, call +33 6 12 34 56 78.';
    const r = redactPersonal(t);
    for (const bad of ['jane.doe@acme.com', 'hr@acme.com', 'linkedin.com/in', 'x.com/janedoe', 'calendly', 't.me/', 'wa.me/', '+33']) {
        assert.ok(!r.includes(bad), `${bad} should be redacted: ${r}`);
    }
    assert.ok(redactPersonal('Salary 120 000 - 150 000 USD, 3+ years').includes('120 000 - 150 000'));
    assert.ok(isPersonalUrl('https://www.linkedin.com/in/someone'));
    assert.ok(!isPersonalUrl('https://www.linkedin.com/company/acme'));
    assert.ok(!isPersonalUrl('https://boards.greenhouse.io/acme/jobs/1'));
    assert.equal(sanitizeJob({ url: 'https://calendly.com/x' }).url, null);
});

test('nameSlugs', () => {
    assert.deepEqual(nameSlugs('Acme Corp'), ['acme-corp', 'acmecorp']);
    assert.deepEqual(nameSlugs('Stripe'), ['stripe']);
    assert.deepEqual(nameSlugs('Société Générale'), ['societe-generale', 'societegenerale']);
    assert.deepEqual(nameSlugs('  '), []);
});

test('resolveCompany: explicit id, ATS URL, name guess, unknown', async () => {
    assert.deepEqual(await resolveCompany(ctx(), 'lever:spotify'), { ats: 'lever', id: 'spotify', detectionMethod: 'explicit-id' });
    const url = await resolveCompany(ctx(), 'https://jobs.lever.co/spotify');
    assert.equal(url.ats, 'lever');
    assert.equal(url.id, 'spotify');
    const byName = await resolveCompany(ctx(), 'Acme');
    assert.equal(byName.ats, 'greenhouse');
    assert.equal(byName.id, 'acme');
    assert.equal(byName.detectionMethod, 'name-guess');
    assert.equal(await resolveCompany(ctx(), 'Nobody Here'), null);
    await assert.rejects(resolveCompany(ctx(), 'acme', 'workday'), /Unknown ATS/);
    await assert.rejects(resolveCompany(ctx(), ''), /required/);
});

test('search_company_jobs: filters, limit and redaction', async () => {
    const all = await searchCompanyJobs(ctx(), { company: 'greenhouse:acme' });
    assert.equal(all.found, true);
    assert.equal(all.openJobs, 5);
    assert.equal(all.returned, 5);
    for (const j of all.jobs) {
        assert.ok(j.title && j.url, 'title and url');
        assert.equal(j.description, undefined, 'no description by default');
    }

    const eng = await searchCompanyJobs(ctx(), { company: 'greenhouse:acme', keyword: 'engineer' });
    assert.deepEqual(eng.jobs.map((j) => j.title), ['Senior Data Engineer', 'Data Analyst', 'Backend Engineer']); // titre OU département

    const berlin = await searchCompanyJobs(ctx(), { company: 'greenhouse:acme', location: 'berlin', limit: 1 });
    assert.equal(berlin.matchingJobs, 2);
    assert.equal(berlin.returned, 1);

    const remote = await searchCompanyJobs(ctx(), { company: 'greenhouse:acme', remote_only: true });
    assert.ok(remote.jobs.length >= 1 && remote.jobs.every((j) => /remote/i.test(j.location)));

    const desc = await searchCompanyJobs(ctx(), { company: 'greenhouse:acme', keyword: 'senior', include_description: true });
    const d = desc.jobs[0].description;
    assert.ok(d && d.includes('Questions'), d);
    assert.ok(!/jane\.doe@|linkedin\.com\/in|555-0100/.test(d), d);
    assert.ok(d.includes('120 000 - 150 000'));
});

test('search_company_jobs: not found gives a helpful message', async () => {
    const r = await searchCompanyJobs(ctx(), { company: 'greenhouse:nobody' });
    assert.equal(r.found, false);
    assert.match(r.message, /Supported ATS/);
});

test('detect_ats and hiring_signals', async () => {
    const det = await detectAts(ctx(), { domain: 'Acme' });
    assert.equal(det.ats, 'greenhouse');
    assert.equal(det.openJobs, 5);
    const sig = await hiringSignals(ctx(), { company: 'greenhouse:acme' });
    assert.equal(sig.found, true);
    assert.equal(sig.openJobs, 5);
    assert.equal(sig.input, undefined);
});

test('MCP server: tools are listed and callable', async () => {
    const server = createServer(ctx());
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(ct);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['detect_ats', 'hiring_signals', 'search_company_jobs']);
    for (const t of tools) assert.equal(t.annotations.readOnlyHint, true);
    const r = await client.callTool({ name: 'search_company_jobs', arguments: { company: 'greenhouse:acme', limit: 2 } });
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.returned, 2);
    assert.equal(JSON.parse(r.content[0].text).returned, 2);
    const bad = await client.callTool({ name: 'search_company_jobs', arguments: { company: 'acme', ats: 'greenhouse', limit: 0 } });
    assert.equal(bad.isError, true);
    await client.close();
});
