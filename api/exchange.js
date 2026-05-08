import Anthropic from "@anthropic-ai/sdk";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload = multer({ storage: multer.memoryStorage() });

export const config = { api: { bodyParser: false } };

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });
}

async function parseResumeFile(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) return file.buffer.toString("utf-8");
  if (name.endsWith(".docx")) return (await mammoth.extractRawText({ buffer: file.buffer })).value.trim();
  if (name.endsWith(".pdf")) return (await pdfParse(file.buffer)).text.trim();
  throw new Error("Unsupported file type. Use .txt, .md, .docx, or .pdf.");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let jobUrl, jobDescription, resumeText, file;

  try {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      await runMiddleware(req, res, upload.single("resumeFile"));
      jobUrl = req.body?.jobUrl;
      jobDescription = req.body?.jobDescription;
      resumeText = req.body?.resumeText || "";
      file = req.file;
    } else {
      const body = await parseJsonBody(req);
      jobUrl = body.jobUrl;
      jobDescription = body.jobDescription;
      resumeText = body.resumeText || "";
    }

    if (file) resumeText = await parseResumeFile(file);
    if (!resumeText) return res.status(400).json({ error: "A resume file or resume text is required." });

    const prompt = `You are Resume Rodent, a professional resume advisor.
Given the job page URL and the applicant's resume text below, do the following:
1) Summarize the best fit between the resume and the job.
2) Identify 2-3 missing evidence gaps or weak fit areas.
3) Ask one honest follow-up question that will help the candidate fill those gaps.
4) Do not invent new experience or qualifications.

Job URL: ${jobUrl || "(no URL provided)"}
Job description:
${jobDescription || "(no job description provided)"}

Candidate resume:
${resumeText}

Respond with a concise analysis and then a single follow-up question for the candidate.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }]
    });

    const assistant = message.content[0]?.text || "";
    return res.status(200).json({ assistant, resumeText });
  } catch (err) {
    console.error("[exchange]", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}
