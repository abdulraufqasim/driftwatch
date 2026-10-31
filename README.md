# Driftwatch

Driftwatch finds architecture drift in public repositories. It maps source files and local imports, evaluates dependencies against architecture rules, and compares health scores across commit history.

## Run locally

Requirements: Node.js 20 or newer and Git.

```powershell
npm install
npm start
```

Open `http://localhost:3000`. Copy `.env.example` to `.env` and set `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` to valid random values before starting the server. `GITHUB_TOKEN` is optional and only raises GitHub API rate limits. Keep `.env` private.

## API

- `GET /api/health` — service health.
- `POST /api/scan` — analyze a public GitHub repository: `{"url":"https://github.com/owner/repository"}`.
- `POST /api/history` — scan health across sampled commits: `{"url":"https://github.com/owner/repository","limit":10}`.
- `POST /api/chat` — ask Dr. Drift about a current scan; configure `AI_PROVIDER` and `AI_API_KEY` to enable it.
- Demo mode is available on either scan endpoint with `{"demo":true}` and requires no GitHub token.

## Default architecture rules

| Rule | Severity | Constraint |
| --- | --- | --- |
| RULE-001 | Critical | Frontend must not import database files. |
| RULE-002 | Critical | Frontend must not import backend files directly. |
| RULE-003 | Critical | Database must not import frontend or backend files. |
| RULE-004 | Warning | Services must not import frontend files. |

The health score starts at 100, subtracts 10 per critical violation and 3 per warning, and never drops below 0. Repository-level `driftwatch.yml` or `driftwatch.json` files can customize the rules.

## Deployment

Deploy the frontend on Vercel and the Node API on Render. See [DEPLOY.md](./DEPLOY.md) for setup steps and environment variable names.

## Privacy and security

Driftwatch reads only public repositories. It downloads repository code to a temporary directory for scanning and deletes that directory after each scan. It stores no source code. The optional `GITHUB_TOKEN` is read from an environment variable and is not included in scan results. When a user connects a GitHub account, its OAuth access token is encrypted and stored in that user's server-side SQLite session. When Dr. Drift is used, the question and a reduced summary of the current scan are sent to the configured AI provider; chat messages remain in browser memory only.

## Roadmap

- Python and Java import analysis
- Private repository support
- A GitHub Action that comments on pull requests
- Slack and email alerts

## Known issues

`npm audit` currently reports dependency advisories; they are scheduled to be addressed after the demo.
