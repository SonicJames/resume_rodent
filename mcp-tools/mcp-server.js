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

const SONIC_JOBS_SERVER = process.env.SONIC_JOBS_MCP_URL || null;
const RESUME_RODENT_APP = process.env.RESUME_RODENT_APP_URL || "http://localhost:4000";

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
            "Search for job opportunities from SonicJobs. Returns a list of available roles. Each job can be selected to apply directly or use Resume Rodent to refine your resume first.",
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
          name: "help_me_apply",
          description:
            "Start the Resume Rodent application helper. Select a job from find_me_a_job results, upload your resume, and get personalized guidance to refine it for that role. Returns a link to the Resume Rodent app where you can complete the process.",
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
    const { name, arguments: args } = request;

    if (name === "find_me_a_job") {
      return await handleFindMeAJob(args);
    } else if (name === "help_me_apply") {
      return handleHelpMeApply(args);
    } else {
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true
      };
    }
  });

  return server;
}

async function handleFindMeAJob(args) {
  const { keywords = "", limit = 10 } = args;

  if (!SONIC_JOBS_SERVER) {
    return handleFindMeAJobFallback(keywords, limit);
  }

  try {
    const response = await fetch(`${SONIC_JOBS_SERVER}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords, limit })
    });

    if (!response.ok) {
      return handleFindMeAJobFallback(keywords, limit);
    }

    const data = await response.json();
    const jobs = data.jobs || [];

    if (jobs.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No jobs found matching "${keywords}" on SonicJobs. Try different keywords or browse all positions.`
        }]
      };
    }

    const jobList = jobs
      .map(
        (job, idx) =>
          `**[${idx + 1}] ${job.title}** at ${job.company}\n` +
          `📍 ${job.location || "Remote"} | 💼 ${job.type || "Full-time"}\n` +
          `${job.description?.substring(0, 150)}...\n` +
          `🔗 [View Job](${job.url}) | 🎯 [Help Me Apply](${RESUME_RODENT_APP}?job_id=${job.id}&job_title=${encodeURIComponent(job.title)}&job_url=${encodeURIComponent(job.url)})`
      )
      .join("\n\n");

    return {
      content: [{
        type: "text",
        text: `Found ${jobs.length} job(s) matching "${keywords}" on SonicJobs:\n\n${jobList}\n\nClick **Help Me Apply** to use Resume Rodent and refine your resume for that role.`
      }]
    };
  } catch (error) {
    return handleFindMeAJobFallback(keywords, limit);
  }
}

function handleFindMeAJobFallback(keywords, limit) {
  const sampleJobs = [
    {
      id: "job-1",
      title: "Senior Product Marketing Manager",
      company: "Northstar AI",
      location: "San Francisco, CA",
      type: "Full-time",
      url: "https://jobs.example.com/job-1",
      description: "Lead product marketing for AI workflow tools. 5+ years B2B SaaS experience required."
    },
    {
      id: "job-2",
      title: "Product Manager - Developer Tools",
      company: "TechFlow Inc",
      location: "Remote",
      type: "Full-time",
      url: "https://jobs.example.com/job-2",
      description: "Build developer-first tools with a team of engineers. Strong product sense and cross-functional skills needed."
    },
    {
      id: "job-3",
      title: "Content Strategist",
      company: "CloudSoft",
      location: "New York, NY",
      type: "Full-time",
      url: "https://jobs.example.com/job-3",
      description: "Shape brand narrative and support go-to-market efforts. 4+ years content strategy experience."
    }
  ];

  const query = keywords.toLowerCase();
  const filtered = sampleJobs
    .filter(
      (job) =>
        job.title.toLowerCase().includes(query) ||
        job.company.toLowerCase().includes(query) ||
        job.description.toLowerCase().includes(query)
    )
    .slice(0, limit);

  if (filtered.length === 0) {
    return {
      content: [{
        type: "text",
        text: `No jobs found matching "${keywords}". SonicJobs server may be unavailable. Try keywords like "product manager", "marketing", or a company name.`
      }]
    };
  }

  const jobList = filtered
    .map(
      (job, idx) =>
        `**[${idx + 1}] ${job.title}** at ${job.company}\n` +
        `📍 ${job.location} | 💼 ${job.type}\n` +
        `${job.description}\n` +
        `🔗 [View Job](${job.url}) | 🎯 [Help Me Apply](${RESUME_RODENT_APP}?job_id=${job.id}&job_title=${encodeURIComponent(job.title)}&job_url=${encodeURIComponent(job.url)})`
    )
    .join("\n\n");

  return {
    content: [{
      type: "text",
      text: `Found ${filtered.length} sample job(s) matching "${keywords}" (SonicJobs server unavailable):\n\n${jobList}\n\nClick **Help Me Apply** to open Resume Rodent and refine your resume for that role.`
    }]
  };
}

function handleHelpMeApply(args) {
  const { jobTitle, jobUrl, resumeText } = args;

  if (!jobTitle || !jobUrl) {
    return {
      content: [{
        type: "text",
        text: "Please select a job from find_me_a_job results to begin Resume Rodent application helper."
      }],
      isError: true
    };
  }

  const appUrl = new URL(RESUME_RODENT_APP);
  appUrl.searchParams.set("job_title", jobTitle);
  appUrl.searchParams.set("job_url", jobUrl);
  if (resumeText) {
    appUrl.searchParams.set("resume_text", resumeText.substring(0, 5000));
  }

  return {
    content: [{
      type: "text",
      text: `
🎯 Resume Rodent - Application Helper

**Job:** ${jobTitle}
**URL:** ${jobUrl}

### Next Steps:

1. Click the link below to open Resume Rodent
2. Upload or paste your resume
3. Answer follow-up questions to fill gaps
4. Get a tailored, ATS-friendly resume
5. Download and submit!

[🚀 Open Resume Rodent](${appUrl.toString()})

Resume Rodent will guide you through:
- Analyzing your resume against job requirements
- Identifying missing keywords and experience gaps
- Asking targeted questions to gather evidence
- Generating a tailored resume PDF ready to submit
`
    }]
  };
}

// --- HTTP server ---

const app = express();
app.use(express.json());

// All MCP traffic goes through /mcp — stateless mode (no session management)
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
