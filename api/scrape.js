import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: "Invalid URL" });
  }

  // Step 1: fetch raw page content via Jina Reader
  let rawText;
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/plain", "X-Return-Format": "text" }
    });
    if (!response.ok) throw new Error(`Jina returned ${response.status}`);
    rawText = (await response.text()).slice(0, 15000);
  } catch (err) {
    return res.status(500).json({ error: `Failed to fetch page: ${err.message}` });
  }

  // Step 2: use Claude to extract clean job fields
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [
        {
          role: "user",
          content: `You are extracting structured data from a job posting page. The raw content below may include navigation menus, cookie banners, footers, related jobs, and other page noise. Extract only what relates to this specific job.

Return ONLY a raw JSON object — no markdown fences, no explanation:
{
  "title": <job title as a string, or null if not found>,
  "location": <location and/or remote status as a string, or null>,
  "salary": <salary or compensation range as a string, or null if not mentioned>,
  "description": <the clean job description — include: role summary, responsibilities, requirements, qualifications, about the company. Exclude: navigation, footers, cookie notices, unrelated job listings, apply buttons, share links>
}

RAW PAGE CONTENT:
${rawText}`
        }
      ]
    });

    const raw = message.content[0]?.text?.trim() || "{}";
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "Claude returned unparseable JSON", raw });
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: `Claude extraction failed: ${err.message}` });
  }
}
