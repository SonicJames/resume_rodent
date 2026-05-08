import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import dotenv from "dotenv";
import { Anthropic } from "@anthropic-ai/sdk";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicPath = path.join(__dirname, "public");
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json());
app.use(express.static(publicPath));
app.get("/", (req, res) => res.sendFile(path.join(publicPath, "index.html")));

const claudeKey = process.env.CLAUDE_API_KEY;
if (!claudeKey) {
  console.error("Missing CLAUDE_API_KEY environment variable.");
}

const client = new Anthropic({ apiKey: claudeKey, apiUrl: process.env.CLAUDE_API_BASE });

const parseResumeFile = async (file) => {
  const fileName = file.originalname.toLowerCase();
  const buffer = file.buffer;

  if (fileName.endsWith(".txt") || fileName.endsWith(".md")) {
    return buffer.toString("utf-8");
  }

  if (fileName.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  }

  if (fileName.endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return data.text.trim();
  }

  throw new Error("Unsupported resume file type. Use .txt, .md, .docx, or .pdf.");
};

const getClaudeText = (response) => {
  if (!response?.output) return "";
  if (typeof response.output === "string") return response.output;
  if (Array.isArray(response.output)) {
    return response.output
      .flatMap((item) => item?.content ?? [])
      .map((part) => part?.text ?? "")
      .join("");
  }
  return "";
};

const createClaudeReply = async (prompt) => {
  if (!claudeKey) throw new Error("CLAUDE_API_KEY must be set to call Claude.");

  const result = await client.responses.create({
    model: process.env.CLAUDE_MODEL || "claude-3.5-mini",
    input: prompt,
    max_tokens_to_sample: 1800,
    temperature: 0.25
  });

  return getClaudeText(result);
};

const buildAnalysisPrompt = ({ jobUrl, jobDescription, resumeText }) => `You are Resume Rodent, a professional resume advisor.
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

const buildChatPrompt = ({ jobUrl, jobDescription, resumeText, conversation }) => {
  const history = conversation
    .map((message) => {
      const label = message.role === "assistant" ? "Assistant" : "Candidate";
      return `${label}: ${message.content}`;
    })
    .join("\n");

  return `You are Resume Rodent, a resume advisor helping a candidate turn an uploaded resume into a stronger application.
Use the job URL, job description, resume text, and conversation history to provide the next helpful response.
Do not invent qualifications or accomplishments. If evidence is missing, ask for precise, real examples.

Job URL: ${jobUrl || "(no URL provided)"}
Job description:
${jobDescription || "(no job description provided)"}

Candidate resume:
${resumeText}

Conversation:
${history}

Assistant:`;
};

const buildExportPrompt = ({ jobUrl, jobDescription, resumeText, conversation }) => {
  const history = conversation
    .map((message) => {
      const label = message.role === "assistant" ? "Assistant" : "Candidate";
      return `${label}: ${message.content}`;
    })
    .join("\n");

  return `You are Resume Rodent. Create a polished, ATS-friendly resume text for the candidate based on the job details and the conversation.
Use only evidence present in the resume or provided by the candidate in the chat. Do not fabricate accomplishments.
Format the result as a professional resume with sections such as Name, Contact, Summary, Experience, Skills, and Education.

Job URL: ${jobUrl || "(no URL provided)"}
Job description:
${jobDescription || "(no job description provided)"}

Candidate resume:
${resumeText}

Conversation:
${history}

Output only the resume text to include in the PDF.`;
};

app.post("/api/exchange", upload.single("resumeFile"), async (req, res) => {
  try {
    const { jobUrl, jobDescription } = req.body;
    const resumeTextFromBody = `${req.body.resumeText || ""}`.trim();
    const resumeText = req.file
      ? await parseResumeFile(req.file)
      : resumeTextFromBody;

    if (!resumeText) {
      return res.status(400).json({ error: "A resume file or resume text is required." });
    }

    const prompt = buildAnalysisPrompt({ jobUrl, jobDescription, resumeText });
    const assistant = await createClaudeReply(prompt);

    return res.json({ assistant, resumeText });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Server error" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { jobUrl, jobDescription, resumeText, conversation } = req.body;
    if (!Array.isArray(conversation) || !resumeText) {
      return res.status(400).json({ error: "Conversation and resume text are required." });
    }

    const prompt = buildChatPrompt({ jobUrl, jobDescription, resumeText, conversation });
    const assistant = await createClaudeReply(prompt);
    return res.json({ assistant });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Server error" });
  }
});

app.post("/api/export", async (req, res) => {
  try {
    const { jobUrl, jobDescription, resumeText, conversation } = req.body;
    if (!resumeText || !Array.isArray(conversation)) {
      return res.status(400).json({ error: "Resume text and conversation are required for export." });
    }

    const prompt = buildExportPrompt({ jobUrl, jobDescription, resumeText, conversation });
    const resumeBody = await createClaudeReply(prompt);

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
      if (!line.trim()) {
        doc.moveDown(0.4);
        return;
      }
      if (/^#+\s*/.test(line) || /^[A-Z][A-Za-z ]{2,}:$/.test(line)) {
        doc.moveDown(0.3);
        doc.fontSize(13).font("Times-Bold").text(line.replace(/^#+\s*/, ""));
        doc.font("Times-Roman").fontSize(11);
      } else {
        doc.text(line, { lineGap: 2 });
      }
    });

    doc.end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Export failed." });
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Resume Rodent Claude MCP app listening on http://localhost:${port}`);
});
