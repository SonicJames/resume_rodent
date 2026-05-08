import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { jobUrl, jobDescription, resumeText, conversation } = req.body || {};
  if (!Array.isArray(conversation) || !resumeText) {
    return res.status(400).json({ error: "conversation and resumeText are required." });
  }

  const history = conversation
    .map((m) => (m.role === "assistant" ? "Assistant" : "Candidate") + ": " + m.content)
    .join("\n");

  const prompt = [
    "You are Resume Rodent, a resume advisor helping a candidate strengthen their application.",
    "Do not invent qualifications. If evidence is missing, ask for precise real examples.",
    "",
    "Job URL: " + (jobUrl || "(no URL provided)"),
    "Job description: " + (jobDescription || "(no job description provided)"),
    "Resume: " + resumeText,
    "",
    "Conversation so far:",
    history,
    "",
    "Assistant:"
  ].join("\n");

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }]
    });

    const assistant = message.content[0]?.text || "";
    return res.status(200).json({ assistant });
  } catch (err) {
    console.error("[chat]", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
