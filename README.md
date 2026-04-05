# PitchMirror

PitchMirror is an AI rehearsal room for high-stakes speaking scenarios. It helps users practice interviews, presentations, pitches, and live coding rounds with a realistic conversational agent, a live avatar, contextual grounding from uploaded documents, and post-session feedback.

## Hackathon Tooling

This project uses hackathon-required tools in meaningful product-facing ways:

- **TinyFish** was used to fetch targeted web resources for a user’s improvement areas after evaluation, including videos, articles, and websites tied to their weaknesses.
- **Claude Code** was used during development for UI and UX iteration, agent system prompt design, project planning, and implementation support across the product workflow.

## Problem Statement

People rarely fail important presentations, interviews, or demos because they completely lack knowledge. More often, they struggle with:

- speaking clearly under pressure
- organizing answers in real time
- staying confident when challenged
- practicing with realistic follow-up questions
- understanding how to improve between attempts

Generic voice assistants can talk back, but they do not behave like a scenario-specific interviewer, professor, investor, or recruiter. They also do not provide grounded evaluation, tailored improvement resources, or progress comparison across sessions.

PitchMirror solves this by creating a rehearsal environment that feels more like the real room:

- live avatar-based interaction
- role-specific questioning
- optional document grounding
- session evaluation
- improvement resources
- comparison with past sessions

## What PitchMirror Does

PitchMirror lets a user choose a practice agent, optionally upload supporting material, start a live session, and review detailed feedback afterward.

Core flow:

1. Choose an agent
2. Add a session name
3. Optionally add role-specific context
4. Optionally upload a supporting PDF
5. Start a live session
6. Speak with the agent in real time
7. End the session and review the report
8. Fetch resources and compare progress with prior sessions

## Key Features

### 1. Scenario-Specific Practice Agents

PitchMirror supports multiple agent types, each with its own questioning style and evaluation rubric.

- **Recruiter Loop**
  Practice recruiter screens, behavioral answers, role-fit framing, and impact storytelling.

- **Professor Panel**
  Rehearse thesis defenses, capstone reviews, academic presentations, and deeper follow-up questions.

- **Investor Room**
  Practice startup or product pitches with questions around traction, differentiation, and conviction.

- **Coding Round**
  Simulate a live coding interview where the interviewer introduces the problem verbally and follows the candidate’s spoken reasoning and code.

- **Custom Agent**
  Flexible rehearsal mode for presentations, demos, oral exams, leadership updates, or custom scenarios.

### 2. Live Avatar + Real-Time Voice Interaction

The user interacts with a live avatar instead of a plain text bot. This makes practice feel more realistic and helps simulate the psychological pressure of speaking to a person, not just a chat interface.

### 3. Optional Supporting Documents

Users can upload PDFs such as:

- resumes
- pitch decks
- slide decks
- presentation notes
- project briefs

The uploaded content is parsed, cleaned, and used as grounded context for the session when relevant.

### 4. Optional Role Context

Each agent includes an optional text context field so the user can fine-tune the room with extra details such as:

- job descriptions
- audience expectations
- grading criteria
- investor concerns
- technical interview focus areas

### 5. Coding Interview Workspace

The Coding Round includes a code editor with:

- line numbers
- syntax highlighting by selected language
- live code context available to the interviewer
- think-aloud interview flow

The interviewer can respond to the candidate’s reasoning and code progress without turning into a coding assistant.

### 6. Evaluation Dashboard

After a session ends, PitchMirror generates a report with:

- overall score
- metric-by-metric breakdown
- strengths
- improvements
- next steps

Each agent uses its own rubric, so the evaluation is not generic across all scenarios.

### 7. Improvement Resources

Users can fetch targeted learning resources after evaluation. These are tied to their main improvement areas and are shown on the saved session page.

### 8. Session Comparison

Users can compare a completed session with another past session for the same agent to understand whether they improved and where they still need work.

### 9. Saved Session History

Each completed session is stored locally in the browser with:

- session name
- duration
- transcript
- uploaded file metadata
- evaluation result
- comparison result
- fetched resources

## Agents and Use Cases

### Recruiter Loop

Best for:

- internship interviews
- first-round recruiter screens
- behavioral practice
- role-fit storytelling

Optional context examples:

- job description
- target team
- company context
- recruiter priorities

### Professor Panel

Best for:

- thesis defense practice
- research demos
- academic presentations
- class project reviews

Optional context examples:

- thesis summary
- grading rubric
- research scope
- expected faculty concerns

### Investor Room

Best for:

- startup pitches
- fundraising practice
- product demos
- founder narrative rehearsal

Optional context examples:

- stage and traction
- investor concerns
- market assumptions
- fund thesis alignment

### Coding Round

Best for:

- technical interview rehearsal
- live problem solving
- think-aloud communication practice
- code explanation under pressure

Optional context examples:

- target company style
- preferred language
- interview expectations
- problem focus area

### Custom Agent

Best for:

- product demos
- leadership updates
- oral exams
- general presentations

## How To Use PitchMirror

### Starting a New Session

1. Open the landing page
2. Click **View agents**
3. Select the agent you want
4. Enter a **Session name**
5. Optionally add text context
6. Optionally upload a PDF
7. Click **Start session**

### During the Session

- The agent starts the conversation
- The user speaks naturally
- In Coding Round, the user also types into the code editor
- The live transcript updates during the session
- The session remains in the same tab

### After the Session

1. End the session
2. Wait for evaluation processing
3. Open the saved session page
4. Review evaluation metrics
5. Fetch improvement resources if desired
6. Compare with another past session

## Evaluation

Each agent has a different evaluation rubric. The app does not score all scenarios with the same metrics.

Examples:

- recruiter sessions focus on communication clarity, ownership, impact storytelling, and role alignment
- professor sessions focus on conceptual clarity, rigor, evidence, and composure
- investor sessions focus on market clarity, traction, differentiation, and conviction
- coding sessions focus on problem understanding, algorithmic reasoning, code clarity, and communication while coding

## Technical Overview

### Frontend

- Next.js
- React
- JavaScript
- CodeMirror for the coding editor

### Backend

- Node.js
- Express
- WebSocket server

### AI / Media Stack

- Gemini Live for conversation and response generation
- Simli for live avatar streaming
- AssemblyAI for user-side transcription
- TinyFish for improvement resource discovery

## Project Structure

```text
app/                  Next.js app routes
components/           UI components and live session experience
data/                 Agent definitions and prompts
lib/                  Shared helpers and client config
server.js             Express + WebSocket backend
render.yaml           Render deployment config
.env.example          Environment variable template
```

## Environment Variables

See [.env.example](/Users/mitulkrishna/Documents/Projects/Slimli/.env.example).

Expected variables:

- `GEMINI_API_KEY`
- `ASSEMBLYAI_API_KEY`
- `TINYFISH_API_KEY`
- `NEXT_PUBLIC_SIMLI_API_KEY`
- `NEXT_PUBLIC_SIMLI_FACE_IDS`
- `NEXT_PUBLIC_BACKEND_HTTP_URL`
- `NEXT_PUBLIC_BACKEND_WS_URL`

## Local Development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build locally:

```bash
npm run build
```

## Deployment Notes

PitchMirror currently uses a custom Node server and a WebSocket server, so the safest deployment model is:

- **Render** for the backend and live session server
- **Vercel** for the frontend, if desired

For a fast hackathon deployment, using **Render only** is also a valid option because the current server can host both the frontend and backend together.

## Privacy Note

Uploaded document context is handled per session and should not be stored globally across users. Saved session history is stored in the browser for that browser unless backed by a database in a future version.

## Current Scope

This version is a strong prototype focused on:

- realistic practice
- contextual questioning
- live interaction
- post-session feedback
- visible progress over time

Future improvements could include:

- stronger audio-based delivery analysis
- database-backed multi-user session storage
- authentication
- more robust deployment separation
- richer coding interview analysis

## Demo Narrative

PitchMirror is designed to show that rehearsal can be more than a chatbot conversation. It combines:

- scenario-specific agents
- grounded context
- live avatar interaction
- evaluation
- improvement resources
- comparison across attempts

The result is a rehearsal tool built to help users become more confident, more prepared, and more aware of how they improve over time.
