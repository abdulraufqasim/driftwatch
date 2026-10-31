# Deployment

## Render API

1. In Render, create a **Web Service** from this GitHub repository.
2. Set the build command to `npm install`.
3. Set the start command to `npm start`.
4. Add these environment variable names in the Render service settings:
   - `SESSION_SECRET`
   - `TOKEN_ENCRYPTION_KEY`
   - `GITHUB_TOKEN`
   - `APP_BASE_URL`
   - `ALLOWED_ORIGINS`
   - `SESSION_DB_PATH`
   - `AI_PROVIDER`
   - `AI_API_KEY`
   - `AI_MODEL`
   - `AI_DAILY_LIMIT`
5. Deploy the service and copy its public service URL for the frontend configuration.

Dr. Drift requires an AI provider name (`anthropic`, `openai`, or `gemini`) and its API key. `AI_MODEL` and `AI_DAILY_LIMIT` are optional; the daily cap defaults to 500 requests.

## Vercel frontend

1. Open the existing project in Vercel and deploy the repository as the frontend.
2. In the project source, edit `config.js` and set `window.DRIFTWATCH_API_BASE` to the Render service's origin (the URL without a path).
3. Commit that frontend configuration change in your usual workflow, then trigger a new deployment from the existing Vercel project.

An empty API base in `config.js` keeps local development on relative `/api` URLs.
