#!/usr/bin/env node
// Serveur MCP (stdio) : offres d'emploi publiques des ATS.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createHttp } from './ats/http.js';
import { ATS_NAMES, detectAts, hiringSignals, searchCompanyJobs } from './tools.js';

export const VERSION = '0.1.0';

export function createContext() {
    const proxy = process.env.ATS_MCP_PROXY_URL || null;
    const getProxyUrl = async () => proxy;
    return {
        http: createHttp({ getProxyUrl, retries: 2, timeoutMs: 20000 }),
        probeHttp: createHttp({ getProxyUrl, retries: 1, timeoutMs: 12000 }),
    };
}

const atsEnum = z.enum(ATS_NAMES);
const companyDesc = 'Company name ("Stripe"), domain ("stripe.com"), careers/ATS URL ("https://jobs.lever.co/spotify"), or "ats:board-id" ("greenhouse:stripe").';

function asResult(data) {
    return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
    };
}

function wrap(fn, ctx) {
    return async (args) => {
        try {
            return asResult(await fn(ctx, args));
        } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
        }
    };
}

export function createServer(ctx = createContext()) {
    const server = new McpServer({ name: 'ats-jobs-mcp', version: VERSION });

    server.registerTool('search_company_jobs', {
        title: 'Search a company\'s open jobs',
        description: `List the open jobs a company publishes on its public ATS job board (${ATS_NAMES.join(', ')}). `
            + 'Returns title, department, location, remote/workplace type, employment type, posting date and apply URL. '
            + 'Optional filters on keyword (title/department), location and remote. Personal contact details are redacted.',
        inputSchema: {
            company: z.string().min(1).describe(companyDesc),
            ats: atsEnum.optional().describe('Force one ATS when the company name is ambiguous.'),
            keyword: z.string().optional().describe('Words that must all appear in the job title or department, e.g. "data engineer".'),
            location: z.string().optional().describe('Text that must appear in the job location, e.g. "Berlin" or "Canada".'),
            remote_only: z.boolean().optional().describe('Only remote jobs.'),
            limit: z.number().int().min(1).max(200).optional().describe('Max jobs returned (default 25, max 200).'),
            include_description: z.boolean().optional().describe('Include the plain-text job description (slower, longer answer).'),
            description_max_length: z.number().int().min(100).max(10000).optional().describe('Max characters per description (default 1500).'),
        },
        annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    }, wrap(searchCompanyJobs, ctx));

    server.registerTool('detect_ats', {
        title: 'Detect which ATS a company uses',
        description: 'Find which applicant tracking system (ATS) a company uses for its public careers page, its board id, and how many jobs are open. '
            + `Detects ${ATS_NAMES.join(', ')} from the website links or by probing the ATS public APIs.`,
        inputSchema: {
            domain: z.string().min(1).describe('Company domain or website ("notion.so"), careers URL, or company name.'),
        },
        annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    }, wrap(detectAts, ctx));

    server.registerTool('hiring_signals', {
        title: 'Hiring signals for a company',
        description: 'Summarize a company\'s hiring activity from its public ATS job board: open jobs, jobs per department, remote/hybrid/onsite split, '
            + 'jobs posted in the last 30 days and newest posting date. Useful for sales prospecting and market research.',
        inputSchema: {
            company: z.string().min(1).describe(companyDesc),
            ats: atsEnum.optional().describe('Force one ATS when the company name is ambiguous.'),
        },
        annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
    }, wrap(hiringSignals, ctx));

    return server;
}

let isMain = false;
try { isMain = !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { /* REPL */ }
if (isMain) {
    const server = createServer();
    await server.connect(new StdioServerTransport());
}
