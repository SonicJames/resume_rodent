import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a resume-to-job-description matcher. Given a job description and resume text, return a JSON object with this exact shape:

{
  "score": <integer 0-100>,
  "fitRating": <"Strong fit" | "Promising fit" | "Partial fit" | "Needs evidence">,
  "matchedKeywords": [<string>, ...],
  "missingKeywords": [<string>, ...],
  "strengths": [<string>, ...],
  "gaps": [
    { "keyword": <string>, "type": <"needs-proof" | "missing-evidence">, "prompt": <string> },
    ...
  ],
  "requirements": [
    { "text": <string>, "type": <string>, "label": <string>, "met": <boolean> },
    ...
  ]
}

Rules:
- score: percentage of key job requirements/skills the resume addresses (32–96)
- fitRating: "Strong fit" if score>84, "Promising fit" if >68, "Partial fit" if >52, else "Needs evidence"
- matchedKeywords: important skills/tools/domains from the job that appear in the resume (max 15)
- missingKeywords: important skills/tools/domains from the job missing from the resume (max 10)
- strengths: 3–5 specific bullet-point excerpts or paraphrases from the resume that are strong signals for this role
- gaps: 3–5 missing areas the candidate should address with evidence; prompt should be a direct question to elicit a concrete story
- requirements: ALL hard requirements found in the job description — things like physical demands (lifting, standing), licenses (driver's license, CDL, forklift), education levels (bachelor's, master's, PhD), certifications (PMP, CPA, AWS Certified, etc.), years of experience in specific areas, security clearance, travel requirements, work authorization, availability (nights, weekends, on-call). For each, set "met" to true only if the resume explicitly addresses it. Label with: "Physical", "License / driving", "Education", "Certification", "Years of experience", "Security clearance", "Travel", "Work authorization", or "Availability".

Respond with ONLY the raw JSON object, no markdown fences, no explanation.`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { jobDescription, resumeText, experienceBank = [] } = req.body || {};

  if (!jobDescription || !resumeText) {
    return res.status(400).json({ error: "jobDescription and resumeText are required" });
  }

  const bankText = experienceBank.length
    ? `\n\nAdditional experience context provided by the candidate:\n${experienceBank.map((e) => `- ${e.title}: ${e.details}`).join("\n")}`
    : "";

  const userMessage = `JOB DESCRIPTION:\n${jobDescription}\n\nRESUME:\n${resumeText}${bankText}`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [{ role: "user", content: userMessage }]
    });

    const raw = message.content[0]?.text?.trim() || "{}";
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return res.status(500).json({ error: "AI returned unparseable JSON", raw });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("[analyze] Anthropic error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
