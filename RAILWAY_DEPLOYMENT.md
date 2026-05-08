# Railway Deployment Guide - MCP Tools Only

This deploys **only the MCP connector** (mcp-tools) to Railway with auto-deploy on git push.
The web app (mcp-app) remains separate.

## Quick Deploy

1. **Push to GitHub**
   ```bash
   git add .
   git commit -m "Update Resume Rodent MCP tools"
   git push origin main
   ```

2. **Create Railway Project for MCP Tools**
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub"
   - Select your `resume_rodent` repo
   - Railway auto-detects Node.js in `/mcp-tools`

3. **Configure Root Directory**
   - In Railway: Settings → "Root Directory"
   - Set to: `mcp-tools`
   - This tells Railway to only deploy the MCP tools

4. **Add Environment Variables**
   - In Railway dashboard: Variables tab
   - `CLAUDE_API_KEY=sk-...`
   - `NODE_ENV=production`
   - `SONIC_JOBS_MCP_URL=https://your-sonicjobs-mcp.example.com` (optional)

5. **Auto-Deploy Enabled**
   - Railway watches for git push to main
   - Any changes to `/mcp-tools` trigger automatic redeploy
   - Logs visible in Railway dashboard

## Get Your HTTPS URL

1. Deployment completes
2. Copy the public URL from Railway dashboard
3. Format: `https://resume-rodent-production.up.railway.app`

## Update Claude Config

Edit `~/.claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "resume-rodent": {
      "url": "https://your-railway-url.up.railway.app",
      "credentials": {
        "apiKey": "your_claude_api_key"
      }
    }
  }
}
```

Restart Claude, then ask:
```
Find me a product manager job
```

## Web App (mcp-app)

Deploy separately to Vercel:
```bash
cd mcp-app
vercel --prod
```

Update the Resume Rodent web URL in mcp-tools `.env` if needed.

