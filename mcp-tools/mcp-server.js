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
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

const SONIC_JOBS_MCP_URL = process.env.SONICJOBS_MCP_URL || null;
const RESUME_RODENT_APP = (process.env.RESUME_RODENT_APP_URL || "http://localhost:4000").trim();
// API base uses origin only — env var may include a path like /app which breaks /api/* routes
const RESUME_RODENT_API = (() => { try { return new URL(RESUME_RODENT_APP).origin; } catch { return RESUME_RODENT_APP; } })();
// Stable widget origin required by Claude.ai — sha256("https://resume-rodent-mcp-production.up.railway.app/mcp").slice(0,32) + ".claudemcpcontent.com"
const APP_DOMAIN = "4c6e427b436038ba6fd4f2f127e141eb.claudemcpcontent.com";

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

  // Job board widget resource — URI versioned to bust Claude.ai resource cache
  registerAppResource(
    server,
    "Job Board",
    "ui://widgets/job-board-v5.html",
    { domain: APP_DOMAIN },
    async () => ({
      contents: [{
        uri: "ui://widgets/job-board-v5.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: widgetHtml,
        _meta: { ui: { domain: APP_DOMAIN } },
      }],
    }),
  );

  // find_me_a_job — returns job data, host renders the widget inline
  registerAppTool(
    server,
    "find_me_a_job",
    {
      description: "Search for jobs and display results in an interactive inline board. Pass ALL desired roles and variations in the keywords array in a single call — the tool handles multiple terms internally. Never call this tool more than once per user request.",
      annotations: { title: "Find Me a Job", readOnlyHint: true },
      inputSchema: {
        keywords: z.union([z.array(z.string()), z.string()]).describe("Job title, role or keywords. Pass an array to include multiple terms in one call rather than calling the tool multiple times — e.g. ['product manager', 'senior PM', 'remote']."),
      },
      _meta: { ui: { resourceUri: "ui://widgets/job-board-v5.html" } },
    },
    async ({ keywords = [] }) => {
      const query = Array.isArray(keywords) ? keywords.join(" ") : String(keywords);
      const limit = 15;
      if (!SONIC_JOBS_MCP_URL) return handleFallback(query, limit);
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
            params: { name: "job-search", arguments: { role: [query], page: 1 } },
          }),
          signal: AbortSignal.timeout(25000),
        });

        const text = await response.text();
        const dataMatch = text.match(/^data:\s*(.+)$/m);
        if (!dataMatch) return handleFallback(query, limit);

        const parsed = JSON.parse(dataMatch[1]);
        if (parsed.error) return handleFallback(query, limit);

        const rawJobs = (parsed.result?._meta?.jobs || []).slice(0, limit);
        if (rawJobs.length === 0) {
          return { content: [{ type: "text", text: `No jobs found matching "${query}". Try different keywords.` }] };
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
          _meta: { "ui/resourceUri": "ui://widgets/job-board-v5.html", ui: { resourceUri: "ui://widgets/job-board-v5.html" } },
        };
      } catch {
        return handleFallback(query, limit);
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

  // help_me_apply — called by Claude when user wants to apply; widget handles the rest
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

  // analyze_resume — called directly by the widget via callServerTool; hidden from Claude
  registerAppTool(
    server,
    "analyze_resume",
    {
      description: "Analyze a resume against a job posting and return coaching feedback. Called by the job board widget.",
      annotations: { title: "Analyze Resume", readOnlyHint: true },
      inputSchema: {
        jobTitle: z.string(),
        jobDescription: z.string(),
        jobUrl: z.string().optional(),
        resumeText: z.string(),
      },
      _meta: {
        ui: {
          resourceUri: "ui://widgets/job-board-v5.html",
          visibility: ["app"],
        },
      },
    },
    async ({ jobTitle, jobDescription, jobUrl, resumeText }) => {
      try {
        const response = await fetch(RESUME_RODENT_API + "/api/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobUrl: jobUrl || "",
            jobDescription: "Job Title: " + jobTitle + "\n\n" + jobDescription,
            resumeText,
          }),
          signal: AbortSignal.timeout(28000),
        });
        if (!response.ok) throw new Error("exchange api " + response.status);
        const data = await response.json();
        return { content: [{ type: "text", text: data.assistant || "Analysis complete." }] };
      } catch (err) {
        return { content: [{ type: "text", text: "Analysis failed: " + err.message }], isError: true };
      }
    },
  );

  // chat_on_resume — follow-up chat, called by widget via callServerTool; hidden from Claude
  registerAppTool(
    server,
    "chat_on_resume",
    {
      description: "Continue a resume coaching conversation. Called by the job board widget.",
      annotations: { title: "Chat on Resume", readOnlyHint: true },
      inputSchema: {
        jobUrl: z.string().optional(),
        jobDescription: z.string(),
        resumeText: z.string(),
        conversation: z.array(z.object({ role: z.string(), content: z.string() })),
      },
      _meta: {
        ui: {
          resourceUri: "ui://widgets/job-board-v5.html",
          visibility: ["app"],
        },
      },
    },
    async ({ jobUrl, jobDescription, resumeText, conversation }) => {
      try {
        const response = await fetch(RESUME_RODENT_API + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobUrl: jobUrl || "",
            jobDescription,
            resumeText,
            conversation: conversation.map(m => ({ role: m.role, content: m.content })),
          }),
          signal: AbortSignal.timeout(28000),
        });
        if (!response.ok) throw new Error("chat api " + response.status);
        const data = await response.json();
        return { content: [{ type: "text", text: data.assistant || "" }] };
      } catch (err) {
        return { content: [{ type: "text", text: "Chat failed: " + err.message }], isError: true };
      }
    },
  );

  // extract_resume_text — parse uploaded PDF/DOCX/TXT; called by widget, hidden from Claude
  registerAppTool(
    server,
    "extract_resume_text",
    {
      description: "Extract plain text from an uploaded resume file (PDF, DOCX, TXT). Called by the job board widget.",
      annotations: { title: "Extract Resume Text", readOnlyHint: true },
      inputSchema: {
        fileBase64: z.string().describe("Base64-encoded file content"),
        fileName: z.string().describe("Original filename including extension"),
      },
      _meta: {
        ui: {
          resourceUri: "ui://widgets/job-board-v5.html",
          visibility: ["app"],
        },
      },
    },
    async ({ fileBase64, fileName }) => {
      try {
        const response = await fetch(RESUME_RODENT_API + "/api/extract-resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileBase64, fileName }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error("extract api " + response.status);
        const data = await response.json();
        return { content: [{ type: "text", text: data.text || "" }] };
      } catch (err) {
        return { content: [{ type: "text", text: "Extraction failed: " + err.message }], isError: true };
      }
    },
  );

  return server;
}

function handleFallback(query, limit) {
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
    _meta: { "ui/resourceUri": "ui://widgets/job-board-v5.html", ui: { resourceUri: "ui://widgets/job-board-v5.html" } },
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

// Stateful sessions — Claude.ai needs a persistent session for widget rendering
const sessions = new Map();

app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId).handleRequest(req, res, req.body);
    return;
  }

  // New session
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  const server = createMcpServer();
  await server.connect(transport);

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await transport.handleRequest(req, res, req.body);

  if (transport.sessionId) sessions.set(transport.sessionId, transport);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId).close();
    sessions.delete(sessionId);
  }
  res.status(200).end();
});

app.get("/health", (_req, res) => res.json({ status: "ok", service: "resume-rodent-mcp", sessions: sessions.size }));

// Favicon — shows Resume Rodent icon in Claude.ai connector list instead of Railway logo
app.get("/favicon.ico", (_req, res) => {
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🐭</text></svg>');
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Resume Rodent MCP server running — POST /mcp on port ${port}`);
});
