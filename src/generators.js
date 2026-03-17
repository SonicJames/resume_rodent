const titleCase = (value) =>
  value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

export const buildSuggestions = ({ analysis, experienceBank }) => {
  const suggestions = [];

  if (analysis.missingKeywords.length) {
    suggestions.push({
      title: "Close the highest-value gaps first",
      reason: `The job stresses ${analysis.missingKeywords.slice(0, 3).map(titleCase).join(", ")}. Add verified examples before export.`
    });
  }

  if (analysis.strengths.length) {
    suggestions.push({
      title: "Lead with proven wins",
      reason: `Your strongest evidence comes from ${analysis.strengths[0].slice(0, 90)}. Move similar results higher in the tailored resume.`
    });
  }

  if (experienceBank.length < 3) {
    suggestions.push({
      title: "Grow the reusable experience bank",
      reason: "Saving a few approved stories now will speed up future applications and make follow-up answers sharper."
    });
  }

  return suggestions;
};

export const generateTailoredResume = ({ user, job, resume, analysis, experienceBank, followUpAnswers }) => {
  const approvedEvidence = Object.values(followUpAnswers)
    .filter(Boolean)
    .map((value) => `- ${value.trim()}`);
  const bankHighlights = experienceBank.slice(0, 4).map((entry) => `- ${entry.title}: ${entry.details}`);

  return `${user?.name || "Candidate"}
${user?.email || "candidate@email.com"} | ${user?.location || "London, UK"} | ${user?.linkedin || "linkedin.com/in/candidate"}

TARGET ROLE
${job.title} at ${job.company}

PROFESSIONAL SUMMARY
Results-oriented professional tailoring experience for ${job.title}. Background aligns with ${analysis.matchedKeywords
    .slice(0, 6)
    .map(titleCase)
    .join(", ")}. Focus areas include clarity, measurable outcomes, and job-relevant evidence without overstating qualifications.

KEY MATCH HIGHLIGHTS
${analysis.strengths.map((item) => `- ${item}`).join("\n") || "- Add stronger quantified achievements from the base resume."}

TARGETED KEYWORDS
${analysis.matchedKeywords.map((item) => `- ${titleCase(item)}`).join("\n") || "- Tailor language after more job details are added."}

APPROVED ADDITIONAL EVIDENCE
${approvedEvidence.join("\n") || "- No new evidence approved yet. Follow-up answers will appear here once confirmed."}

REUSABLE EXPERIENCE BANK
${bankHighlights.join("\n")}

BASE RESUME SOURCE
${resume.rawText.trim() || "Resume content pending upload or paste."}`;
};

export const generateCoverLetter = ({ user, job, analysis, followUpAnswers }) => {
  const proof = Object.values(followUpAnswers).find(Boolean);

  return `Dear Hiring Team,

I am excited to apply for the ${job.title} role at ${job.company}. My background aligns strongly with your needs in ${analysis.matchedKeywords
    .slice(0, 4)
    .map(titleCase)
    .join(", ")}.

What stands out most in this opportunity is the emphasis on relevance and execution. In my work, I have focused on delivering clear outcomes, collaborating cross-functionally, and turning ambiguous requirements into measurable progress. ${proof ? `One example I would highlight is ${proof.trim()}.` : "I am prepared to share additional verified examples where deeper evidence would be useful."}

I value a disciplined application process: tailoring materials carefully, filling gaps honestly, and presenting only experience I can substantiate. That approach matches how I would contribute to ${job.company}.

Thank you for your time and consideration. I would welcome the opportunity to discuss how I can support your team.

Sincerely,
${user?.name || "Candidate"}`;
};

export const generateApplicationAnswers = ({ job, analysis, followUpAnswers }) => {
  const approvedProof = Object.values(followUpAnswers).filter(Boolean);

  return `Why do you want this role?
I am interested in ${job.title} because it connects with my strengths in ${analysis.matchedKeywords
    .slice(0, 4)
    .map(titleCase)
    .join(", ")} and gives me room to contribute with focused, relevant execution.

Why are you a strong fit?
My experience already demonstrates ${analysis.strengths.join("; ") || "several relevant outcomes from my background"}. I am also proactively closing gaps by gathering verified evidence before submitting materials.

Tell us about a relevant project.
${approvedProof[0] || "Use a saved experience-bank story with a measurable outcome here."}

What might you still be developing?
One area I handle carefully is any requirement where my evidence is partial. I prefer to ask clarifying questions, strengthen proof, and present my fit honestly rather than overstate experience.`;
};

export const generateInterviewPrep = ({ job, analysis }) => `Interview themes for ${job.title}

1. Be ready to explain evidence around ${analysis.missingKeywords.slice(0, 3).map(titleCase).join(", ") || "the biggest open requirements"}.
2. Prepare quantified stories for ${analysis.matchedKeywords.slice(0, 4).map(titleCase).join(", ")}.
3. Expect questions about how you prioritize work, collaborate, and adapt to role-specific tools.

Story prompts
- What was the problem, your action, and the measurable result?
- Which stakeholder relationships mattered most?
- How did you improve clarity, speed, quality, or customer impact?

Preparation note
Only use examples you can stand behind. If an area is adjacent rather than direct, say that clearly and bridge it with transferable results.`;

export const createVersionSnapshot = ({ job, outputs, analysis }) => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toLocaleString(),
  label: `${job.title || "Application Pack"} - ${analysis?.fitRating || "Draft"}`,
  score: analysis?.score || 0,
  tailoredResume: outputs.tailoredResume,
  coverLetter: outputs.coverLetter
});
