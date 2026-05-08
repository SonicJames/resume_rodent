# Resume Rodent MCP Tools

Two MCP tools for Claude to help users find jobs and apply using the Resume Rodent workflow. Runs as a persistent HTTP server on Railway.

## Tools

### find_me_a_job
Search for job opportunities by querying the SonicJobs API. Returns a list of matching roles with action links per job:
- **View Job** — direct link to the job posting
- **Help Me Apply** — opens Resume Rodent with the role pre-loaded

**Ask Claude:**
```
Find me a product manager job
```

### help_me_apply
Generates a direct link to the Resume Rodent app with job details pre-populated, ready for the candidate to upload their resume and start the refinement workflow.

**Ask Claude:**
```
Help me apply to the Northstar AI job
```

## Deploying to Railway

1. Create a new Railway project and connect this repo (or the `mcp-tools` subdirectory).
2. Set environment variables in Railway:
   ```
   RESUME_RODENT_APP_URL=https://your-resume-rodent-app.vercel.app
   SONIC_JOBS_MCP_URL=https://your-sonicjobs-server.railway.app
   ```
3. Railway auto-sets `PORT` — no action needed.
4. Deploy. The server exposes `POST /mcp` for MCP traffic and `GET /health` for uptime checks.

## Connecting Claude

Once deployed, each salesperson adds one entry to their `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "resume-rodent": {
      "type": "http",
      "url": "https://your-mcp-server.railway.app/mcp"
    }
  }
}
```

That's it — no local processes to run before a demo.

## Local Development

```bash
cd mcp-tools
npm install
cp .env.example .env   # fill in your URLs
npm start
```

The server starts on `http://localhost:3001/mcp`.

To use locally with Claude Code, point the MCP config at `http://localhost:3001/mcp`.
