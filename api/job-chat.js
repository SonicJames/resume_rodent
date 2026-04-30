import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a friendly job search assistant inside Resume Rodent, an AI-powered job application tool.

You have access to the SonicJobs search tool to find current US job listings.

When the user describes what they're looking for:
1. Search using the SonicJobs tool with appropriate parameters
2. Write a short natural-language intro (1–2 sentences)
3. ALWAYS end your response with a \`\`\`jobs JSON block listing each result

Format the \`\`\`jobs block exactly like this (no other fences in your response):
\`\`\`jobs
[
  {
    "id": "<job id from results, or a short slug if not available>",
    "title": "<job title>",
    "company": "<company name>",
    "location": "<city, state or Remote>",
    "salary": "<salary range, or null if not listed>",
    "url": "<application URL, or null>",
    "description": "<full job description or best available summary>"
  }
]
\`\`\`

If no jobs are found, say so briefly and include \`\`\`jobs\n[]\n\`\`\`.

Keep your conversational text concise. Offer to refine the search if the user wants different results.
Note: SonicJobs covers US-based positions only.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  const mcpUrl = process.env.SONICJOBS_MCP_URL;
  if (!mcpUrl) {
    return res.status(500).json({ error: "SONICJOBS_MCP_URL not configured" });
  }

  try {
    const mcpServer = {
      type: "url",
      url: mcpUrl,
      name: "sonicjobs",
      ...(process.env.SONICJOBS_MCP_API_KEY && {
        authorization_token: process.env.SONICJOBS_MCP_API_KEY
      })
    };

    const response = await client.beta.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      betas: ["mcp-client-2025-11-20"],
      mcp_servers: [mcpServer],
      tools: [{ type: "mcp_toolset", mcp_server_name: "sonicjobs" }],
      system: SYSTEM_PROMPT,
      messages
    });

    const textContent = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    const jobsMatch = textContent.match(/```jobs\s*([\s\S]*?)```/);
    let jobs = null;
    let message = textContent;

    if (jobsMatch) {
      try {
        jobs = JSON.parse(jobsMatch[1].trim());
        message = textContent.replace(/```jobs[\s\S]*?```/g, "").trim();
      } catch {
        // Return raw message if job block can't be parsed
      }
    }

    return res.status(200).json({ message, jobs });
  } catch (err) {
    return res.status(500).json({ error: `Job search failed: ${err.message}` });
  }
}
