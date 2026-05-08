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
            "Search for job opportunities from SonicJobs. Returns a list of available roles with company, location, salary and a summary. Use view_job_details to show the full description for any job in chat.",
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

    const jobList = jobs
      .map((job, idx) => {
        const num = idx + 1;
        const logoLine = job.logo ? `![${job.company} logo](${job.logo})\n` : "";
        const salaryLine = job.salary ? `💰 ${job.salary}\n` : "";
        const applyUrl = RESUME_RODENT_APP + "?job_id=" + encodeURIComponent(job.id) + "&job_title=" + encodeURIComponent(job.title) + "&job_url=" + encodeURIComponent(job.url);

        return (
          logoLine +
          `**[${num}] ${job.title}** at ${job.company}\n` +
          `📍 ${job.location}\n` +
          salaryLine +
          `${job.summary}...\n` +
          `💬 "Show me details for job ${num}" | 🎯 [Help Me Apply](${applyUrl})`
        );
      })
      .join("\n\n---\n\n");

    return {
      content: [{
        type: "text",
        text: `Found ${jobs.length} job(s) matching "${keywords}":\n\n${jobList}\n\n---\nAsk me to **show details** for any job to read the full description, or click **Help Me Apply** to tailor your resume.`
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
      fullDescription: "Lead product marketing for AI workflow tools. 5+ years B2B SaaS experience required. You will work cross-functionally with product, sales, and customer success to drive go-to-market strategy."
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
      fullDescription: "Build developer-first tools with a team of engineers. Strong product sense and cross-functional skills needed. You will own the full product lifecycle from discovery through launch."
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
      fullDescription: "Shape brand narrative and support go-to-market efforts. 4+ years content strategy experience. You will produce thought leadership content, manage editorial calendar, and collaborate with design."
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

  const jobList = filtered
    .map((job, idx) => {
      const num = idx + 1;
      const applyUrl = RESUME_RODENT_APP + "?job_id=" + encodeURIComponent(job.id) + "&job_title=" + encodeURIComponent(job.title) + "&job_url=" + encodeURIComponent(job.url);
      return (
        `**[${num}] ${job.title}** at ${job.company}\n` +
        `📍 ${job.location} | 💰 ${job.salary}\n` +
        `${job.summary}\n` +
        `💬 "Show me details for job ${num}" | 🎯 [Help Me Apply](${applyUrl})`
      );
    })
    .join("\n\n---\n\n");

  return {
    content: [{
      type: "text",
      text: `Found ${filtered.length} sample job(s) matching "${keywords}":\n\n${jobList}\n\n---\nAsk me to **show details** for any job or click **Help Me Apply** to get started.`
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

app.get("/health", (_req, res) => res.json({ status: "ok", service: "resume-rodent-mcp" }));

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Resume Rodent MCP server running — POST /mcp on port ${port}`);
});
