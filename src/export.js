export const downloadTextFile = (filename, content) => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
};

export const buildApplicationPack = ({ job, outputs, analysis }) => `AI Job Application Copilot Export

Role: ${job.title}
Company: ${job.company}
Match Score: ${analysis?.score || "N/A"}
Fit Rating: ${analysis?.fitRating || "N/A"}

=== Tailored Resume ===
${outputs.tailoredResume}

=== Cover Letter ===
${outputs.coverLetter}

=== Application Answers ===
${outputs.applicationAnswers}

=== Interview Prep ===
${outputs.interviewPrep}
`;
