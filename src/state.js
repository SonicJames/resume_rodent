const STORAGE_KEY = "ai-job-application-copilot-state";

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
  dashboardFilter: "active",
  job: {
    title: "",
    company: "",
    url: "",
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

export const loadState = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  const initial = createInitialState();

  if (!stored) {
    return initial;
  }

  try {
    const parsed = JSON.parse(stored);
    return {
      ...initial,
      ...parsed,
      job: {
        ...initial.job,
        ...parsed.job
      },
      resume: {
        ...initial.resume,
        ...parsed.resume
      },
      outputs: {
        ...initial.outputs,
        ...parsed.outputs
      },
      followUpAnswers: {
        ...initial.followUpAnswers,
        ...parsed.followUpAnswers
      }
    };
  } catch (error) {
    console.warn("Unable to restore saved state", error);
    return initial;
  }
};

export const saveState = (state) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
