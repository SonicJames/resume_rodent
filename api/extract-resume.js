import mammoth from "mammoth";
import pdfParse from "pdf-parse";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body;
  try {
    body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(JSON.parse(data || "{}")));
    });
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const { fileBase64, fileName = "" } = body;
  if (!fileBase64) return res.status(400).json({ error: "fileBase64 required" });

  const buffer = Buffer.from(fileBase64, "base64");
  const name = fileName.toLowerCase();

  try {
    let text;
    if (name.endsWith(".docx")) {
      text = (await mammoth.extractRawText({ buffer })).value.trim();
    } else if (name.endsWith(".pdf")) {
      text = (await pdfParse(buffer)).text.trim();
    } else {
      text = buffer.toString("utf-8").trim();
    }
    return res.status(200).json({ text });
  } catch (err) {
    console.error("[extract-resume]", err);
    return res.status(500).json({ error: "Parse error: " + err.message });
  }
}
