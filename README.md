# ATS Jobs MCP Server: company job openings from Greenhouse, Lever, Ashby and 5 more ATS

An MCP server that lets Claude, Cursor or any MCP client read the **open jobs a company publishes on its public careers board**, **detect which ATS a company uses**, and get **hiring signals** (open roles, departments, remote split, new postings), all live from the ATS's own public job-board API.

Supported ATS (8): **Greenhouse, Lever, Ashby, Recruitee, Workable, SmartRecruiters, Teamtailor, Personio**.

No API key, no login, no browser. Plain HTTP calls to public job-board endpoints.

## What it's for

- **Sales & business development**: "Is Notion hiring data engineers? How many people in sales?" Hiring is a buying signal.
- **Recruiters & sourcers**: list a target company's open roles, filtered by keyword, location or remote.
- **Job seekers**: ask your assistant to check the careers pages of 10 companies you like.
- **Market & competitor research**: compare hiring by department, track new postings over the last 30 days.
- **Agents**: a structured, fast tool instead of browsing careers pages.

## Tools

| Tool | What it does | Main inputs |
|---|---|---|
| `search_company_jobs` | Lists a company's open jobs | `company` (name, domain, careers/ATS URL or `ats:board-id`), `ats?`, `keyword?`, `location?`, `remote_only?`, `limit?` (1–200, default 25), `include_description?`, `description_max_length?` (100–10 000, default 1 500) |
| `detect_ats` | Finds the ATS, its board id and the number of open jobs | `domain` (domain, careers URL or company name) |
| `hiring_signals` | Summarizes hiring activity | `company`, `ats?` |

All tools are read-only and only call public endpoints.

### How the company is found

1. `ats:board-id` (e.g. `greenhouse:stripe`, `lever:spotify`) is used as is (fastest and most reliable).
2. An ATS job-board URL (e.g. `https://jobs.ashbyhq.com/notion`) is parsed.
3. A domain or careers page (e.g. `notion.so`) is read to find the ATS link.
4. A company name (e.g. `stripe`) is tried as a board id on each ATS.

## Example

Prompt: *"Which remote engineering jobs is Stripe hiring for?"*

`search_company_jobs {"company": "greenhouse:stripe", "keyword": "engineer", "limit": 5}` returns:

```json
{
  "found": true,
  "company": "Stripe",
  "ats": "greenhouse",
  "boardId": "stripe",
  "openJobs": 721,
  "matchingJobs": 163,
  "returned": 5,
  "jobs": [
    {
      "company": "Stripe",
      "ats": "greenhouse",
      "atsCompanyId": "stripe",
      "jobId": "8172503",
      "title": "Abuse Research Engineer",
      "department": "Security Analytics",
      "team": null,
      "location": "Remote from the US",
      "remote": true,
      "workplaceType": "remote",
      "employmentType": null,
      "postedAt": "2026-09-09T14:52:09.000Z",
      "url": "https://stripe.com/jobs/search?gh_jid=8172503"
    }
  ]
}
```

`hiring_signals` returns `openJobs`, `jobsAnalyzed`, `departments`, `byDepartment`, `byWorkplaceType` (remote / hybrid / onsite / unknown), `postedLast30Days` and `newestPostedAt`.

`detect_ats {"domain": "notion.so"}` returns `{"found": true, "ats": "ashby", "boardId": "notion", "openJobs": 130, ...}`.

(Figures from a real call on 2026-10-12; they change every day.)

## Install (local, stdio)

Requires Node.js 22 or later.

```bash
cd ats-jobs-mcp
npm install
npm test
```

Claude Desktop / Cursor configuration:

```json
{
  "mcpServers": {
    "ats-jobs": {
      "command": "node",
      "args": ["/path/to/ats-jobs-mcp/src/server.js"]
    }
  }
}
```

## Pricing

- **Local (stdio)**: free.
- **Hosted on Apify (MCP over HTTP)**: planned, pay per tool call, target **$0.005 per call** (i.e. $5 per 1,000 calls). Price to be confirmed at launch.
- **Bulk data** (thousands of companies, scheduled runs, datasets/CSV): use the Apify Actor **ATS Jobs by Company** (`ats-jobs-by-company`), target $1 per 1,000 jobs.

## Privacy

Only public company job postings are returned. No candidate or employee data is collected. E-mail addresses, international phone numbers (+country code) and links to personal profiles (LinkedIn `/in/`, X/Twitter handles, Calendly, cal.com, Telegram, WhatsApp) that sometimes appear in job titles or descriptions are replaced by `[redacted]`.

## Limits (honest)

- Only companies that use one of the 8 supported ATS **with a public job board**. Workday, iCIMS, Taleo, SuccessFactors and in-house careers sites are not supported.
- Name guessing can miss when the board id differs from the company name (e.g. a brand vs. legal name) or pick a homonym. Use the domain or `ats:board-id` when in doubt; `detect_ats` shows `otherMatches` when several boards match.
- Some ATS don't publish everything: `postedAt`, `employmentType` or `remote` can be `null`.
- Data is live: each call queries the ATS (typically 0.4–2 s). Retries with increasing backoff; 25 s timeout per request.
- Descriptions are plain text, trimmed to `description_max_length`.

## FAQ

**Do I need an API key?** No. All endpoints are the ATS's public job-board APIs.

**Is this scraping?** It reads the JSON endpoints ATS vendors provide for public careers pages. No login, no CAPTCHA bypass, no browser.

**Can I search all jobs across all companies?** No, this server works company by company. For keyword search across many sources, use a job-board aggregator.

**Why did it return `found: false`?** The company doesn't use a supported ATS, or the name didn't match. Try the domain or the careers page URL.

**Which data is returned?** Title, department, team, location, remote flag, workplace type, employment type, posting date, job URL and optionally the description.
