const STORAGE_KEY = "ai-job-application-copilot-state";

const stateLog = (event, payload) => {
  console.log(`[AI Copilot State] ${event}`, payload ?? "");
};

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

  stateLog("load:start", {
    hasStoredState: Boolean(stored)
  });

  if (!stored) {
    stateLog("load:initial");
    return initial;
  }

  try {
    const parsed = JSON.parse(stored);
    stateLog("load:parsed", {
      hasUser: Boolean(parsed.user),
      currentStep: parsed.currentStep,
      experienceBankCount: parsed.experienceBank?.length || 0
    });
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
    console.warn("[AI Copilot State] load:error", error);
    return initial;
  }
};

export const saveState = (state) => {
  stateLog("save", {
    currentStep: state.currentStep,
    hasUser: Boolean(state.user),
    hasAnalysis: Boolean(state.analysis)
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
