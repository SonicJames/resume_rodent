#!/usr/bin/env node

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

dotenv.config();

const SONIC_JOBS_MCP_URL = process.env.SONICJOBS_MCP_URL || null;
const RESUME_RODENT_APP = (process.env.RESUME_RODENT_APP_URL || "http://localhost:4000").trim();
const MCP_SERVER_URL = (process.env.MCP_SERVER_URL || "https://resume-rodent-mcp-production.up.railway.app").trim();

// In-memory cache of job details keyed by job ID.
const jobCache = new Map();
// In-memory store of search result pages keyed by token.
const searchPages = new Map();
let pageCounter = 0;

function cacheJobs(jobs) {
  jobs.forEach((job) => jobCache.set(job.id, job));
  if (jobCache.size > 200) {
    const overflow = jobCache.size - 200;
    let i = 0;
    for (const key of jobCache.keys()) {
      if (i++ >= overflow) break;
      jobCache.delete(key);
    }
  }
}

function stripHtml(html) {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildResultsHtml(jobs) {
  const cards = jobs.map((job, i) => {
    const num = i + 1;
    const logoHtml = job.logo
      ? '<img class="logo" src="' + escHtml(job.logo) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="logo-placeholder">' + escHtml((job.company || "?")[0].toUpperCase()) + '</div>';
    const salaryHtml = job.salary
      ? '<span class="badge-sal">&#x1F4B0; ' + escHtml(job.salary) + '</span>'
      : "";
    const hasMore = job.fullDescription.length > job.summary.length;
    const toggleHtml = hasMore
      ? '<button class="btn-toggle" onclick="toggle(this)">Show full description &#9660;</button>'
      : "";
    const fullDescHtml = hasMore
      ? '<p class="full-desc">' + escHtml(job.fullDescription) + '</p>'
      : "";
    const applyUrl = RESUME_RODENT_APP + "?job_id=" + encodeURIComponent(job.id)
      + "&job_title=" + encodeURIComponent(job.title)
      + "&job_url=" + encodeURIComponent(job.url);

    return '<div class="card">'
      + '<div class="card-header">'
      + logoHtml
      + '<div><div class="title">[' + num + '] ' + escHtml(job.title) + '</div>'
      + '<div class="company">' + escHtml(job.company) + '</div></div>'
      + '</div>'
      + '<div class="badges">'
      + '<span class="badge-loc">&#x1F4CD; ' + escHtml(job.location) + '</span>'
      + salaryHtml
      + '</div>'
      + '<p class="summary">' + escHtml(job.summary) + (hasMore ? '&hellip;' : '') + '</p>'
      + fullDescHtml
      + '<div class="actions">'
      + toggleHtml
      + '<a href="' + escHtml(applyUrl) + '" class="btn-apply" target="_blank" rel="noopener">&#x1F3AF; Help Me Apply</a>'
      + '</div>'
      + '</div>';
  }).join("\n");

  return '<!DOCTYPE html>\n'
    + '<html lang="en">\n'
    + '<head>\n'
    + '<meta charset="utf-8">\n'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>Resume Rodent — Job Results</title>\n'
    + '<style>\n'
    + '*{box-sizing:border-box;margin:0;padding:0}\n'
    + 'body{background:#0f0f1a;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;padding:24px 16px;min-height:100vh}\n'
    + '.container{max-width:720px;margin:0 auto}\n'
    + 'h1{font-size:20px;margin-bottom:20px;font-weight:700;color:#e2e8f0}\n'
    + '.card{background:#1a1a2e;border:1px solid #2d2d4e;border-radius:12px;padding:18px 20px;margin-bottom:14px}\n'
    + '.card-header{display:flex;align-items:center;gap:12px;margin-bottom:10px}\n'
    + '.logo{width:42px;height:42px;border-radius:6px;object-fit:contain;background:#fff;padding:3px;flex-shrink:0}\n'
    + '.logo-placeholder{width:42px;height:42px;border-radius:6px;background:#2d2d4e;color:#94a3b8;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex-shrink:0}\n'
    + '.title{font-weight:700;font-size:15px;color:#e2e8f0;line-height:1.3}\n'
    + '.company{font-size:13px;color:#94a3b8;margin-top:3px}\n'
    + '.badges{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}\n'
    + '.badge-loc{background:#0f3460;color:#93c5fd;border-radius:20px;padding:3px 10px;font-size:12px}\n'
    + '.badge-sal{background:#14532d;color:#86efac;border-radius:20px;padding:3px 10px;font-size:12px}\n'
    + '.summary{color:#cbd5e1;font-size:13px;line-height:1.6;margin-bottom:10px}\n'
    + '.full-desc{color:#94a3b8;font-size:12px;line-height:1.7;border-top:1px solid #2d2d4e;padding-top:10px;margin-bottom:10px;display:none;white-space:pre-line}\n'
    + '.full-desc.open{display:block}\n'
    + '.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}\n'
    + '.btn-toggle{background:transparent;border:1px solid #4f46e5;color:#818cf8;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer}\n'
    + '.btn-toggle:hover{background:rgba(79,70,229,0.1)}\n'
    + '.btn-apply{background:#4f46e5;color:#fff;border-radius:6px;padding:5px 14px;font-size:12px;text-decoration:none;font-weight:600;display:inline-block}\n'
    + '.btn-apply:hover{background:#4338ca}\n'
    + '</style>\n'
    + '</head>\n'
    + '<body>\n'
    + '<div class="container">\n'
    + '<h1>&#x1F400; Resume Rodent &mdash; ' + jobs.length + ' job' + (jobs.length !== 1 ? 's' : '') + ' found</h1>\n'
    + cards + '\n'
    + '</div>\n'
    + '<script>\n'
    + 'function toggle(btn){\n'
    + '  var desc=btn.closest(".card").querySelector(".full-desc");\n'
    + '  var open=desc.classList.toggle("open");\n'
    + '  btn.innerHTML=open?"Hide description &#9650;":"Show full description &#9660;";\n'
    + '}\n'
    + '</script>\n'
    + '</body>\n'
    + '</html>';
}

function storePageAndReturnUrl(jobs) {
  const token = (++pageCounter).toString(36);
  searchPages.set(token, jobs);
  // Keep at most 50 pages
  if (searchPages.size > 50) {
    const oldest = searchPages.keys().next().value;
    searchPages.delete(oldest);
  }
  return MCP_SERVER_URL + "/results/" + token;
}

function createMcpServer() {
  const server = new Server(
    { name: "resume-rodent-tools", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "find_me_a_job",
          description:
            "Search for job opportunities from SonicJobs. Returns a link to a job board page showing all results with full descriptions and apply buttons. Always present the job board link prominently so the user can click it.",
          inputSchema: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "Job title, company name, or role keywords (e.g., 'product manager', 'marketing', 'engineering')"
              },
              limit: {
                type: "number",
                description: "Maximum number of jobs to return (default: 10)"
              }
            },
            required: ["keywords"]
          }
        },
        {
          name: "view_job_details",
          description:
            "Show the full job description for a specific job from the most recent find_me_a_job search, displayed inline in the chat.",
          inputSchema: {
            type: "object",
            properties: {
              job_number: {
                type: "number",
                description: "The job number from the search results (e.g., 1 for the first result)"
              }
            },
            required: ["job_number"]
          }
        },
        {
          name: "help_me_apply",
          description:
            "Start the Resume Rodent application helper. Select a job from find_me_a_job results, upload your resume, and get personalized guidance to refine it for that role.",
          inputSchema: {
            type: "object",
            properties: {
              jobTitle: {
                type: "string",
                description: "The job title (e.g., 'Senior Product Manager')"
              },
              jobUrl: {
                type: "string",
                description: "The job posting URL"
              },
              resumeText: {
                type: "string",
                description: "Your resume text to analyze against the job posting"
              }
            },
            required: ["jobTitle", "jobUrl"]
          }
        }
      ]
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "find_me_a_job") return await handleFindMeAJob(args);
    if (name === "view_job_details") return handleViewJobDetails(args);
    if (name === "help_me_apply") return handleHelpMeApply(args);

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true
    };
  });

  return server;
}

// Ordered list of the last search so view_job_details can look up by number
let lastSearchResults = [];

async function handleFindMeAJob(args) {
  const { keywords = "", limit = 10 } = args;

  if (!SONIC_JOBS_MCP_URL) return handleFindMeAJobFallback(keywords, limit);

  try {
    await fetch(SONIC_JOBS_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
      signal: AbortSignal.timeout(5000)
    }).catch(() => {});

    const response = await fetch(SONIC_JOBS_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: "job-search", arguments: { role: [keywords], page: 1 } }
      }),
      signal: AbortSignal.timeout(25000)
    });

    const text = await response.text();
    const dataMatch = text.match(/^data:\s*(.+)$/m);
    if (!dataMatch) return handleFindMeAJobFallback(keywords, limit);

    const parsed = JSON.parse(dataMatch[1]);
    if (parsed.error) return handleFindMeAJobFallback(keywords, limit);

    const rawJobs = (parsed.result?._meta?.jobs || []).slice(0, limit);
    if (rawJobs.length === 0) {
      return { content: [{ type: "text", text: `No jobs found matching "${keywords}". Try different keywords.` }] };
    }

    const jobs = rawJobs.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.companyName,
      location: [job.address?.city, job.address?.state].filter(Boolean).join(", ") || "Remote",
      salary: job.salaryDescription || null,
      logo: job.companyLogo || job.logoUrl || job.companyLogoUrl || null,
      url: job.redirectUrl || job.url || "",
      summary: stripHtml(job.htmlJobDescription || job.description || "").slice(0, 300),
      fullDescription: stripHtml(job.htmlJobDescription || job.description || "")
    }));

    cacheJobs(jobs);
    lastSearchResults = jobs;

    const boardUrl = storePageAndReturnUrl(jobs);
    return {
      content: [{
        type: "text",
        text: "Found " + jobs.length + " jobs matching \"" + keywords + "\".\n\n"
          + "Job board: " + boardUrl + "\n\n"
          + "Jobs found:\n"
          + jobs.map((j, i) => (i + 1) + ". " + j.title + " at " + j.company + (j.salary ? " — " + j.salary : "")).join("\n")
      }]
    };
  } catch (error) {
    return handleFindMeAJobFallback(keywords, limit);
  }
}

function handleViewJobDetails(args) {
  const { job_number } = args;
  const job = lastSearchResults[job_number - 1];

  if (!job) {
    return {
      content: [{ type: "text", text: `No job #${job_number} found. Run a job search first.` }],
      isError: true
    };
  }

  const applyUrl = RESUME_RODENT_APP + "?job_id=" + encodeURIComponent(job.id) + "&job_title=" + encodeURIComponent(job.title) + "&job_url=" + encodeURIComponent(job.url);
  const salaryLine = job.salary ? `**Salary:** ${job.salary}\n` : "";
  const logoLine = job.logo ? `![${job.company} logo](${job.logo})\n\n` : "";

  return {
    content: [{
      type: "text",
      text: logoLine
        + `## ${job.title}\n`
        + `**Company:** ${job.company}\n`
        + `**Location:** ${job.location}\n`
        + salaryLine
        + `\n---\n\n`
        + job.fullDescription
        + `\n\n---\n🎯 [Help Me Apply](${applyUrl})`
    }]
  };
}

function handleFindMeAJobFallback(keywords, limit) {
  const sampleJobs = [
    {
      id: "job-1",
      title: "Senior Product Marketing Manager",
      company: "Northstar AI",
      location: "San Francisco, CA",
      salary: "$130,000 - $160,000",
      logo: null,
      url: "https://jobs.example.com/job-1",
      summary: "Lead product marketing for AI workflow tools. 5+ years B2B SaaS experience required.",
      fullDescription: "Lead product marketing for AI workflow tools. 5+ years B2B SaaS experience required. You will work cross-functionally with product, sales, and customer success to drive go-to-market strategy. The ideal candidate has experience positioning complex products for enterprise buyers and a track record of successful launches."
    },
    {
      id: "job-2",
      title: "Product Manager - Developer Tools",
      company: "TechFlow Inc",
      location: "Remote",
      salary: "$120,000 - $150,000",
      logo: null,
      url: "https://jobs.example.com/job-2",
      summary: "Build developer-first tools with a team of engineers. Strong product sense and cross-functional skills needed.",
      fullDescription: "Build developer-first tools with a team of engineers. Strong product sense and cross-functional skills needed. You will own the full product lifecycle from discovery through launch. Deep empathy for developer workflows is essential. Experience with API products or CLI tooling preferred."
    },
    {
      id: "job-3",
      title: "Content Strategist",
      company: "CloudSoft",
      location: "New York, NY",
      salary: "$90,000 - $110,000",
      logo: null,
      url: "https://jobs.example.com/job-3",
      summary: "Shape brand narrative and support go-to-market efforts. 4+ years content strategy experience.",
      fullDescription: "Shape brand narrative and support go-to-market efforts. 4+ years content strategy experience required. You will produce thought leadership content, manage the editorial calendar, and collaborate closely with design and demand generation teams to drive pipeline."
    }
  ];

  const query = keywords.toLowerCase();
  const filtered = sampleJobs
    .filter((job) =>
      job.title.toLowerCase().includes(query) ||
      job.company.toLowerCase().includes(query) ||
      job.summary.toLowerCase().includes(query)
    )
    .slice(0, limit);

  if (filtered.length === 0) {
    return {
      content: [{ type: "text", text: `No jobs found matching "${keywords}". Try keywords like "product manager", "marketing", or a company name.` }]
    };
  }

  lastSearchResults = filtered;
  cacheJobs(filtered);

  const boardUrl = storePageAndReturnUrl(filtered);
  return {
    content: [{
      type: "text",
      text: "Found " + filtered.length + " sample job(s) matching \"" + keywords + "\".\n\n"
        + "Job board: " + boardUrl + "\n\n"
        + "Jobs found:\n"
        + filtered.map((j, i) => (i + 1) + ". " + j.title + " at " + j.company + " — " + j.salary).join("\n")
    }]
  };
}

function handleHelpMeApply(args) {
  const { jobTitle, jobUrl, resumeText } = args;

  if (!jobTitle || !jobUrl) {
    return {
      content: [{ type: "text", text: "Please select a job from find_me_a_job results to begin." }],
      isError: true
    };
  }

  const appUrl = new URL(RESUME_RODENT_APP);
  appUrl.searchParams.set("job_title", jobTitle);
  appUrl.searchParams.set("job_url", jobUrl);
  if (resumeText) appUrl.searchParams.set("resume_text", resumeText.substring(0, 5000));

  return {
    content: [{
      type: "text",
      text: `🎯 **Resume Rodent — Application Helper**\n\n**Job:** ${jobTitle}\n\n**Next steps:**\n1. Click the link below to open Resume Rodent\n2. Upload or paste your resume\n3. Answer follow-up questions to fill gaps\n4. Download your tailored PDF and submit\n\n[🚀 Open Resume Rodent](${appUrl.toString()})`
    }]
  };
}

// --- HTTP server ---

const app = express();
app.use(express.json());

app.all("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/results/:token", (req, res) => {
  const jobs = searchPages.get(req.params.token);
  if (!jobs) {
    return res.status(404).send(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expired</title>'
      + '<style>body{background:#0f0f1a;color:#94a3b8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>'
      + '</head><body><p>Results have expired. Please search again in Claude.</p></body></html>'
    );
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(buildResultsHtml(jobs));
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "resume-rodent-mcp" }));

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Resume Rodent MCP server running — POST /mcp on port ${port}`);
});
