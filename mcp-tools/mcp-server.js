#!/usr/bin/env node

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import dotenv from "dotenv";

dotenv.config();

const SONIC_JOBS_MCP_URL = process.env.SONICJOBS_MCP_URL || null;
const RESUME_RODENT_APP = (process.env.RESUME_RODENT_APP_URL || "http://localhost:4000").trim();

// Inline the ext-apps browser bundle at startup (CSP blocks CDN imports in widget iframes)
const require = createRequire(import.meta.url);
const bundle = readFileSync(
  require.resolve("@modelcontextprotocol/ext-apps/app-with-deps"),
  "utf8",
).replace(/export\{([^}]+)\};?\s*$/, (_, body) =>
  "globalThis.ExtApps={" +
  body.split(",").map((p) => {
    const [local, exported] = p.trim().split(" as ").map((s) => s.trim());
    return (exported ?? local) + ":" + local;
  }).join(",") + "};",
);
const widgetHtml = readFileSync(new URL("./widgets/job-board.html", import.meta.url), "utf8")
  .replace("/*__EXT_APPS_BUNDLE__*/", () => bundle);

const jobCache = new Map();
let lastSearchResults = [];

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

function buildPayload(jobs) {
  return JSON.stringify(
    jobs.map((j, i) => ({
      n: i + 1,
      title: j.title,
      company: j.company,
      location: j.location,
      salary: j.salary || null,
      logo: j.logo || null,
      summary: j.summary,
      fullDescription: j.fullDescription.slice(0, 800),
      applyUrl:
        RESUME_RODENT_APP +
        "?job_id=" + encodeURIComponent(j.id) +
        "&job_title=" + encodeURIComponent(j.title) +
        "&job_url=" + encodeURIComponent(j.url),
    }))
  );
}

function createMcpServer() {
  const server = new McpServer(
    { name: "resume-rodent-tools", version: "0.2.0" },
    { capabilities: { extensions: { "io.modelcontextprotocol/ui": {} } } }
  );

  // Job board widget resource
  registerAppResource(
    server,
    "Job Board",
    "ui://widgets/job-board.html",
    {},
    async () => ({
      contents: [{
        uri: "ui://widgets/job-board.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
      }],
    }),
  );

  // find_me_a_job — returns job data, host renders the widget inline
  registerAppTool(
    server,
    "find_me_a_job",
    {
      description: "Search for job opportunities from SonicJobs. Opens an interactive job board inline showing all results with salary, summary, expand/collapse descriptions and Help Me Apply buttons.",
      annotations: { title: "Find Me a Job", readOnlyHint: true },
      inputSchema: {
        keywords: z.string().describe("Job title, role or keywords (e.g. 'product manager', 'marketing')"),
        limit: z.number().optional().describe("Max jobs to return (default 10)"),
      },
      _meta: { ui: { resourceUri: "ui://widgets/job-board.html" } },
    },
    async ({ keywords = "", limit = 10 }) => {
      if (!SONIC_JOBS_MCP_URL) return handleFallback(keywords, limit);
      try {
        await fetch(SONIC_JOBS_MCP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});

        const response = await fetch(SONIC_JOBS_MCP_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: "tools/call",
            params: { name: "job-search", arguments: { role: [keywords], page: 1 } },
          }),
          signal: AbortSignal.timeout(25000),
        });

        const text = await response.text();
        const dataMatch = text.match(/^data:\s*(.+)$/m);
        if (!dataMatch) return handleFallback(keywords, limit);

        const parsed = JSON.parse(dataMatch[1]);
        if (parsed.error) return handleFallback(keywords, limit);

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
          fullDescription: stripHtml(job.htmlJobDescription || job.description || ""),
        }));

        cacheJobs(jobs);
        lastSearchResults = jobs;
        return {
          content: [{ type: "text", text: buildPayload(jobs) }],
          _meta: { "ui/resourceUri": "ui://widgets/job-board.html", ui: { resourceUri: "ui://widgets/job-board.html" } },
        };
      } catch {
        return handleFallback(keywords, limit);
      }
    },
  );

  // view_job_details — plain text fallback for hosts without widget support
  server.tool(
    "view_job_details",
    "Show the full job description for a specific job number from the last search.",
    { job_number: z.number().describe("Job number from search results (e.g. 1 for the first result)") },
    async ({ job_number }) => {
      const job = lastSearchResults[job_number - 1];
      if (!job) {
        return { content: [{ type: "text", text: `No job #${job_number} found. Run a job search first.` }], isError: true };
      }
      const applyUrl =
        RESUME_RODENT_APP +
        "?job_id=" + encodeURIComponent(job.id) +
        "&job_title=" + encodeURIComponent(job.title) +
        "&job_url=" + encodeURIComponent(job.url);
      return {
        content: [{
          type: "text",
          text:
            `## ${job.title}\n` +
            `**Company:** ${job.company}\n` +
            `**Location:** ${job.location}\n` +
            (job.salary ? `**Salary:** ${job.salary}\n` : "") +
            `\n---\n\n${job.fullDescription}\n\n---\n🎯 [Help Me Apply](${applyUrl})`,
        }],
      };
    },
  );

  // help_me_apply
  server.tool(
    "help_me_apply",
    "Start the Resume Rodent application helper. Select a job from find_me_a_job results, upload your resume, and get personalized guidance to refine it for that role.",
    {
      jobTitle: z.string().describe("The job title"),
      jobUrl: z.string().describe("The job posting URL"),
      resumeText: z.string().optional().describe("Your resume text"),
    },
    async ({ jobTitle, jobUrl, resumeText }) => {
      if (!jobTitle || !jobUrl) {
        return { content: [{ type: "text", text: "Please select a job from find_me_a_job results to begin." }], isError: true };
      }
      const appUrl = new URL(RESUME_RODENT_APP);
      appUrl.searchParams.set("job_title", jobTitle);
      appUrl.searchParams.set("job_url", jobUrl);
      if (resumeText) appUrl.searchParams.set("resume_text", resumeText.substring(0, 5000));
      return {
        content: [{
          type: "text",
          text:
            `🎯 **Resume Rodent — Application Helper**\n\n**Job:** ${jobTitle}\n\n` +
            `**Next steps:**\n1. Click the link below to open Resume Rodent\n` +
            `2. Upload or paste your resume\n3. Answer follow-up questions to fill gaps\n` +
            `4. Download your tailored PDF and submit\n\n[🚀 Open Resume Rodent](${appUrl.toString()})`,
        }],
      };
    },
  );

  return server;
}

function handleFallback(keywords, limit) {
  const sampleJobs = [
    {
      id: "job-1", title: "Senior Product Marketing Manager", company: "Northstar AI",
      location: "San Francisco, CA", salary: "$130,000 - $160,000", logo: null,
      url: "https://jobs.example.com/job-1",
      summary: "Lead product marketing for AI workflow tools. 5+ years B2B SaaS experience required.",
      fullDescription: "Lead product marketing for AI workflow tools. 5+ years B2B SaaS experience required. You will work cross-functionally with product, sales, and customer success to drive go-to-market strategy. The ideal candidate has experience positioning complex products for enterprise buyers and a track record of successful launches.",
    },
    {
      id: "job-2", title: "Product Manager - Developer Tools", company: "TechFlow Inc",
      location: "Remote", salary: "$120,000 - $150,000", logo: null,
      url: "https://jobs.example.com/job-2",
      summary: "Build developer-first tools with a team of engineers. Strong product sense and cross-functional skills needed.",
      fullDescription: "Build developer-first tools with a team of engineers. Strong product sense and cross-functional skills needed. You will own the full product lifecycle from discovery through launch. Deep empathy for developer workflows is essential.",
    },
    {
      id: "job-3", title: "Content Strategist", company: "CloudSoft",
      location: "New York, NY", salary: "$90,000 - $110,000", logo: null,
      url: "https://jobs.example.com/job-3",
      summary: "Shape brand narrative and support go-to-market efforts. 4+ years content strategy experience.",
      fullDescription: "Shape brand narrative and support go-to-market efforts. 4+ years content strategy experience required. You will produce thought leadership content, manage the editorial calendar, and collaborate closely with design and demand generation teams.",
    },
  ];

  const q = keywords.toLowerCase();
  const filtered = sampleJobs
    .filter((j) => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || j.summary.toLowerCase().includes(q))
    .slice(0, limit);

  if (filtered.length === 0) {
    return { content: [{ type: "text", text: `No jobs found matching "${keywords}". Try keywords like "product manager", "marketing", or a company name.` }] };
  }

  lastSearchResults = filtered;
  cacheJobs(filtered);
  return {
    content: [{ type: "text", text: buildPayload(filtered) }],
    _meta: { "ui/resourceUri": "ui://widgets/job-board.html", ui: { resourceUri: "ui://widgets/job-board.html" } },
  };
}

// --- HTTP server ---

const app = express();

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, MCP-Protocol-Version, MCP-Session-Id");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.use(express.json());

app.all("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "resume-rodent-mcp" }));

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Resume Rodent MCP server running — POST /mcp on port ${port}`);
});
