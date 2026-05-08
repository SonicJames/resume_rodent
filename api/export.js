import Anthropic from "@anthropic-ai/sdk";
import PDFDocument from "pdfkit";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const config = { api: { responseLimit: "10mb" } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { jobUrl, jobDescription, resumeText, conversation } = req.body || {};
  if (!resumeText || !Array.isArray(conversation)) {
    return res.status(400).json({ error: "resumeText and conversation are required." });
  }

  const history = conversation
    .map((m) => (m.role === "assistant" ? "Assistant" : "Candidate") + ": " + m.content)
    .join("\n");

  const prompt = [
    "You are Resume Rodent. Create a polished ATS-friendly resume for the candidate based on the job details and conversation.",
    "Use only evidence present in the resume or provided by the candidate. Do not fabricate accomplishments.",
    "Format with sections: Name, Contact, Summary, Experience, Skills, Education.",
    "",
    "Job URL: " + (jobUrl || "(no URL provided)"),
    "Job description: " + (jobDescription || "(no job description provided)"),
    "Resume: " + resumeText,
    "",
    "Conversation:",
    history,
    "",
    "Output only the resume text to include in the PDF."
  ].join("\n");

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    });

    const resumeBody = message.content[0]?.text || "";

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => {
      const pdf = Buffer.concat(buffers);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "attachment; filename=resume-rodent.pdf");
      res.send(pdf);
    });

    doc.fontSize(12).fillColor("#111");
    resumeBody.split(/\r?\n/).forEach((line) => {
      if (!line.trim()) { doc.moveDown(0.4); return; }
      if (/^#+\s*/.test(line) || /^[A-Z][A-Za-z ]{2,}:$/.test(line)) {
        doc.moveDown(0.3).fontSize(13).font("Times-Bold").text(line.replace(/^#+\s*/, ""));
        doc.font("Times-Roman").fontSize(11);
      } else {
        doc.text(line, { lineGap: 2 });
      }
    });

    doc.end();
  } catch (err) {
    console.error("[export]", err);
    return res.status(500).json({ error: err.message || "Export failed." });
  }
}
