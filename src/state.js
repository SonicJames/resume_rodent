export const steps = [
  { id: "job", label: "Job Intake" },
  { id: "resume", label: "Resume" },
  { id: "analysis", label: "Match Analysis" },
  { id: "followup", label: "Gap Questions" },
  { id: "outputs", label: "Application Pack" }
];

export const createInitialState = () => ({
  user: null,
  currentStep: "job",
  job: {
    title: "",
    company: "",
    url: "",
    location: "",
    salary: "",
    description: "",
    parsedRequirements: []
  },
  resume: {
    fileName: "",
    rawText: "",
    parsedHighlights: []
  },
  analysis: null,
  followUpAnswers: {},
  experienceBank: [
    {
      id: crypto.randomUUID(),
      title: "Led migration to modern frontend stack",
      category: "Engineering",
      details:
        "Migrated a customer dashboard from legacy templating to a component-based architecture, reducing release time by 35% and improving Lighthouse performance scores.",
      approved: true
    }
  ],
  outputs: {
    tailoredResume: "",
    coverLetter: "",
    applicationAnswers: "",
    interviewPrep: ""
  },
  suggestions: [],
  versionHistory: []
});
