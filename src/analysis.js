const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "an",
  "and",
  "are",
  "because",
  "been",
  "being",
  "but",
  "for",
  "from",
  "have",
  "into",
  "more",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "with",
  "your"
]);

const analysisLog = (event, payload) => {
  console.log(`[AI Copilot Analysis] ${event}`, payload ?? "");
};

const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const extractKeywords = (text, limit = 18) => {
  const normalized = normalize(text);
  const tokens = normalized.split(" ");
  const counts = new Map();

  for (const token of tokens) {
    if (token.length < 4 || STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);

  analysisLog("extract-keywords", {
    textLength: text.length,
    limit,
    keywordCount: keywords.length
  });

  return keywords;
};

export const extractPhrases = (text) => {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•*-]+/, "").trim())
    .filter(Boolean);

  const phrases = lines
    .filter((line) => /experience|skill|build|lead|manage|design|develop|stakeholder|analytics|strategy|product|resume|cover|customer/i.test(line))
    .slice(0, 12);

  analysisLog("extract-phrases", {
    textLength: text.length,
    phraseCount: phrases.length
  });

  return phrases;
};

export const inferJobMeta = (text, url) => {
  const titleMatch = text.match(/(?:role|position|title)\s*[:|-]\s*([^\n]+)/i);
  const companyMatch = text.match(/(?:company|team|organization)\s*[:|-]\s*([^\n]+)/i);
  let domain = "";

  if (url) {
    try {
      domain = new URL(url).hostname.replace("www.", "");
    } catch (error) {
      domain = "";
    }
  }

  const meta = {
    title: titleMatch?.[1]?.trim() || "Target Role",
    company: companyMatch?.[1]?.trim() || (domain ? domain.split(".")[0] : "Prospective Employer")
  };

  analysisLog("infer-job-meta", {
    url,
    title: meta.title,
    company: meta.company
  });

  return meta;
};

export const analyzeMatch = ({ jobDescription, resumeText, experienceBank }) => {
  const jobKeywords = extractKeywords(jobDescription, 20);
  const resumeKeywords = extractKeywords(resumeText, 20);
  const resumeNormalized = normalize(`${resumeText} ${experienceBank.map((entry) => entry.details).join(" ")}`);
  const matchedKeywords = jobKeywords.filter((keyword) => resumeNormalized.includes(keyword));
  const missingKeywords = jobKeywords.filter((keyword) => !resumeNormalized.includes(keyword));
  const strengths = extractPhrases(resumeText)
    .filter((phrase) => matchedKeywords.some((keyword) => phrase.toLowerCase().includes(keyword)))
    .slice(0, 4);
  const gapAreas = missingKeywords.slice(0, 4).map((keyword) => {
    const matchingEntry = experienceBank.find((entry) => entry.details.toLowerCase().includes(keyword));
    return matchingEntry
      ? { keyword, type: "needs-proof", prompt: `You mention ${keyword} indirectly. What measurable example should we add?` }
      : { keyword, type: "missing-evidence", prompt: `What real experience can you share that proves your fit for ${keyword}?` };
  });
  const score = Math.max(32, Math.min(96, Math.round((matchedKeywords.length / Math.max(jobKeywords.length, 1)) * 100)));

  const result = {
    score,
    fitRating: score > 84 ? "Strong fit" : score > 68 ? "Promising fit" : score > 52 ? "Partial fit" : "Needs evidence",
    matchedKeywords,
    missingKeywords,
    strengths: strengths.length ? strengths : extractPhrases(resumeText).slice(0, 3),
    gaps: gapAreas,
    jobKeywords,
    resumeKeywords
  };

  analysisLog("analyze-match", {
    score: result.score,
    fitRating: result.fitRating,
    matchedKeywords: matchedKeywords.length,
    missingKeywords: missingKeywords.length,
    gapCount: gapAreas.length
  });

  return result;
};
