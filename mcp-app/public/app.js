const jobForm = document.getElementById("job-form");
const chatSection = document.getElementById("chat-section");
const chatForm = document.getElementById("chat-form");
const chatBox = document.getElementById("chat");
const exportBtn = document.getElementById("export-btn");
const statusLog = document.getElementById("status-log");
const loadSampleBtn = document.getElementById("load-sample");

const sampleJobUrl = "https://example.com/jobs/senior-product-marketing-manager";
const sampleJobDescription = `Title: Senior Product Marketing Manager
Company: Northstar AI

We are hiring a product marketing leader who can translate complex AI workflows into clear customer messaging. The role requires cross-functional collaboration with product, sales, and customer success teams, strong writing, launch planning, analytics, stakeholder management, and experience tailoring content for enterprise buyers. Familiarity with ATS optimization, interview prep, and application workflow tools is a plus.`;
const sampleResumeText = `Alex Morgan
Product marketing strategist with 6+ years of experience building go-to-market programs, launch messaging, and sales enablement materials for B2B SaaS teams.

Experience
- Led positioning and launch planning for a workflow automation product, partnering with product, design, and sales teams across three releases.
- Created customer-facing messaging, lifecycle content, and case studies that improved demo conversion by 18%.
- Built reporting dashboards that connected campaign performance to pipeline influence for leadership reviews.

Skills
Product marketing, messaging, analytics, stakeholder communication, content strategy, customer research`;

const state = {
  jobUrl: "",
  jobDescription: "",
  resumeText: "",
  conversation: []
};

// Load URL parameters on page load (for Claude MCP integration)
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const jobTitle = params.get("job_title");
  const jobUrl = params.get("job_url");
  const resumeText = params.get("resume_text");

  if (jobUrl) {
    jobForm.elements["jobUrl"].value = jobUrl;
  }
  if (jobTitle) {
    jobForm.elements["jobDescription"].value = `Job Title: ${jobTitle}`;
  }
  if (resumeText) {
    jobForm.elements["resumeText"].value = resumeText;
  }

  if (jobUrl) {
    setStatus("Job loaded from Claude. Add your resume and click Start analysis.");
  }
});

const setStatus = (message) => {
  statusLog.textContent = message;
};

const appendMessage = (role, text) => {
  const bubble = document.createElement("div");
  bubble.className = `message ${role}`;
  bubble.textContent = text;
  chatBox.appendChild(bubble);
  chatBox.scrollTop = chatBox.scrollHeight;
};

const showChat = () => {
  chatSection.classList.remove("hidden");
  document.getElementById("status-section").classList.remove("hidden");
};

const startAnalysis = async (event) => {
  event.preventDefault();
  const formData = new FormData(jobForm);
  const resumeFile = formData.get("resumeFile");
  const jobUrl = formData.get("jobUrl")?.trim();
  const jobDescription = formData.get("jobDescription")?.trim();
  const resumeText = formData.get("resumeText")?.trim();

  if ((!resumeFile || !resumeFile.name) && !resumeText) {
    setStatus("Please choose a resume file or paste resume text.");
    return;
  }

  setStatus("Starting analysis with Claude...");
  chatBox.innerHTML = "";

  try {
    const requestOptions = resumeFile && resumeFile.name
      ? { method: "POST", body: formData }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobUrl, jobDescription, resumeText })
        };

    const response = await fetch("/api/exchange", requestOptions);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Analysis failed.");
    }

    state.jobUrl = jobUrl;
    state.jobDescription = jobDescription;
    state.resumeText = data.resumeText;
    state.conversation = [
      {
        role: "user",
        content: `Please analyze this resume and job posting. Job URL: ${jobUrl || "(not provided)"}. Job description: ${jobDescription || "(not provided)"}.`
      },
      {
        role: "assistant",
        content: data.assistant
      }
    ];

    appendMessage("assistant", data.assistant);
    showChat();
    setStatus("Analysis complete. Answer the follow-up request or continue the chat.");
  } catch (error) {
    setStatus(error.message);
  }
};

    if (!response.ok) {
      throw new Error(data.error || "Analysis failed.");
    }

    state.jobUrl = jobUrl;
    state.jobDescription = jobDescription;
    state.resumeText = data.resumeText;
    state.conversation = [
      {
        role: "user",
        content: `Please analyze this resume and job posting. Job URL: ${jobUrl || "(not provided)"}. Job description: ${jobDescription || "(not provided)"}.`
      },
      {
        role: "assistant",
        content: data.assistant
      }
    ];

    appendMessage("assistant", data.assistant);
    showChat();
    setStatus("Analysis complete. Answer the follow-up request or continue the chat.");
  } catch (error) {
    setStatus(error.message);
  }
};

const sendChatMessage = async (event) => {
  event.preventDefault();
  const messageInput = chatForm.elements["message"];
  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = "";
  state.conversation.push({ role: "user", content: text });
  appendMessage("user", text);
  setStatus("Sending chat message to Claude...");

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobUrl: state.jobUrl,
        jobDescription: state.jobDescription,
        resumeText: state.resumeText,
        conversation: state.conversation
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Chat failed.");
    }

    state.conversation.push({ role: "assistant", content: data.assistant });
    appendMessage("assistant", data.assistant);
    setStatus("Claude has replied. Continue the chat or export the resume PDF.");
  } catch (error) {
    setStatus(error.message);
  }
};

const exportPdf = async () => {
  setStatus("Generating tailored resume PDF...");

  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobUrl: state.jobUrl,
        jobDescription: state.jobDescription,
        resumeText: state.resumeText,
        conversation: state.conversation
      })
    });

    if (!response.ok) {
      const json = await response.json();
      throw new Error(json.error || "Export failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "resume-rodent.pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setStatus("Resume PDF exported successfully.");
  } catch (error) {
    setStatus(error.message);
  }
};

jobForm.addEventListener("submit", startAnalysis);
chatForm.addEventListener("submit", sendChatMessage);
exportBtn.addEventListener("click", exportPdf);

loadSampleBtn.addEventListener("click", () => {
  jobForm.elements["jobUrl"].value = sampleJobUrl;
  jobForm.elements["jobDescription"].value = sampleJobDescription;
  jobForm.elements["resumeText"].value = sampleResumeText;
  jobForm.elements["resumeFile"].value = null;
  setStatus("Sample job and resume data loaded. Submit the form to begin.");
});
