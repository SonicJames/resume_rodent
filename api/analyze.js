import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an expert recruiter and career coach. Your job is to deeply analyse a job description and a candidate's resume — not by matching words, but by understanding what the role genuinely requires and whether the candidate's background provides real evidence of meeting those requirements.

STEP 1 — Read the job description and extract ALL meaningful requirements:
- Technical skills and tools (e.g. Python, Salesforce, Adobe XD)
- Domain or industry experience (e.g. "5 years in B2B SaaS", "healthcare background")
- Depth or scope of experience (e.g. "managed P&L", "led teams of 10+", "owned full product lifecycle")
- Soft skills that are genuinely role-critical — not boilerplate (e.g. "stakeholder management at C-suite level")
- Qualifications: degrees, certifications, licences
- Hard constraints: work authorisation, travel, schedule, physical requirements

STEP 2 — For each requirement, assess the resume for GENUINE EVIDENCE — not just whether a word appears, but whether the candidate demonstrably has the capability or experience.

STEP 3 — Identify the most important gaps: requirements the role needs that the resume does not address with evidence.

Return ONLY a raw JSON object with this exact shape — no markdown fences, no explanation:

{
  "score": <integer 32–96, based on what fraction of required requirements are genuinely met>,
  "fitRating": <"Strong fit" | "Promising fit" | "Partial fit" | "Needs evidence">,
  "overview": <1–2 sentence plain-English summary of how well this candidate fits this specific role>,
  "strengths": [<3–5 specific statements about what the resume demonstrates that is relevant to this role>],
  "requirements": [
    {
      "text": <the requirement as stated or paraphrased from the JD>,
      "label": <short name, e.g. "Python", "Team leadership", "Bachelor's degree", "Travel 30%">,
      "category": <"Technical skill" | "Experience" | "Qualification" | "Soft skill" | "Hard constraint">,
      "importance": <"required" | "preferred">,
      "met": <true | false>,
      "evidence": <one concise sentence explaining why it is or is not met — based on what the resume actually says>
    }
  ],
  "gaps": [
    {
      "keyword": <short name of the requirement area, e.g. "Team leadership">,
      "type": <"missing-evidence" | "needs-proof">,
      "prompt": <a direct, specific question to ask the candidate to surface real evidence — make it concrete, not generic>,
      "detail": <what the role requires that the resume doesn't show>
    }
  ],
  "matchedAreas": [<short names of requirement areas the resume genuinely addresses — used for document tailoring>],
  "missingAreas": [<short names of requirement areas the resume does not address — used for document tailoring>]
}

Rules:
- score: "Strong fit" if >84, "Promising fit" if >68, "Partial fit" if >52, else "Needs evidence"
- requirements: capture ALL meaningful requirements, max 12. Include both met and unmet.
- gaps: only the 4–5 most important unmet *required* requirements. Prompts must be specific to this role.
- Do NOT assess based on keyword presence. A resume that says "coordinated cross-functional projects" can evidence stakeholder management even without those exact words.
- matchedAreas and missingAreas are plain English phrases for use in generated cover letters and resumes.`;

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
      max_tokens: 2000,
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

    // Normalise matchedAreas/missingAreas → matchedKeywords/missingKeywords
    // so document generators continue to work without changes
    result.matchedKeywords = result.matchedAreas || result.matchedKeywords || [];
    result.missingKeywords = result.missingAreas || result.missingKeywords || [];

    return res.status(200).json(result);
  } catch (err) {
    console.error("[analyze] Anthropic error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
