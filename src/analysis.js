const REQUIREMENT_PATTERNS = [
  {
    type: "physical",
    label: "Physical",
    pattern: /(?:must\s+be\s+able\s+to\s+)?(?:lift(?:ing)?|carry(?:ing)?|push(?:ing)?|pull(?:ing)?|stand(?:ing)?|walk(?:ing)?)(?:[^.]{0,60}?\b(?:\d+\s*(?:lbs?|pounds?|kg|kilograms?)|hours?\s+(?:per\s+day|a\s+day|daily)|all\s+day)\b)?/gi
  },
  {
    type: "license",
    label: "License / driving",
    pattern: /(?:valid\s+)?(?:driver['']?s?\s+licen[cs]e|CDL|commercial\s+driver|forklift\s+certif)/gi
  },
  {
    type: "education",
    label: "Education",
    pattern: /(?:bachelor['']?s?|master['']?s?|phd|ph\.d|doctorate|associate['']?s?|mba|msc|bsc|ba\b|bs\b)(?:\s+(?:degree|of\s+science|of\s+arts|in\s+[a-z\s]+?))?(?:\s+(?:required|preferred|or\s+equivalent))?/gi
  },
  {
    type: "certification",
    label: "Certification",
    pattern: /\b(?:PMP|CPA|CFA|CISSP|CISM|CISA|AWS\s+Certified|Azure\s+Certified|GCP|Six\s+Sigma|Lean|Scrum\s+Master|CSM|SHRM|PHR|SPHR|CAPM|CompTIA|CCNA|CCNP|CCIE|CEH|OSCP|CKA|Salesforce\s+Certified|Google\s+Analytics\s+Certified)\b|(?:certified|licensure|licensed)\s+(?:in|as)\s+[a-z\s,]+/gi
  },
  {
    type: "experience",
    label: "Years of experience",
    pattern: /\d+\+?\s+years?\s+(?:of\s+)?(?:experience|working|work\s+experience)\s+(?:in|with|as|using|of)\s+[^,.\n]{3,60}/gi
  },
  {
    type: "clearance",
    label: "Security clearance",
    pattern: /security\s+clearance|secret\s+clearance|top\s+secret|ts\/sci|dod\s+clearance|government\s+clearance|cleared\b/gi
  },
  {
    type: "travel",
    label: "Travel",
    pattern: /(?:willing\s+to\s+travel|travel\s+(?:up\s+to\s+\d+\s*%|required|frequently|regularly|occasionally)|frequent\s+travel|\d+\s*%\s+travel)/gi
  },
  {
    type: "authorization",
    label: "Work authorization",
    pattern: /(?:authorized|eligible|legally\s+entitled)\s+to\s+work|work\s+authorization|right\s+to\s+work|visa\s+sponsorship\s+(?:not\s+)?available|must\s+be\s+(?:a\s+)?(?:us\s+citizen|citizen)/gi
  },
  {
    type: "availability",
    label: "Availability",
    pattern: /(?:available\s+to\s+work\s+)?(?:weekends?|nights?|evenings?|holidays?|on-?call|rotating\s+shifts?|shift\s+work|overnight)/gi
  }
];

const REQUIREMENT_RESUME_SIGNALS = {
  physical: /\b(?:lift(?:ed|ing)?|carry(?:ied|ing)?|warehouse|logistics|manual|physical|forklift|labour|labor)\b/i,
  license: /\b(?:driver['']?s?\s+licens|CDL|licensed\s+driver|own\s+(?:vehicle|transport|car))\b/i,
  education: /\b(?:bachelor|master|phd|degree|diploma|university|college|graduate|mba|msc|bsc)\b/i,
  certification: /\b(?:certified|certification|certificate|licensed|accredited|credentialed)\b/i,
  experience: null,
  clearance: /\b(?:clearance|cleared|secret|top\s+secret|ts\/sci|dod)\b/i,
  travel: /\b(?:travel(?:led|ing)?|relocation|relocat(?:ed|ing)|remote|international)\b/i,
  authorization: /\b(?:authorized|citizen|permanent\s+resident|green\s+card|work\s+permit|visa)\b/i,
  availability: /\b(?:weekend|night\s+shift|evening|holiday|on-?call|flexible\s+hours|shift)\b/i
};

export const extractRequirements = (jobDescription, resumeText) => {
  const resumeNorm = resumeText.toLowerCase();
  const seen = new Set();
  const requirements = [];

  for (const { type, label, pattern } of REQUIREMENT_PATTERNS) {
    const matches = [...jobDescription.matchAll(pattern)];
    for (const match of matches) {
      const raw = match[0].replace(/\s+/g, " ").trim();
      const key = `${type}:${raw.toLowerCase().slice(0, 40)}`;
      if (seen.has(key) || raw.length < 6) continue;
      seen.add(key);

      const signal = REQUIREMENT_RESUME_SIGNALS[type];
      let met;
      if (type === "experience") {
        const yearsMatch = raw.match(/(\d+)\+?\s+years?/i);
        const subject = raw.replace(/\d+\+?\s+years?\s+(?:of\s+)?(?:experience|working|work\s+experience)\s+(?:in|with|as|using|of)\s+/i, "").toLowerCase().trim();
        const subjectWords = subject.split(/\s+/).filter((w) => w.length > 3);
        met = subjectWords.some((w) => resumeNorm.includes(w));
      } else {
        met = signal ? signal.test(resumeText) : resumeNorm.includes(raw.toLowerCase().slice(0, 20));
      }

      requirements.push({ text: raw, type, label, met });
    }
  }

  analysisLog("extract-requirements", {
    found: requirements.length,
    unmet: requirements.filter((r) => !r.met).length
  });

  return requirements;
};

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
  const requirements = extractRequirements(jobDescription, resumeText);
  const score = Math.max(32, Math.min(96, Math.round((matchedKeywords.length / Math.max(jobKeywords.length, 1)) * 100)));

  const result = {
    score,
    fitRating: score > 84 ? "Strong fit" : score > 68 ? "Promising fit" : score > 52 ? "Partial fit" : "Needs evidence",
    matchedKeywords,
    missingKeywords,
    strengths: strengths.length ? strengths : extractPhrases(resumeText).slice(0, 3),
    gaps: gapAreas,
    requirements,
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
