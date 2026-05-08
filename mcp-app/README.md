# Resume Rodent Claude MCP App

A minimal Claude-powered prototype for Resume Rodent.
It accepts a job URL and resume file, starts a chat around missing evidence, and exports a polished resume PDF.

## Setup

1. Open a terminal in `mcp-app`.
2. Install dependencies:

```bash
npm install
```

3. Create `.env` or export your key in the shell:

```bash
cp .env.example .env
# then edit .env with your key
```

or

```bash
export CLAUDE_API_KEY="your_claude_api_key"
```

4. Start the server:

```bash
npm start
```

5. Confirm the app is listening:

```bash
curl -I http://localhost:4000
```

6. Open `http://localhost:4000` and use the "Load sample job + resume" button to try the app immediately.

6. Open `http://localhost:4000` in your browser.

## Notes

- Supported resume file formats: `.txt`, `.md`, `.docx`, `.pdf`
- Default Claude model: `claude-3.5-mini`
- Override with `CLAUDE_MODEL` if needed.
