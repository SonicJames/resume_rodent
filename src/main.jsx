import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const bootLog = (event, payload) => {
  console.log(`[AI Copilot Boot] ${event}`, payload ?? "");
};

window.addEventListener("error", (event) => {
  console.error("[AI Copilot Boot] window.error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  });
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[AI Copilot Boot] unhandledrejection", event.reason);
});

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || "Unknown React render error"
    };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[AI Copilot Boot] error-boundary", {
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="boot-error-screen">
          <section className="boot-error-card">
            <p className="eyebrow">Application Error</p>
            <h1>We hit a render problem while starting the app.</h1>
            <p className="lede">
              Check the browser console for the detailed debug logs. The latest error was:
            </p>
            <pre>{this.state.errorMessage}</pre>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
bootLog("root-element", { found: Boolean(rootElement) });

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

bootLog("render:start");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);

bootLog("render:complete");
