import React, { useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
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
import { createInitialState, steps } from "./state.js";
import { auth, db, googleProvider } from "./firebase.js";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "firebase/firestore";


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

const sanitize = (obj) =>
  JSON.parse(JSON.stringify(obj, (_, v) => (v === undefined ? null : v)));

const ensureAnalysis = (baseState) => {
  const jobDescription = baseState.job.description.trim();
  const resumeText = baseState.resume.rawText.trim();

  if (!jobDescription || !resumeText) return baseState;

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
    suggestions: buildSuggestions({ analysis, experienceBank: baseState.experienceBank })
  };
};

const AuthScreen = ({ darkMode, onToggleDark, onToken }) => {
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState("");

  const handleGoogle = async () => {
    setSigningIn(true);
    setError("");
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) onToken?.(credential.accessToken);
    } catch (err) {
      console.error("[Auth] sign-in error:", err.code, err.message);
      if (err.code !== "auth/popup-closed-by-user") {
        setError("Sign-in failed. Please try again.");
      }
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="landing-page">
      <header className="header">
        <div className="logo">
          <h1>Resume Rodent</h1>
          <p>AI Job Application Copilot</p>
        </div>
        <nav className="nav">
          <button className="theme-toggle" type="button" onClick={onToggleDark} aria-label="Toggle dark mode">
            {darkMode ? "☀️" : "🌙"}
          </button>
        </nav>
      </header>
      <section className="hero-section">
        <div className="hero-content">
          <img src="/rat-hero.png" alt="Resume Rodent" className="rat-illustration" />
          <h1>Don't let AI hide your job applications.</h1>
          <p className="hero-description">
            Let Resume Rodent create accurate resumes and covering letters tailored to the job
            you're applying for.
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
          <p className="muted">Sign in with Google to save and track your applications.</p>
          <button className="google-btn" onClick={handleGoogle} disabled={signingIn} type="button">
            {signingIn ? "Signing in…" : "Continue with Google"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      </section>
    </div>
  );
};

const Dashboard = ({
  user,
  applications,
  onCreate,
  onOpen,
  onDelete,
  onSignOut,
  onDeleteAccount,
  darkMode,
  onToggleDark,
  showAccount,
  onToggleAccount
}) => (
  <div className="dashboard-shell">
    <header className="header">
      <div className="logo">
        <h1>Resume Rodent</h1>
      </div>
      <div className="header-actions">
        <button className="theme-toggle" type="button" onClick={onToggleDark} aria-label="Toggle dark mode">
          {darkMode ? "☀️" : "🌙"}
        </button>
        <button className="account-btn ghost" type="button" onClick={onToggleAccount}>
          {user.photoURL && (
            <img
              className="account-avatar"
              src={user.photoURL}
              alt=""
              referrerPolicy="no-referrer"
            />
          )}
          <span>{user.name || user.email}</span>
        </button>
      </div>
    </header>
    <main className="dashboard-main">
      <div className="dashboard-heading">
        <h2>My Applications</h2>
        <button
          className="primary"
          type="button"
          onClick={onCreate}
          disabled={applications.length >= 10}
        >
          {applications.length >= 10 ? "Limit reached (10)" : "New application"}
        </button>
      </div>
      <div className="app-grid">
        {applications.map((app) => (
          <article
            className="app-card glass"
            key={app.id}
            onClick={() => onOpen(app.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && onOpen(app.id)}
          >
            <div className="app-card-body">
              <h3>{app.job?.title || "Untitled role"}</h3>
              <p className="muted">{app.job?.company || "No company"}</p>
            </div>
            <div className="app-card-footer">
              {app.analysis?.score != null && (
                <strong className="app-card-score">{app.analysis.score}%</strong>
              )}
              <p className="muted app-card-date">
                {app.updatedAt?.toDate
                  ? new Date(app.updatedAt.toDate()).toLocaleDateString()
                  : ""}
              </p>
              <button
                className="ghost app-card-delete"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(app.id);
                }}
              >
                Remove
              </button>
            </div>
          </article>
        ))}
        {applications.length === 0 && (
          <div className="empty-state">
            No applications yet. Click &ldquo;New application&rdquo; to get started.
          </div>
        )}
      </div>
    </main>
    {showAccount && (
      <div className="account-panel glass">
        <div className="account-panel-head">
          <h3>Account</h3>
          <button className="ghost" type="button" onClick={onToggleAccount}>
            Close
          </button>
        </div>
        {user.photoURL && (
          <img
            className="account-avatar-lg"
            src={user.photoURL}
            alt=""
            referrerPolicy="no-referrer"
          />
        )}
        <p>
          <strong>{user.name}</strong>
        </p>
        <p className="muted">{user.email}</p>
        <div className="account-actions">
          <button className="ghost" type="button" onClick={onSignOut}>
            Sign out
          </button>
          <button className="danger-btn" type="button" onClick={onDeleteAccount}>
            Delete account
          </button>
        </div>
      </div>
    )}
  </div>
);

const STEP_ICONS = { job: "💼", resume: "📄", analysis: "🎯", followup: "✍️", outputs: "📦" };

const StepRail = ({ state, onStepChange, onBack, darkMode, onToggleDark }) => (
  <aside className="rail glass">
    <div>
      <button className="ghost back-btn" type="button" onClick={onBack}>
        ← My applications
      </button>
      <h2 style={{ marginTop: "0.75rem" }}>{state.job.title || "New application"}</h2>
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

const CHAT_GREETING = { role: "assistant", content: "What kind of role are you looking for?", jobs: null, _initial: true };

const JobFinderChat = ({ onImport }) => {
  const [messages, setMessages] = useState([CHAT_GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const threadRef = useRef(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: "user", content: input, jobs: null };
    const apiHistory = [...messages.filter((m) => !m._initial), userMsg].map(({ role, content }) => ({ role, content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/job-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiHistory })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages((prev) => [...prev, { role: "assistant", content: data.message, jobs: data.jobs || null }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Sorry, something went wrong: ${err.message}`, jobs: null }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="job-finder-chat">
      <div className="chat-thread" ref={threadRef}>
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            <p>{m.content}</p>
            {m.jobs?.map((job, j) => (
              <div key={job.id || j} className="job-result-card">
                <div className="job-card-info">
                  <strong>{job.title}</strong>
                  <span>{job.company}{job.location ? ` · ${job.location}` : ""}</span>
                  {job.salary && <span className="pill">{job.salary}</span>}
                </div>
                <button type="button" className="ghost" onClick={() => onImport(job)}>
                  Use This Job →
                </button>
              </div>
            ))}
          </div>
        ))}
        {loading && (
          <div className="chat-bubble assistant">
            <p className="muted">Searching…</p>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="e.g. Senior React developer in New York"
        />
        <button type="button" className="primary" onClick={send} disabled={loading || !input.trim()}>→</button>
      </div>
    </div>
  );
};

const ListOrFallback = ({ items, fallback }) => (
  <ul>{items.length ? items.map((item) => <li key={item}>{item}</li>) : <li>{fallback}</li>}</ul>
);

export default function App() {
  const [state, setState] = useState(() => createInitialState());
  const [authLoading, setAuthLoading] = useState(true);
  const [currentApplicationId, setCurrentApplicationId] = useState(null);
  const [applications, setApplications] = useState([]);
  const [showAccount, setShowAccount] = useState(false);
  const saveTimerRef = useRef(null);
  const googleTokenRef = useRef(null);

  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("resume-rodent-dark") === "true"
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("resume-rodent-dark", darkMode);
  }, [darkMode]);

  const toggleDark = () => setDarkMode((d) => !d);

  // Firebase auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const profileRef = doc(db, "users", fbUser.uid);
          const profileSnap = await getDoc(profileRef);
          let extra = {};
          if (profileSnap.exists()) {
            const data = profileSnap.data();
            extra = { location: data.location || "", linkedin: data.linkedin || "" };
          } else {
            await setDoc(profileRef, {
              name: fbUser.displayName || "",
              email: fbUser.email || "",
              location: "",
              linkedin: "",
              createdAt: serverTimestamp()
            });
          }
          setState((current) => ({
            ...current,
            user: {
              uid: fbUser.uid,
              photoURL: fbUser.photoURL || null,
              name: fbUser.displayName || "",
              email: fbUser.email || "",
              ...extra
            }
          }));
        } catch (err) {
          console.error("[App] auth state error:", err);
        }
      } else {
        setState((current) => ({ ...current, user: null }));
        setCurrentApplicationId(null);
        setApplications([]);
      }
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  // Real-time applications list
  useEffect(() => {
    if (!state.user?.uid) return;
    const q = query(
      collection(db, "users", state.user.uid, "applications"),
      orderBy("updatedAt", "desc")
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setApplications(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsubscribe;
  }, [state.user?.uid]);

  // Debounced auto-save to Firestore
  useEffect(() => {
    if (!state.user?.uid || !currentApplicationId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const appRef = doc(db, "users", state.user.uid, "applications", currentApplicationId);
        await setDoc(
          appRef,
          {
            ...sanitize({
              job: state.job,
              resume: state.resume,
              analysis: state.analysis,
              followUpAnswers: state.followUpAnswers,
              outputs: state.outputs,
              experienceBank: state.experienceBank,
              versionHistory: state.versionHistory,
              currentStep: state.currentStep
            }),
            updatedAt: serverTimestamp()
          },
          { merge: true }
        );
      } catch (err) {
        console.error("[App] Firestore save error:", err);
      }
    }, 1500);
    return () => clearTimeout(saveTimerRef.current);
  }, [
    state.job,
    state.resume,
    state.analysis,
    state.outputs,
    state.followUpAnswers,
    state.experienceBank,
    state.versionHistory,
    state.currentStep,
    currentApplicationId,
    state.user?.uid
  ]);

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

  const handleJobSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const description = `${formData.get("description") || ""}`.trim();
    const url = `${formData.get("url") || ""}`.trim();
    const meta = inferJobMeta(description, url || "https://example.com");

    appLog("job:submit", { url, descriptionLength: description.length });

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

    appLog("resume:submit", { length: rawText.length });

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
    if (!file) return;

    appLog("resume:file-upload", { name: file.name, size: file.size });

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
    updateState((current) => ensureAnalysis({ ...current }));
    if (state.job.description && state.resume.rawText) {
      runAIAnalysis(state.job.description, state.resume.rawText, state.experienceBank);
    }
  };

  const saveFollowUpAnswer = (keyword, value) => {
    updateState((current) => ({
      ...current,
      followUpAnswers: { ...current.followUpAnswers, [keyword]: value }
    }));
  };

  const approveExperience = (keyword) => {
    const details = state.followUpAnswers[keyword]?.trim();
    if (!details) return;

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
    updateState((current) => ({
      ...current,
      outputs: { ...current.outputs, [key]: value }
    }));
  };

  const addSnapshot = () => {
    updateState((current) => ({
      ...current,
      versionHistory: [
        createVersionSnapshot({ job: current.job, outputs: current.outputs, analysis: current.analysis }),
        ...current.versionHistory
      ]
    }));
  };

  const exportPack = () => {
    const content = buildApplicationPack({ job: state.job, outputs: state.outputs, analysis: state.analysis });
    const safeTitle = (state.job.title || "application-pack").toLowerCase().replace(/\s+/g, "-");
    downloadTextFile(`${safeTitle}-application-pack.txt`, content);
  };

  const [isScraping, setIsScraping] = useState(false);
  const [intakeMode, setIntakeMode] = useState("url");

  const handleImportFromChat = (job) => {
    const description = job.description || "";
    updateState((current) => {
      const next = ensureAnalysis({
        ...current,
        currentStep: "resume",
        job: {
          ...current.job,
          title: job.title || "",
          company: job.company || "",
          location: job.location || "",
          salary: job.salary || "",
          url: job.url || "",
          description,
          parsedRequirements: extractPhrases(description)
        }
      });
      if (next.resume.rawText) {
        runAIAnalysis(description, next.resume.rawText, next.experienceBank);
      }
      return next;
    });
    setIntakeMode("url");
  };

  const fetchJobFromUrl = async () => {
    const url = state.job.url.trim();
    if (!url) return;
    setIsScraping(true);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      if (data.description) {
        updateState((current) => {
          const next = {
            ...current,
            job: {
              ...current.job,
              title: data.title || current.job.title,
              location: data.location || current.job.location,
              salary: data.salary || current.job.salary,
              description: data.description,
              parsedRequirements: extractPhrases(data.description)
            }
          };
          if (next.resume.rawText) {
            runAIAnalysis(data.description, next.resume.rawText, next.experienceBank);
          }
          return next;
        });
      }
    } catch (err) {
      console.warn("[App] scrape failed:", err.message);
    } finally {
      setIsScraping(false);
    }
  };

  const useSampleResume = () => {
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

  // Application CRUD
  const openApplication = (appId) => {
    const app = applications.find((a) => a.id === appId);
    if (!app) return;
    const initial = createInitialState();
    setState((current) => ({
      ...current,
      job: app.job || initial.job,
      resume: app.resume || initial.resume,
      analysis: app.analysis || null,
      followUpAnswers: app.followUpAnswers || {},
      outputs: app.outputs || initial.outputs,
      experienceBank: app.experienceBank || initial.experienceBank,
      versionHistory: app.versionHistory || [],
      currentStep: app.currentStep || "job",
      suggestions: []
    }));
    setCurrentApplicationId(appId);
  };

  const createApplication = async () => {
    if (!state.user?.uid || applications.length >= 10) return;
    try {
      const initial = createInitialState();
      const appRef = await addDoc(
        collection(db, "users", state.user.uid, "applications"),
        {
          ...sanitize({
            job: initial.job,
            resume: initial.resume,
            analysis: null,
            followUpAnswers: {},
            outputs: initial.outputs,
            experienceBank: initial.experienceBank,
            versionHistory: [],
            currentStep: "job"
          }),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      );
      setState((current) => ({
        ...current,
        ...initial,
        user: current.user,
        suggestions: []
      }));
      setCurrentApplicationId(appRef.id);
    } catch (err) {
      console.error("[App] create application error:", err);
    }
  };

  const deleteApplication = async (appId) => {
    if (!state.user?.uid) return;
    try {
      await deleteDoc(doc(db, "users", state.user.uid, "applications", appId));
    } catch (err) {
      console.error("[App] delete application error:", err);
    }
  };

  const exitToDashboard = () => {
    setCurrentApplicationId(null);
    setState((current) => ({ ...createInitialState(), user: current.user }));
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleDeleteAccount = async () => {
    if (!window.confirm("Delete your account and all applications? This cannot be undone.")) return;
    const uid = state.user.uid;
    try {
      const appsSnap = await getDocs(collection(db, "users", uid, "applications"));
      await Promise.all(appsSnap.docs.map((d) => deleteDoc(d.ref)));
      await deleteDoc(doc(db, "users", uid));
      await auth.currentUser.delete();
    } catch (err) {
      console.error("[App] delete account error:", err);
      if (err.code === "auth/requires-recent-login") {
        alert("For security, please sign out and sign back in before deleting your account.");
      } else {
        alert("Failed to delete account. Please try again.");
      }
    }
  };

  // --- Export functions ---

  const exportToPDF = (content, filename) => {
    if (!content.trim()) return;
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const margin = 16;
    const maxWidth = pdf.internal.pageSize.getWidth() - margin * 2;
    const pageHeight = pdf.internal.pageSize.getHeight();
    const lineHeight = 5.5;
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    const lines = pdf.splitTextToSize(content, maxWidth);
    let y = margin;
    lines.forEach((line) => {
      if (y + lineHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += lineHeight;
    });
    pdf.save(filename);
  };

  const [exportingDoc, setExportingDoc] = useState(null);

  const exportToGoogleDoc = async (content, title) => {
    if (!content.trim()) return;
    const token = googleTokenRef.current;
    if (!token) {
      alert("Google Docs export requires signing out and back in once to grant Drive access.");
      return;
    }
    setExportingDoc(title);
    try {
      const boundary = `rr_${Date.now()}`;
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" }) +
        `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n` +
        content +
        `\r\n--${boundary}--`;
      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary="${boundary}"`
          },
          body
        }
      );
      if (res.status === 401) {
        googleTokenRef.current = null;
        alert("Drive access expired. Please sign out and back in, then try again.");
        return;
      }
      if (!res.ok) throw new Error(`Drive API ${res.status}`);
      const file = await res.json();
      window.open(`https://docs.google.com/document/d/${file.id}/edit`, "_blank");
    } catch (err) {
      console.error("[App] Google Doc export error:", err);
      alert("Failed to create Google Doc. Please try again.");
    } finally {
      setExportingDoc(null);
    }
  };

  const handleJobPdfUpload = async (event) => {
    const [file] = event.target.files || [];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) =>
          pdf.getPage(i + 1).then((page) => page.getTextContent())
        )
      );
      const text = pages
        .flatMap((content) => content.items.map((item) => item.str))
        .join(" ")
        .replace(/ {2,}/g, "\n");
      updateState((current) => ({
        ...current,
        job: {
          ...current.job,
          description: text,
          parsedRequirements: extractPhrases(text)
        }
      }));
      event.target.value = "";
    } catch (err) {
      console.warn("[App] job PDF upload failed:", err.message);
    }
  };

  // --- Render ---

  if (authLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      </div>
    );
  }

  if (!state.user) {
    return (
      <AuthScreen
        darkMode={darkMode}
        onToggleDark={toggleDark}
        onToken={(t) => { googleTokenRef.current = t; }}
      />
    );
  }

  if (!currentApplicationId) {
    return (
      <Dashboard
        user={state.user}
        applications={applications}
        onCreate={createApplication}
        onOpen={openApplication}
        onDelete={deleteApplication}
        onSignOut={handleSignOut}
        onDeleteAccount={handleDeleteAccount}
        darkMode={darkMode}
        onToggleDark={toggleDark}
        showAccount={showAccount}
        onToggleAccount={() => setShowAccount((s) => !s)}
      />
    );
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
        onBack={exitToDashboard}
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
            <button className="ghost hero-clear" type="button" onClick={handleClear}>
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
            <div className="panel-actions">
              <div className="intake-tabs">
                {[["url", "URL"], ["paste", "Paste"], ["browse", "Browse Jobs"]].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`tab${intakeMode === mode ? " active" : ""}`}
                    onClick={() => setIntakeMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="pdf-upload-btn ghost">
                Import PDF
                <input type="file" accept=".pdf" onChange={handleJobPdfUpload} style={{ display: "none" }} />
              </label>
            </div>
          </div>
          {intakeMode === "browse" ? (
            <JobFinderChat onImport={handleImportFromChat} />
          ) : (
            <form className="stack" onSubmit={handleJobSubmit}>
              {intakeMode === "url" && (
                <div className="url-row">
                  <label style={{ flex: 1 }}>
                    Job URL
                    <input
                      name="url"
                      placeholder="https://company.com/jobs/role"
                      value={state.job.url}
                      onChange={(event) =>
                        updateState((current) => ({
                          ...current,
                          job: { ...current.job, url: event.target.value }
                        }))
                      }
                    />
                  </label>
                  <button
                    className="ghost url-extract-btn"
                    type="button"
                    onClick={fetchJobFromUrl}
                    disabled={!state.job.url.trim() || isScraping}
                  >
                    {isScraping ? "…" : "Extract"}
                  </button>
                </div>
              )}
              {intakeMode === "url" && (state.job.location || state.job.salary) && (
                <div className="job-meta-row">
                  {state.job.location && <span className="pill">📍 {state.job.location}</span>}
                  {state.job.salary && <span className="pill">💰 {state.job.salary}</span>}
                </div>
              )}
              {intakeMode === "paste" && (
                <input type="hidden" name="url" value="" />
              )}
              <label>
                Job description
                <textarea
                  name="description"
                  rows={intakeMode === "paste" ? "14" : "12"}
                  placeholder="Paste the job post text here"
                  value={state.job.description}
                  onChange={(event) =>
                    updateState((current) => ({
                      ...current,
                      job: { ...current.job, description: event.target.value }
                    }))
                  }
                />
              </label>
              <button className="primary" type="submit">
                Parse job and continue
              </button>
            </form>
          )}
          {intakeMode !== "browse" && (
            <div className="pill-row">
              {state.job.parsedRequirements.map((item) => (
                <span className="pill" key={item}>
                  {item}
                </span>
              ))}
            </div>
          )}
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
                      resume: { ...current.resume, rawText: event.target.value }
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
            <div
              className="empty-state"
              style={{
                marginBottom: "0.75rem",
                borderStyle: "solid",
                borderColor: "var(--accent)",
                color: "var(--accent-strong)"
              }}
            >
              Analyzing with AI — semantic match in progress...
            </div>
          )}
          {!state.analysis ? (
            <div className="empty-state">
              Complete the job and resume steps to generate an analysis.
            </div>
          ) : (
            <>
              <div className="metric-grid">
                <div className="score-card accent">
                  <span>Match score</span>
                  <strong>{state.analysis.score}%</strong>
                  <p>{state.analysis.fitRating}</p>
                </div>
                <div className="score-card">
                  <span>Requirements met</span>
                  <strong>
                    {state.analysis.requirements?.filter((r) => r.met).length ?? "—"} of{" "}
                    {state.analysis.requirements?.length ?? "—"}
                  </strong>
                </div>
                <div className="score-card">
                  <span>Evidence gaps</span>
                  <strong>{state.analysis.gaps?.length ?? "—"}</strong>
                </div>
              </div>
              {state.analysis.overview && (
                <div className="subtle-card">
                  <p>{state.analysis.overview}</p>
                </div>
              )}
              {state.analysis.requirements?.length > 0 && (
                <div className="subtle-card">
                  <h3>Role requirements</h3>
                  <ul className="requirement-list">
                    {state.analysis.requirements.map((req, i) => (
                      <li
                        key={i}
                        className={`requirement-item ${req.met ? "requirement-met" : "requirement-unmet"}`}
                      >
                        <span className="requirement-badge">{req.label || req.category}</span>
                        <span className="requirement-text">
                          {req.text}
                          {req.evidence && (
                            <em className="requirement-evidence"> — {req.evidence}</em>
                          )}
                        </span>
                        <span className="requirement-status">{req.met ? "✓ met" : "✗ gap"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="comparison-grid">
                <div className="subtle-card">
                  <h3>Strengths</h3>
                  <ListOrFallback
                    items={state.analysis.strengths}
                    fallback="No strengths surfaced yet."
                  />
                </div>
                <div className="subtle-card">
                  <h3>Evidence gaps</h3>
                  <ListOrFallback
                    items={state.analysis.gaps.map(
                      (gap) => gap.detail || `${gap.keyword}: ${gap.prompt}`
                    )}
                    fallback="No major gaps detected."
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
            <div className="empty-state">
              No follow-up questions yet. Generate an analysis first.
            </div>
          ) : (
            <div className="followup-list">
              {state.analysis.gaps.map((gap) => (
                <article className="subtle-card" key={gap.keyword}>
                  <div className="followup-head">
                    <div>
                      <p className="eyebrow">{gap.type.replace("-", " ")}</p>
                      <h3>{gap.keyword}</h3>
                    </div>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => approveExperience(gap.keyword)}
                    >
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
                <div>
                  <h3>Tailored resume</h3>
                  <p className="muted">AI rewrites for relevance, but leaves final approval to you.</p>
                </div>
                <div className="export-btns">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      exportToPDF(
                        state.outputs.tailoredResume,
                        `${state.job.title || "resume"}-tailored.pdf`
                      )
                    }
                    disabled={!state.outputs.tailoredResume}
                  >
                    PDF
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      exportToGoogleDoc(
                        state.outputs.tailoredResume,
                        `${state.job.title || "Resume"} — Tailored Resume`
                      )
                    }
                    disabled={!state.outputs.tailoredResume || exportingDoc !== null}
                  >
                    {exportingDoc === `${state.job.title || "Resume"} — Tailored Resume`
                      ? "Creating…"
                      : "Google Doc"}
                  </button>
                </div>
              </div>
              <textarea
                rows="18"
                value={state.outputs.tailoredResume}
                onChange={(event) => updateOutput("tailoredResume", event.target.value)}
              />
            </div>
            <div className="editor-card">
              <div className="editor-head">
                <div>
                  <h3>Cover letter</h3>
                  <p className="muted">Grounded in verified evidence and job-specific language.</p>
                </div>
                <div className="export-btns">
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      exportToPDF(
                        state.outputs.coverLetter,
                        `${state.job.title || "cover-letter"}-cover-letter.pdf`
                      )
                    }
                    disabled={!state.outputs.coverLetter}
                  >
                    PDF
                  </button>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() =>
                      exportToGoogleDoc(
                        state.outputs.coverLetter,
                        `${state.job.title || "Cover Letter"} — Cover Letter`
                      )
                    }
                    disabled={!state.outputs.coverLetter || exportingDoc !== null}
                  >
                    {exportingDoc === `${state.job.title || "Cover Letter"} — Cover Letter`
                      ? "Creating…"
                      : "Google Doc"}
                  </button>
                </div>
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
              <div className="empty-state">
                Saved resume and cover letter versions will appear here.
              </div>
            )}
          </div>
        </PanelSection>
      </main>
    </div>
  );
}
