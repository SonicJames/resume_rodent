import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a friendly job search assistant inside Resume Rodent.
You have access to the job_search tool to find current US job listings on SonicJobs.

When the user asks about jobs, call the job_search tool with appropriate parameters.
After receiving results, write a brief 1-2 sentence intro then ALWAYS end with a \`\`\`jobs JSON fence.

\`\`\`jobs fence format:
[
  {
    "id": "...",
    "title": "...",
    "company": "...",
    "location": "City, State",
    "salary": "range string or null",
    "url": "https://...",
    "description": "plain text description"
  }
]
\`\`\`

If no jobs found, include \`\`\`jobs\n[]\n\`\`\`.
Keep your intro concise. Only US jobs are available.`;

const TOOL_DEF = {
  name: "job_search",
  description: "Search for current US job listings on SonicJobs.",
  input_schema: {
    type: "object",
    properties: {
      role: {
        type: "array",
        items: { type: "string" },
        description: "Job titles to search. Max 5 titles as separate array items."
      },
      city: { type: "string", description: "City name, e.g. San Francisco" },
      state: { type: "string", description: "2-letter US state code, e.g. CA" },
      salaryMin: { type: "number", description: "Minimum annual salary" },
      remote: { type: "boolean", description: "true for remote jobs only" },
      companyName: { type: "string", description: "Filter by company name" },
      page: { type: "number", description: "Page number, default 1" }
    }
  }
};

async function callSonicJobs(toolInput) {
  const mcpUrl = process.env.SONICJOBS_MCP_URL;

  // Send initialized notification (required by MCP protocol before tool calls)
  await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }),
    signal: AbortSignal.timeout(5000)
  }).catch(() => {}); // non-critical, ignore errors

  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: "job-search", arguments: toolInput }
    }),
    signal: AbortSignal.timeout(25000)
  });

  const text = await response.text();
  const dataMatch = text.match(/^data:\s*(.+)$/m);
  if (!dataMatch) throw new Error("Unexpected MCP response format");

  const parsed = JSON.parse(dataMatch[1]);
  if (parsed.error) throw new Error(parsed.error.message);
  return parsed.result;
}

function stripHtml(html) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function mapJobs(rawJobs) {
  return (rawJobs || []).slice(0, 10).map((job) => ({
    id: job.id,
    title: job.title,
    company: job.companyName,
    location: [job.address?.city, job.address?.state].filter(Boolean).join(", "),
    salary: job.salaryDescription || null,
    url: job.redirectUrl || null,
    description: stripHtml(job.htmlJobDescription)
  }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body || {};
  if (!messages?.length) return res.status(400).json({ error: "messages array is required" });
  if (!process.env.SONICJOBS_MCP_URL) return res.status(500).json({ error: "SONICJOBS_MCP_URL not configured" });

  try {
    let currentMessages = [...messages];
    let jobs = null;
    let finalText = "";

    for (let i = 0; i < 5; i++) {
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools: [TOOL_DEF],
        messages: currentMessages
      });

      if (response.stop_reason === "end_turn") {
        finalText = response.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        break;
      }

      if (response.stop_reason === "tool_use") {
        const toolUse = response.content.find((b) => b.type === "tool_use");
        if (!toolUse) break;

        let toolResult;
        try {
          const mcpResult = await callSonicJobs(toolUse.input);
          const rawJobs = mcpResult?._meta?.jobs || [];
          jobs = mapJobs(rawJobs);
          const summary = mcpResult?.content?.[0]?.text || `Found ${jobs.length} jobs.`;
          toolResult = {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify({ summary, totalResults: mcpResult?.structuredContent?.totalResults, jobs })
          };
        } catch (err) {
          toolResult = {
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Search failed: ${err.message}`,
            is_error: true
          };
          jobs = null;
        }

        currentMessages = [
          ...currentMessages,
          { role: "assistant", content: response.content },
          { role: "user", content: [toolResult] }
        ];
      }
    }

    // If Claude included a ```jobs fence, use that (it may have filtered/reordered)
    const jobsMatch = finalText.match(/```jobs\s*([\s\S]*?)```/);
    if (jobsMatch) {
      try {
        const parsed = JSON.parse(jobsMatch[1].trim());
        if (Array.isArray(parsed)) jobs = parsed;
        finalText = finalText.replace(/```jobs[\s\S]*?```/g, "").trim();
      } catch {
        // Keep jobs from tool result
      }
    }

    return res.status(200).json({ message: finalText, jobs });
  } catch (err) {
    return res.status(500).json({ error: `Job search failed: ${err.message}` });
  }
}
