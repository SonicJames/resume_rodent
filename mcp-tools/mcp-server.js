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

// In-memory cache of job details keyed by job ID.
// Railway runs a persistent process so this survives between requests.
const jobCache = new Map();

function cacheJobs(jobs) {
  jobs.forEach((job) => jobCache.set(job.id, job));
  // Prevent unbounded growth
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
            "Search for job opportunities from SonicJobs. IMPORTANT: When displaying results, reproduce each job listing to the user exactly and in full — including job title, company, location, salary, and the full 'About the role' summary. Do not condense, paraphrase, or omit any fields. Show every job returned.",
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

function buildJobsReactArtifact(jobs, keywords) {
  const jobsJson = JSON.stringify(jobs);
  const appBase = JSON.stringify(RESUME_RODENT_APP);

  return `
Please render the following as a React artifact:

\`\`\`jsx
import { useState } from "react";

const JOBS = ${jobsJson};
const APP_BASE = ${appBase};

function applyUrl(job) {
  return APP_BASE + "?job_id=" + encodeURIComponent(job.id) + "&job_title=" + encodeURIComponent(job.title) + "&job_url=" + encodeURIComponent(job.url);
}

function JobCard({ job, num }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      background: "#1a1a2e", border: "1px solid #2d2d4e", borderRadius: 12,
      padding: "18px 20px", marginBottom: 16, fontFamily: "system-ui, sans-serif"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        {job.logo && (
          <img src={job.logo} alt={job.company} style={{ width: 40, height: 40, borderRadius: 6, objectFit: "contain", background: "#fff", padding: 3 }} />
        )}
        <div>
          <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 15 }}>
            [{num}] {job.title}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13 }}>{job.company}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ background: "#0f3460", color: "#93c5fd", borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>
          📍 {job.location}
        </span>
        {job.salary && (
          <span style={{ background: "#14532d", color: "#86efac", borderRadius: 20, padding: "2px 10px", fontSize: 12 }}>
            💰 {job.salary}
          </span>
        )}
      </div>
      <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6, margin: "0 0 10px" }}>
        {job.summary}{!expanded && job.fullDescription.length > job.summary.length ? "…" : ""}
      </p>
      {expanded && (
        <p style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.7, margin: "0 0 10px", borderTop: "1px solid #2d2d4e", paddingTop: 10 }}>
          {job.fullDescription}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {job.fullDescription.length > job.summary.length && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: "transparent", border: "1px solid #4f46e5", color: "#818cf8",
              borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer"
            }}
          >
            {expanded ? "Hide description ▲" : "Show full description ▼"}
          </button>
        )}
        <a
          href={applyUrl(job)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: "#4f46e5", color: "#fff", borderRadius: 6,
            padding: "5px 14px", fontSize: 12, textDecoration: "none", fontWeight: 600
          }}
        >
          🎯 Help Me Apply
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div style={{ background: "#0f0f1a", minHeight: "100vh", padding: "24px 20px", boxSizing: "border-box" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <h2 style={{ color: "#e2e8f0", fontFamily: "system-ui, sans-serif", marginBottom: 20, fontSize: 18 }}>
          🐭 Resume Rodent — {JOBS.length} job{JOBS.length !== 1 ? "s" : ""} found
        </h2>
        {JOBS.map((job, i) => <JobCard key={job.id} job={job} num={i + 1} />)}
      </div>
    </div>
  );
}
\`\`\`
`.trim();
}

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

    return {
      content: [{ type: "text", text: buildJobsReactArtifact(jobs, keywords) }]
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
      text: logoLine +
        `## ${job.title}\n` +
        `**Company:** ${job.company}\n` +
        `**Location:** ${job.location}\n` +
        salaryLine +
        `\n---\n\n` +
        job.fullDescription +
        `\n\n---\n🎯 [Help Me Apply](${applyUrl})`
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

  return {
    content: [{ type: "text", text: buildJobsReactArtifact(filtered, keywords) }]
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

app.get("/health", (_req, res) => res.json({ status: "ok", service: "resume-rodent-mcp" }));

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Resume Rodent MCP server running — POST /mcp on port ${port}`);
});
