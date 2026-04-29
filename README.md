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

## Architecture notes

- `index.html`: Vite HTML entry
- `src/main.jsx`: React bootstrap
- `src/App.jsx`: main product UI and workflow
- `src/analysis.js`: lightweight parsing and ATS-style scoring logic
- `src/generators.js`: document and guidance generation
- `src/state.js`: local state and persistence
- `src/export.js`: export/download helpers
- `src/styles.css`: responsive UI system

## MVP assumptions

- Authentication is mocked on the client.
- Resume upload currently supports text-based files only.
- AI output is deterministic, local, and rules-based for the MVP.
- The code is structured so backend auth, parsers, and model-powered generation can be swapped in later.
