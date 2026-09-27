# Driftwatch

An architecture guardian, not a code assistant.

## What it does
Driftwatch is an AI-powered tool that watches a codebase's structure over 
time. Instead of writing or reviewing code line-by-line, it uses IBM Bob 
2.0's full-repository context to detect when a project's real architecture 
drifts away from its intended design — catching structural violations, 
visualizing the "blast radius" of changes, and keeping architecture 
diagrams always up to date.

## GitHub connection
The current onboarding flow supports **public repositories only**. It uses a GitHub OAuth App with the `read:user` and `public_repo` scopes to identify the account and list public repositories. GitHub's classic `public_repo` scope also permits write access to public repositories; private repositories are not listed or accepted. Use a GitHub App with read-only repository permissions before enabling private-repository access.

### Configure locally
1. Create a GitHub OAuth App in **GitHub → Settings → Developer settings → OAuth Apps**.
2. Set its Homepage URL to `http://localhost:3000` and Authorization callback URL to `http://localhost:3000/auth/github/callback`.
3. Copy `.env.example` to `.env`, then set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
4. Generate unique server secrets:

   ```powershell
   node -e "console.log('SESSION_SECRET=' + require('node:crypto').randomBytes(48).toString('base64url'))"
   node -e "console.log('TOKEN_ENCRYPTION_KEY=' + require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Put each generated value in `.env`. Keep `.env` and the OAuth client secret private.
5. Run `npm install`, then `npm run dev`, and open `http://localhost:3000`.

The OAuth callback uses a per-session, one-time `state` value. Session cookies are HTTP-only and SameSite=Lax. Sessions are persisted in SQLite; OAuth access tokens are AES-256-GCM encrypted before they are written into the session store. Set `APP_BASE_URL` to the deployed HTTPS origin, register `${APP_BASE_URL}/auth/github/callback` as the OAuth callback URL, and set `TRUST_PROXY=1` when TLS terminates at a trusted reverse proxy. Keep the SQLite file on persistent storage and run one server instance per database file.

Disconnecting removes the local session and asks GitHub to revoke the OAuth grant. If GitHub is unavailable, Driftwatch reports that the grant may need to be revoked manually in GitHub settings.

Repository selection and connection are implemented; repository cloning, scanning, and architecture detection are not part of this phase.

## Team
- Abdul Rauf
- Hadiqa Ghanchi

## IBM Bob 2.0 Hackathon
Built for the IBM Bob 2.0 Hackathon, September 2026.
