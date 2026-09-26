# Driftwatch

An architecture guardian, not a code assistant.

## What it does
Driftwatch is an AI-powered tool that watches a codebase's structure over 
time. Instead of writing or reviewing code line-by-line, it uses IBM Bob 
2.0's full-repository context to detect when a project's real architecture 
drifts away from its intended design — catching structural violations, 
visualizing the "blast radius" of changes, and keeping architecture 
diagrams always up to date.

## Live Demo
[your-vercel-url-here]

## Tech Stack
- **Language Model:** IBM Bob 2.0
- **Frontend:** React, Tailwind CSS, React Flow, Recharts, Framer Motion
- **Backend:** Node.js, Express
- **Repo Analysis:** GitHub API (Octokit) + Bob 2.0
- **Hosting:** Vercel (frontend), Render (backend)

## Setup
\`\`\`bash
# Clone the repo
git clone https://github.com/your-username/driftwatch.git
cd driftwatch

# Install dependencies
npm install

# Copy env template and fill in your keys
cp .env.example .env

# Run locally
npm run dev
\`\`\`

## Team
- Abdul Rauf
- Hadiqa Ghanchi

## IBM Bob 2.0 Hackathon
Built for the IBM Bob 2.0 Hackathon, September 2026.
