import React, { useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).href;
import { analyzeMatch, analyzeWithAI, extractPhrases, inferJobMeta } from "./analysis.js";
import {
  buildSuggestions,
  createVersionSnapshot,
  generateApplicationAnswers,
  generateCoverLetter,
  generateInterviewPrep,
  generateTailoredResume
} from "./generators.js";
import { buildApplicationPack, downloadTextFile } from "./export.js";
import { createInitialState, loadState, saveState, steps } from "./state.js";

const sampleJobDescription = `Title: Senior Product Marketing Manager
Company: Northstar AI

We are hiring a product marketing leader who can translate complex AI workflows into clear customer messaging. The role requires cross-functional collaboration with product, sales, and customer success teams, strong writing, launch planning, analytics, stakeholder management, and experience tailoring content for enterprise buyers. Familiarity with ATS optimization, interview prep, and application workflow tools is a plus.`;

const sampleResume = `Alex Morgan
Product marketing strategist with 6+ years of experience building go-to-market programs, launch messaging, and sales enablement materials for B2B SaaS teams.

Experience
- Led positioning and launch planning for a workflow automation product, partnering with product, design, and sales teams across three releases.
- Created customer-facing messaging, lifecycle content, and case studies that improved demo conversion by 18%.
- Built reporting dashboards that connected campaign performance to pipeline influence for leadership reviews.

Skills
Product marketing, messaging, analytics, stakeholder communication, content strategy, customer research`;

const appLog = (event, payload) => {
  console.log(`[AI Copilot] ${event}`, payload ?? "");
};

const ensureAnalysis = (baseState) => {
  const jobDescription = baseState.job.description.trim();
  const resumeText = baseState.resume.rawText.trim();

  appLog("ensureAnalysis:start", {
    hasJobDescription: Boolean(jobDescription),
    hasResumeText: Boolean(resumeText),
    experienceBankCount: baseState.experienceBank.length,
    followUpAnswerCount: Object.keys(baseState.followUpAnswers || {}).length
  });

  if (!jobDescription || !resumeText) {
    appLog("ensureAnalysis:skipped", {
      reason: !jobDescription ? "missing-job-description" : "missing-resume-text"
    });
    return baseState;
  }

  const analysis = analyzeMatch({
    jobDescription,
    resumeText,
    experienceBank: baseState.experienceBank
  });

  const outputs = {
    tailoredResume: generateTailoredResume({
      user: baseState.user,
      job: baseState.job,
      resume: baseState.resume,
      analysis,
      experienceBank: baseState.experienceBank,
      followUpAnswers: baseState.followUpAnswers
    }),
    coverLetter: generateCoverLetter({
      user: baseState.user,
      job: baseState.job,
      analysis,
      followUpAnswers: baseState.followUpAnswers
    }),
    applicationAnswers: generateApplicationAnswers({
      job: baseState.job,
      analysis,
      followUpAnswers: baseState.followUpAnswers
    }),
    interviewPrep: generateInterviewPrep({
      job: baseState.job,
      analysis
    })
  };

  return {
    ...baseState,
    analysis,
    outputs,
    suggestions: buildSuggestions({
      analysis,
      experienceBank: baseState.experienceBank
    })
  };
};

const AuthScreen = ({ onSignIn, darkMode, onToggleDark }) => {
  const [form, setForm] = useState({
    name: "Alex Morgan",
    email: "alex@example.com",
    location: "London, UK",
    linkedin: "linkedin.com/in/alexmorgan"
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    onSignIn(form);
  };

  return (
    <div className="landing-page">
      <header className="header">
        <div className="logo">
          <h1>Resume Rodent</h1>
          <p>AI Job Application Copilot</p>
        </div>
        <nav className="nav">
          <a href="#features">Features</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#pricing">Pricing</a>
          <button className="theme-toggle" type="button" onClick={onToggleDark} aria-label="Toggle dark mode">
            {darkMode ? "☀️" : "🌙"}
          </button>
        </nav>
      </header>
      <section className="hero-section">
        <div className="hero-content">
          <h1>Build a sharper, honest application pack in one guided workflow.</h1>
          <p className="hero-description">
            Tailor your resume to a role, surface proof gaps, save reusable stories, and export
            a complete pack without inventing experience.
          </p>
          <div className="hero-stats">
            <div className="stat">
              <strong>95%</strong>
              <span>of candidates abandon applications</span>
            </div>
            <div className="stat">
              <strong>5x</strong>
              <span>higher completion rate</span>
            </div>
          </div>
        </div>
        <div className="auth-card glass">
          <h2>Get Started</h2>
          <form className="stack" onSubmit={handleSubmit}>
            <label>
              Full name
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Location
              <input
                value={form.location}
                onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
              />
            </label>
            <label>
              LinkedIn or portfolio
              <input
                value={form.linkedin}
                onChange={(event) => setForm((current) => ({ ...current, linkedin: event.target.value }))}
              />
            </label>
            <button className="primary" type="submit">
              Sign in and open dashboard
            </button>
          </form>
        </div>
      </section>
    </div>
  );
};

const STEP_ICONS = { job: "💼", resume: "📄", analysis: "🎯", followup: "✍️", outputs: "📦" };

const StepRail = ({ state, onStepChange, darkMode, onToggleDark }) => (
  <aside className="rail glass">
    <div>
      <p className="eyebrow">Workflow</p>
      <h2>{state.job.title || "New application"}</h2>
      <p className="muted">{state.job.company || "No company selected yet"}</p>
    </div>
    <div className="step-list">
      {steps.map((step, index) => (
        <button
          key={step.id}
          className={`step ${state.currentStep === step.id ? "step-active" : ""}`}
          onClick={() => onStepChange(step.id)}
          type="button"
          title={step.label}
        >
          <span className="step-icon">{STEP_ICONS[step.id]}</span>
          <span className="step-index">0{index + 1}</span>
          <span className="step-label">{step.label}</span>
        </button>
      ))}
    </div>
    <div className="trust-panel">
      <h3>AI guardrails</h3>
      <ul>
        <li>Never fabricate experience or qualifications.</li>
        <li>Ask for proof where evidence is missing.</li>
        <li>Keep the user in control of every editable output.</li>
      </ul>
    </div>
    <button className="theme-toggle" type="button" onClick={onToggleDark} aria-label="Toggle dark mode">
      {darkMode ? "☀️" : "🌙"}
    </button>
  </aside>
);

const PanelSection = ({ className = "", stepId, children }) => (
  <section
    className={`panel ${className}`.trim()}
    {...(stepId ? { "data-step": stepId } : {})}
  >
    {children}
  </section>
);

const ListOrFallback = ({ items, fallback }) => (
  <ul>{items.length ? items.map((item) => <li key={item}>{item}</li>) : <li>{fallback}</li>}</ul>
);

export default function App() {
  const [state, setState] = useState(() => {
    const initial = loadState();
    appLog("state:init", {
      hasUser: Boolean(initial.user),
      currentStep: initial.currentStep,
      experienceBankCount: initial.experienceBank.length,
      versionHistoryCount: initial.versionHistory.length
    });
    return initial.user ? ensureAnalysis(initial) : initial;
  });

  useEffect(() => {
    appLog("state:save", {
      currentStep: state.currentStep,
      hasAnalysis: Boolean(state.analysis),
      experienceBankCount: state.experienceBank.length,
      versionHistoryCount: state.versionHistory.length
    });
    saveState(state);
  }, [state]);

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("resume-rodent-dark") === "true"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("resume-rodent-dark", darkMode);
  }, [darkMode]);

  const toggleDark = () => setDarkMode((d) => !d);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const runAIAnalysis = (jobDescription, resumeText, experienceBank) => {
    if (!jobDescription || !resumeText) return;
    setIsAnalyzing(true);
    analyzeWithAI({ jobDescription, resumeText, experienceBank })
      .then((aiResult) => {
        setState((current) => ({
          ...current,
          analysis: { ...current.analysis, ...aiResult }
        }));
      })
      .catch((err) => {
        console.warn("[App] AI analysis failed, keeping local result:", err.message);
      })
      .finally(() => setIsAnalyzing(false));
  };

  const updateState = (updater) => {
    setState((current) => updater(current));
  };

  const signIn = (user) => {
    appLog("auth:sign-in", { email: user.email, location: user.location });
    updateState((current) => ({
      ...current,
      user,
      currentStep: "job"
    }));
  };

  const handleJobSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const description = `${formData.get("description") || ""}`.trim();
    const url = `${formData.get("url") || ""}`.trim();
    const meta = inferJobMeta(description, url || "https://example.com");

    appLog("job:submit", {
      url,
      descriptionLength: description.length,
      inferredTitle: meta.title,
      inferredCompany: meta.company
    });

    updateState((current) => {
      const next = ensureAnalysis({
        ...current,
        currentStep: "resume",
        job: {
          ...current.job,
          ...meta,
          url,
          description,
          parsedRequirements: extractPhrases(description)
        }
      });
      if (next.resume.rawText) {
        runAIAnalysis(description, next.resume.rawText, next.experienceBank);
      }
      return next;
    });
  };

  const handleResumeSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rawText = `${formData.get("resume") || ""}`.trim();

    appLog("resume:submit", {
      length: rawText.length
    });

    updateState((current) => {
      const next = ensureAnalysis({
        ...current,
        currentStep: "analysis",
        resume: {
          ...current.resume,
          rawText,
          parsedHighlights: extractPhrases(rawText)
        }
      });
      if (next.job.description) {
        runAIAnalysis(next.job.description, rawText, next.experienceBank);
      }
      return next;
    });
  };

  const handleFileUpload = async (event) => {
    const [file] = event.target.files || [];

    if (!file) {
      appLog("resume:file-upload-skipped", { reason: "no-file-selected" });
      return;
    }

    appLog("resume:file-upload", {
      name: file.name,
      size: file.size,
      type: file.type
    });

    let rawText;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) =>
          pdf.getPage(i + 1).then((page) => page.getTextContent())
        )
      );
      rawText = pages
        .flatMap((content) => content.items.map((item) => item.str))
        .join(" ")
        .replace(/ {2,}/g, "\n");
    } else {
      rawText = await file.text();
    }

    updateState((current) => {
      const next = ensureAnalysis({
        ...current,
        resume: {
          ...current.resume,
          fileName: file.name,
          rawText,
          parsedHighlights: extractPhrases(rawText)
        }
      });
      if (next.job.description) {
        runAIAnalysis(next.job.description, rawText, next.experienceBank);
      }
      return next;
    });
  };

  const refreshOutputs = () => {
    appLog("outputs:refresh", {
      currentStep: state.currentStep
    });
    updateState((current) => ensureAnalysis({ ...current }));
    if (state.job.description && state.resume.rawText) {
      runAIAnalysis(state.job.description, state.resume.rawText, state.experienceBank);
    }
  };

  const saveFollowUpAnswer = (keyword, value) => {
    appLog("followup:change", {
      keyword,
      valueLength: value.length
    });
    updateState((current) => ({
      ...current,
      followUpAnswers: {
        ...current.followUpAnswers,
        [keyword]: value
      }
    }));
  };

  const approveExperience = (keyword) => {
    const details = state.followUpAnswers[keyword]?.trim();

    if (!details) {
      appLog("experience:approve-skipped", {
        keyword,
        reason: "missing-details"
      });
      return;
    }

    appLog("experience:approve", {
      keyword,
      detailLength: details.length
    });

    updateState((current) =>
      ensureAnalysis({
        ...current,
        experienceBank: [
          {
            id: crypto.randomUUID(),
            title: `Approved evidence for ${keyword}`,
            category: "User Approved",
            details,
            approved: true
          },
          ...current.experienceBank
        ],
        currentStep: "outputs"
      })
    );
  };

  const updateOutput = (key, value) => {
    appLog("output:edit", {
      key,
      valueLength: value.length
    });
    updateState((current) => ({
      ...current,
      outputs: {
        ...current.outputs,
        [key]: value
      }
    }));
  };

  const addSnapshot = () => {
    appLog("history:save-version", {
      title: state.job.title,
      score: state.analysis?.score || null
    });
    updateState((current) => ({
      ...current,
      versionHistory: [
        createVersionSnapshot({
          job: current.job,
          outputs: current.outputs,
          analysis: current.analysis
        }),
        ...current.versionHistory
      ]
    }));
  };

  const exportPack = () => {
    appLog("export:start", {
      title: state.job.title,
      company: state.job.company,
      hasAnalysis: Boolean(state.analysis)
    });
    const content = buildApplicationPack({
      job: state.job,
      outputs: state.outputs,
      analysis: state.analysis
    });
    const safeTitle = (state.job.title || "application-pack").toLowerCase().replace(/\s+/g, "-");
    downloadTextFile(`${safeTitle}-application-pack.txt`, content);
  };

  const useSampleJob = () => {
    appLog("sample:job");
    updateState((current) => ({
      ...current,
      job: {
        ...current.job,
        ...inferJobMeta(sampleJobDescription, "https://northstar.example/jobs"),
        url: "https://northstar.example/jobs",
        description: sampleJobDescription,
        parsedRequirements: extractPhrases(sampleJobDescription)
      }
    }));
  };

  const useSampleResume = () => {
    appLog("sample:resume");
    updateState((current) => {
      const next = ensureAnalysis({
        ...current,
        resume: {
          ...current.resume,
          fileName: "alex-morgan-resume.txt",
          rawText: sampleResume,
          parsedHighlights: extractPhrases(sampleResume)
        }
      });
      if (next.job.description) {
        runAIAnalysis(next.job.description, sampleResume, next.experienceBank);
      }
      return next;
    });
  };

  const handleClear = () => {
    const initial = createInitialState();
    updateState((current) => ({
      ...initial,
      user: current.user,
      experienceBank: current.experienceBank
    }));
  };

  if (!state.user) {
    appLog("render:auth-screen");
    return <AuthScreen onSignIn={signIn} darkMode={darkMode} onToggleDark={toggleDark} />;
  }

  appLog("render:app", {
    currentStep: state.currentStep,
    hasAnalysis: Boolean(state.analysis),
    gapCount: state.analysis?.gaps?.length || 0
  });

  return (
    <div className="app-shell">
      <StepRail
        state={state}
        onStepChange={(stepId) => updateState((current) => ({ ...current, currentStep: stepId }))}
        darkMode={darkMode}
        onToggleDark={toggleDark}
      />
      <main className="content" data-current-step={state.currentStep}>
        <section className="hero glass">
          <div>
            <p className="eyebrow">Dashboard</p>
            <h1>Ship a complete application pack with explainable AI support.</h1>
            <p className="lede">
              Start with the job, compare it to your resume, then strengthen the missing evidence
              before exporting tailored documents.
            </p>
          </div>
          <div className="hero-metrics">
            <div className="metric-card">
              <span>Active role</span>
              <strong>{state.job.title || "No role yet"}</strong>
            </div>
            <div className="metric-card">
              <span>Match score</span>
              <strong>{state.analysis ? `${state.analysis.score}%` : "--"}</strong>
            </div>
            <div className="metric-card">
              <span>Saved stories</span>
              <strong>{state.experienceBank.length}</strong>
            </div>
            <button className="ghost" type="button" onClick={handleClear}>
              Clear job &amp; resume
            </button>
          </div>
        </section>

        <PanelSection stepId="job">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">1. Job intake</p>
              <h2>Bring in the role you want to target</h2>
            </div>
            <button className="ghost" type="button" onClick={useSampleJob}>
              Load sample role
            </button>
          </div>
          <form className="stack" onSubmit={handleJobSubmit}>
            <label>
              Job URL
              <input
                name="url"
                placeholder="https://company.com/jobs/role"
                value={state.job.url}
                onChange={(event) =>
                  updateState((current) => ({
                    ...current,
                    job: {
                      ...current.job,
                      url: event.target.value
                    }
                  }))
                }
              />
            </label>
            <label>
              Job description
              <textarea
                name="description"
                rows="12"
                placeholder="Paste the job post text here"
                value={state.job.description}
                onChange={(event) =>
                  updateState((current) => ({
                    ...current,
                    job: {
                      ...current.job,
                      description: event.target.value
                    }
                  }))
                }
              />
            </label>
            <button className="primary" type="submit">
              Parse job and continue
            </button>
          </form>
          <div className="pill-row">
            {state.job.parsedRequirements.map((item) => (
              <span className="pill" key={item}>
                {item}
              </span>
            ))}
          </div>
        </PanelSection>

        <PanelSection stepId="resume">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">2. Resume upload</p>
              <h2>Upload or paste your current resume</h2>
            </div>
            <button className="ghost" type="button" onClick={useSampleResume}>
              Load sample resume
            </button>
          </div>
          <div className="split">
            <form className="stack" onSubmit={handleResumeSubmit}>
              <label>
                Paste resume text
                <textarea
                  name="resume"
                  rows="14"
                  placeholder="Paste your resume text or upload a PDF / plain-text file"
                  value={state.resume.rawText}
                  onChange={(event) =>
                    updateState((current) => ({
                      ...current,
                      resume: {
                        ...current.resume,
                        rawText: event.target.value
                      }
                    }))
                  }
                />
              </label>
              <button className="primary" type="submit">
                Parse resume
              </button>
            </form>
            <div className="stack">
              <label className="upload-card">
                <span>Upload a PDF, `.txt`, or `.md` resume</span>
                <input type="file" accept=".pdf,.txt,.md,.text" onChange={handleFileUpload} />
              </label>
              <div className="subtle-card">
                <h3>Current source</h3>
                <p>{state.resume.fileName || "No file uploaded yet"}</p>
              </div>
              <div className="subtle-card">
                <h3>Parsed highlights</h3>
                <ListOrFallback
                  items={state.resume.parsedHighlights}
                  fallback="Resume highlights will appear here after parsing."
                />
              </div>
            </div>
          </div>
        </PanelSection>

        <PanelSection stepId="analysis">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">3. Match analysis</p>
              <h2>See the fit, the strengths, and the evidence gaps</h2>
            </div>
            <button className="ghost" type="button" onClick={refreshOutputs}>
              Refresh analysis
            </button>
          </div>
          {isAnalyzing && (
            <div className="empty-state" style={{ marginBottom: "0.75rem", borderStyle: "solid", borderColor: "var(--accent)", color: "var(--accent-strong)" }}>
              Analyzing with AI — semantic match in progress...
            </div>
          )}
          {!state.analysis ? (
            <div className="empty-state">Complete the job and resume steps to generate an analysis.</div>
          ) : (
            <>
              <div className="metric-grid">
                <div className="score-card accent">
                  <span>ATS match score</span>
                  <strong>{state.analysis.score}%</strong>
                  <p>{state.analysis.fitRating}</p>
                </div>
                <div className="score-card">
                  <span>Matched keywords</span>
                  <strong>{state.analysis.matchedKeywords.length}</strong>
                </div>
                <div className="score-card">
                  <span>Missing keywords</span>
                  <strong>{state.analysis.missingKeywords.length}</strong>
                </div>
              </div>
              {state.analysis.requirements?.length > 0 && (
                <div className="subtle-card">
                  <h3>Hard requirements</h3>
                  <ul className="requirement-list">
                    {state.analysis.requirements.map((req, i) => (
                      <li key={i} className={`requirement-item ${req.met ? "requirement-met" : "requirement-unmet"}`}>
                        <span className="requirement-badge">{req.label}</span>
                        <span className="requirement-text">{req.text}</span>
                        <span className="requirement-status">{req.met ? "✓ addressed" : "✗ not found in resume"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="comparison-grid">
                <div className="subtle-card">
                  <h3>Strengths</h3>
                  <ListOrFallback items={state.analysis.strengths} fallback="No strengths surfaced yet." />
                </div>
                <div className="subtle-card">
                  <h3>Gaps</h3>
                  <ListOrFallback
                    items={state.analysis.gaps.map((gap) => `${gap.keyword}: ${gap.prompt}`)}
                    fallback="No major gaps detected."
                  />
                </div>
                <div className="subtle-card">
                  <h3>Missing keywords</h3>
                  <div className="pill-row">
                    {state.analysis.missingKeywords.map((item) => (
                      <span className="pill warn" key={item}>
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="subtle-card">
                  <h3>Why these suggestions?</h3>
                  <ListOrFallback
                    items={state.suggestions.map((item) => `${item.title}: ${item.reason}`)}
                    fallback="Suggestions will appear after analysis."
                  />
                </div>
              </div>
            </>
          )}
        </PanelSection>

        <PanelSection stepId="followup">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">4. Gap follow-up</p>
              <h2>Capture only user-approved evidence</h2>
            </div>
          </div>
          {!state.analysis?.gaps?.length ? (
            <div className="empty-state">No follow-up questions yet. Generate an analysis first.</div>
          ) : (
            <div className="followup-list">
              {state.analysis.gaps.map((gap) => (
                <article className="subtle-card" key={gap.keyword}>
                  <div className="followup-head">
                    <div>
                      <p className="eyebrow">{gap.type.replace("-", " ")}</p>
                      <h3>{gap.keyword}</h3>
                    </div>
                    <button className="ghost" type="button" onClick={() => approveExperience(gap.keyword)}>
                      Save to experience bank
                    </button>
                  </div>
                  <p>{gap.prompt}</p>
                  <textarea
                    rows="5"
                    placeholder="Add a truthful, specific example with context, actions, and measurable results where possible."
                    value={state.followUpAnswers[gap.keyword] || ""}
                    onChange={(event) => saveFollowUpAnswer(gap.keyword, event.target.value)}
                    onBlur={refreshOutputs}
                  />
                </article>
              ))}
            </div>
          )}
        </PanelSection>

        <PanelSection stepId="outputs">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">5. Application pack</p>
              <h2>Edit, save, and export the final materials</h2>
            </div>
            <div className="panel-actions">
              <button className="ghost" type="button" onClick={addSnapshot}>
                Save version
              </button>
              <button className="primary" type="button" onClick={exportPack}>
                Export pack
              </button>
            </div>
          </div>
          <div className="output-grid">
            <div className="editor-card">
              <div className="editor-head">
                <h3>Tailored resume</h3>
                <p className="muted">AI rewrites for relevance, but leaves final approval to you.</p>
              </div>
              <textarea
                rows="18"
                value={state.outputs.tailoredResume}
                onChange={(event) => updateOutput("tailoredResume", event.target.value)}
              />
            </div>
            <div className="editor-card">
              <div className="editor-head">
                <h3>Cover letter</h3>
                <p className="muted">Grounded in verified evidence and job-specific language.</p>
              </div>
              <textarea
                rows="18"
                value={state.outputs.coverLetter}
                onChange={(event) => updateOutput("coverLetter", event.target.value)}
              />
            </div>
            <div className="editor-card">
              <div className="editor-head">
                <h3>Application answers</h3>
                <p className="muted">Drafts for likely screening questions.</p>
              </div>
              <textarea
                rows="12"
                value={state.outputs.applicationAnswers}
                onChange={(event) => updateOutput("applicationAnswers", event.target.value)}
              />
            </div>
            <div className="editor-card">
              <div className="editor-head">
                <h3>Interview prep</h3>
                <p className="muted">Practice themes, proof points, and honest bridges.</p>
              </div>
              <textarea
                rows="12"
                value={state.outputs.interviewPrep}
                onChange={(event) => updateOutput("interviewPrep", event.target.value)}
              />
            </div>
          </div>
        </PanelSection>

        <PanelSection>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Reusable context</p>
              <h2>Experience bank</h2>
            </div>
          </div>
          <div className="bank-grid">
            {state.experienceBank.map((entry) => (
              <article className="subtle-card" key={entry.id}>
                <p className="eyebrow">{entry.category}</p>
                <h3>{entry.title}</h3>
                <p>{entry.details}</p>
              </article>
            ))}
          </div>
        </PanelSection>

        <PanelSection>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Traceability</p>
              <h2>Version history</h2>
            </div>
          </div>
          <div className="history-list">
            {state.versionHistory.length ? (
              state.versionHistory.map((entry) => (
                <article className="subtle-card history-item" key={entry.id}>
                  <div>
                    <h3>{entry.label}</h3>
                    <p className="muted">{entry.createdAt}</p>
                  </div>
                  <strong>{entry.score}%</strong>
                </article>
              ))
            ) : (
              <div className="empty-state">Saved resume and cover letter versions will appear here.</div>
            )}
          </div>
        </PanelSection>
      </main>
    </div>
  );
}
