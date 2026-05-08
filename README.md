# AI Job Application Copilot

A responsive React + Vite MVP for tailoring resumes to specific roles and generating a complete application pack.

🚀 **Live Demo**: [https://resumerodent.vercel.app](https://resumerodent.vercel.app)

## What is included

- Mock sign-in and guided dashboard
- Job URL/description intake
- Resume paste/upload for text-based files
- ATS-style match analysis with strengths, gaps, missing keywords, and fit rating
- Targeted follow-up questions for missing evidence
- Reusable experience bank
- Editable tailored resume, cover letter, application answers, and interview prep
- Exportable application pack
- Version history snapshots

## Local development

```bash
npm install
npm run dev
```

Then open the Vite URL, usually `http://localhost:5173`.

## Deploy on Vercel

This app is deployment-ready on Vercel as a standard Vite frontend.

1. Import the repo into Vercel.
2. Use the project root as the working directory.
3. Select the `Vite` framework preset if Vercel detects it, or leave build settings at their defaults.
4. Deploy with:
   Build command: `npm run build`
   Output directory: `dist`

Vercel will build the app into `dist/` automatically.

## Resume Rodent System Overview

Resume Rodent is a comprehensive job application and resume refinement system with three integrated components:

### 1. Claude MCP Tools (`mcp-tools/`)

Two MCP tools that integrate Resume Rodent into Claude:

- **find_me_a_job** — Search for opportunities via SonicJobs MCP server
- **help_me_apply** — Launch Resume Rodent for a selected job

**In Claude, ask:**
```
Find me a product manager job
```

Claude will display results with action buttons. Click "Help Me Apply" to refine your resume for that role.

### 2. Resume Rodent Web App (`mcp-app/`)

Interactive web interface where you:
1. Upload your resume
2. Provide job details (URL or description)
3. Answer targeted questions about the role
4. Get a tailored PDF ready to submit

Accessible at `http://localhost:4000`

## Quick Start

### Run Everything

**Terminal 1: MCP Tools**
```bash
cd mcp-tools
npm install
export CLAUDE_API_KEY="your_api_key"
npm start
```

**Terminal 2: Resume Rodent Web App**
```bash
cd mcp-app
npm install
export CLAUDE_API_KEY="your_api_key"
npm start
```

**Terminal 3: Configure Claude**
Add to `~/.claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "resume-rodent": {
      "command": "node",
      "args": ["/path/to/resume_rodent/mcp-tools/mcp-server.js"]
    }
  }
}
```

Then ask Claude: **"Find me a product manager job"**

## Deployment

### MCP Connector (Auto-Deploy via Railway)

Deploy to Railway for Claude integration with automatic redeploy on git push:

```bash
1. Set root directory to: mcp-tools
2. Add environment variables:
   - CLAUDE_API_KEY=sk-...
   - NODE_ENV=production
3. Git push triggers auto-deploy
```

See [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md) for detailed instructions.

### Web App (Manual via Vercel)

Deploy Resume Rodent web interface separately to Vercel:

```bash
cd mcp-app && vercel --prod
```

## Architecture

### React Frontend (`src/`)
The original web app with:
- `App.jsx`: main product UI and workflow
- `analysis.js`: parsing and ATS-style scoring logic
- `generators.js`: document and guidance generation
- `state.js`: local state and persistence
- `export.js`: PDF export helpers

### MCP Backend (`mcp-tools/`)
Claude integration layer:
- `mcp-server.js`: MCP protocol server that Claude connects to
- Queries SonicJobs MCP for real job data
- Returns structured results with links to Resume Rodent

### Web Service (`mcp-app/`)
Standalone server for Resume Rodent workflow:
- Express server with Claude integration
- Static file serving for the UI
- API endpoints for analysis, chat, and PDF export

## Design Notes

- **No AI fabrication** — Resume Rodent asks targeted questions and only uses real candidate evidence
- **ATS-friendly output** — Generated resumes use keywords from the actual job posting
- **Claude-first UX** — Primary interface is within Claude; web app handles heavy lifting
- **Modular design** — Each component can be used independently or together
