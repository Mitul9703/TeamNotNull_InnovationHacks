# PitchMirror

PitchMirror is a multi-agent simulation environment for interviews, pitches, presentations, and coding rounds. It is built for situations where delivery matters as much as knowledge: speaking with confidence, staying concise, thinking under pressure, defending decisions, and explaining thought process in real time.

The app combines role-specific agents, live avatar sessions, uploaded context, screen sharing, coding interview flows, saved history, progress tracking, and post-session evaluation in one system. 

## Description

PitchMirror is designed around one idea: people often underperform not because they lack knowledge, but because they have not trained for the environment.

That problem shows up in different ways:
- a founder struggles to defend a product demo under investor pressure
- a student loses clarity during a professor-style Q&A
- a candidate solves a coding problem but cannot explain the reasoning out loud
- a user improves across sessions, but has no structured way to measure progress

PitchMirror addresses that by simulating the room itself.

The app supports multiple role-specific agents:
- recruiter
- professor
- investor
- coding interviewer
- custom agent

Each agent has its own prompt, behavior, evaluation criteria, and use of context. A session can also include uploaded documents, optional user context, optional company URLs for external research, live screen sharing for non-coding agents, and thread-based memory across repeated sessions.

## User Flow

### 1. Landing page

The landing page gives the user a high-level entry into the product. It shows the available agents as separate cards and introduces the simulation styles the app supports.

From here, a user can:
- browse the available agents
- pick a role-specific simulation track
- switch between light and dark mode

The purpose of this screen is to communicate that PitchMirror is not a single assistant with different prompts. It is a set of distinct simulation experiences.

### 2. Agent page

Clicking an agent opens its dedicated page.

This screen shows:
- the scenario description for the agent
- the evaluation criteria for that agent
- the list of previously created threads for that agent
- a required field to create a new thread

From here, a user can:
- understand what the agent is meant to simulate
- see how they will be evaluated
- open an existing thread
- delete an existing thread
- create a new thread

This page acts as the top-level workspace for one simulation type. For example, the investor page is focused on pitch and demo pressure, while the coding page is focused on think-aloud problem solving.

### 3. Thread page

Once a thread is created, the user enters the thread page. This is the main planning and review screen for repeated practice.

This screen contains:
- a required session-name field
- optional context for the next session
- optional company URL for supported agents
- optional PDF upload
- the thread-level evaluation area
- the hidden thread-memory viewer
- the list of past sessions in that thread

From here, a user can:
- start a new session inside the thread
- upload a supporting document
- provide context to shape the scenario
- provide a company URL for pre-session research
- inspect past sessions in that thread
- inspect thread-level progress once sessions exist
- delete the thread
- delete individual sessions inside the thread

The thread model is important. Sessions do not live in isolation. A thread stores the user’s session history for one ongoing goal, and later sessions can be shaped by hidden memory from earlier ones. That memory is used internally to steer questioning, not exposed directly during the live conversation.

### 4. Pre-session preparation

Before some sessions start, the app can do background preparation.

Supported flows:
- **coding**: research a company-relevant coding question
- **investor**: gather public company or product context
- **custom**: gather public context based on the provided URL and scenario
- **professor**: does not use this external research flow

This preparation happens after the user clicks Start Session. The UI shows a loading state while the background job runs.

This step exists so the live agent can begin the conversation with stronger context instead of asking generic questions.

### 5. Live session page

The live session page is the core simulation screen.

This screen includes:
- a live avatar stage
- real-time transcript
- elapsed session time
- mute control
- end-call control
- optional screen-sharing UI for non-coding agents
- optional coding editor for coding sessions
- overlays for mic permission, errors, and session transitions
- a floating Picture-in-Picture control surface during screen sharing

From here, a user can:
- speak with the live agent
- allow mic access
- share a screen, tab, or window in non-coding sessions
- work through a coding round in the coding flow
- mute audio
- end the session

#### Non-coding live flow

For recruiter, professor, investor, and custom agents, the session is driven by live speech and transcript. If screen sharing is used, the app captures the visible screen and forwards sampled frames into the live reasoning pipeline.

This is especially important in investor sessions, where the agent can challenge what is visibly shown during a product demo instead of only responding to the spoken pitch.

#### Coding live flow

For coding sessions, the app supports a live coding interview format. The coding interviewer can use pre-session research to introduce a company-relevant question. The user is expected to think aloud while writing code, and the agent can challenge logic, tradeoffs, and reasoning during the round.

The coding flow is built around the interview dynamic, not around code execution. The point is to evaluate communication and problem solving under pressure.

### 6. Session end and evaluation

When the user ends a session, the app returns them to the saved history flow and starts evaluation in the background.

A completed session stores:
- transcript
- timing metadata
- optional uploaded document context
- optional external research context
- coding metadata when relevant
- evaluation status
- resources status
- comparison status

Session evaluation is agent-specific. A coding interview is not scored the same way as an investor pitch. The evaluation focuses on the dimensions defined for that agent.

### 7. Session detail page

Each saved session has its own report page.

This screen shows:
- session metadata
- thread link
- uploaded-file information
- external research or coding question context
- the full session evaluation
- improvement resources
- transcript history
- session comparison tools

From here, a user can:
- review one session in detail
- inspect the coding or external research context used in that session
- compare it to another session
- view targeted improvement resources
- delete the session

This is the most detailed reporting screen in the product. It is where the single-session simulation loop turns into actionable feedback.

### 8. Thread-level reporting

Threads also have their own evaluation layer.

Thread evaluation aggregates multiple sessions and shows:
- summary
- trajectory
- next-session focus
- metric trends
- recurring strengths
- recurring focus areas
- thread comments
- hidden internal memory used to steer future sessions

From here, a user can:
- track progress across attempts
- understand what is improving and what is recurring
- see what future sessions will emphasize
- inspect the hidden steering memory

This turns repeated practice into a more structured growth loop instead of a collection of disconnected runs.

## What Makes It Different

PitchMirror is not just a wrapper over a voice model.

It combines role-specific simulation, live multimodal context, and post-session progress tracking in one system.

The biggest differentiators in this release are:

- **Role-specific agents**  
  Recruiter, professor, investor, coding, and custom agents all have different prompts, evaluation criteria, and behaviors. They are not the same assistant wearing different labels.

- **Live screen-aware simulation**  
  Non-coding sessions support live screen sharing through. The visible screen becomes part of the simulation context, especially in investor demos.

- **Live coding interview flow**  
  The coding agent can run a company-aware technical round and challenge the user’s reasoning while they code and think aloud.

- **Thread-based memory**  
  Sessions are grouped into threads, and later sessions can be shaped by the user’s past performance without breaking the realism of the current role.

- **Evaluation plus improvement loop**  
  Each session is evaluated, resources are fetched afterward, and thread-level progress is tracked over time.

A normal voice agent can answer.
PitchMirror can simulate, evaluate, and adapt.

## Tech stack

### Frontend

- **React 19** for the application UI
- **App Router-based route structure** in [app](./app)
- **JavaScript** throughout the client and server code
- **CodeMirror 6** via [@uiw/react-codemirror](https://github.com/uiwjs/react-codemirror) for the coding round editor
- custom CSS in [app/globals.css](./app/globals.css)
- browser media APIs for mic capture, screen sharing, and PiP

### Backend

- **Node.js**
- **Express** for API routes
- **ws** for the custom WebSocket bridge
- **multer** for PDF uploads
- **pdf-parse** for extracting raw PDF text

### AI and realtime stack

- **Gemini Live** via [@google/genai](https://www.npmjs.com/package/@google/genai)  
  Used for the live conversational engine, agent behavior, transcript-aware reasoning, uploaded-file context, hidden thread memory, and screen-share visual context.

- **Gemini model used for live sessions**  
  - `gemini-2.5-flash-native-audio-preview-12-2025`

- **Gemini model used for generation and structured evaluation tasks**  
  - `gemini-2.5-flash`

This `gemini-2.5-flash` path is used for:
- upload context cleanup
- session evaluation
- thread evaluation
- session comparison
- post-resource curation
- parts of external research synthesis

### Avatar stack

- **Anam JavaScript SDK** via [@anam-ai/js-sdk](https://www.npmjs.com/package/@anam-ai/js-sdk)

In this project, Anam is used as the **avatar rendering layer**, not as the core reasoning layer.

The current setup uses:
- Gemini Live for the actual voice output and live logic
- Anam for avatar rendering and audio passthrough lip-sync

That separation keeps the voice and simulation logic stable while making the avatar system replaceable.

### Transcription

- **AssemblyAI** via [assemblyai](https://www.npmjs.com/package/assemblyai)

AssemblyAI handles live user transcription so the session transcript includes the user side of the conversation as well.

### External research and resources

- **Firecrawl** for search and scraping
- **LangChain** for tool-based orchestration
- **Zod** for tool schemas and validation

The project uses a **ReAct-style agentic workflow** for external research. That flow is implemented in [server.js](./server.js) with LangChain’s `createAgent()` plus explicit search and scrape tools.

This is used for:
- company-aware coding-question research
- investor/company diligence context
- generic external context for custom sessions
- improvement-resource discovery and ranking

The ReAct agent does not just call a single search endpoint. It follows a tool-using loop:
1. search for candidate sources
2. inspect likely pages
3. scrape the strongest matches
4. synthesize one grounded result for the live session or report

That makes the context generation more explainable and more controllable than a one-shot prompt.


## Environment example

```env
NODE_ENV=development
HOST=0.0.0.0
PORT=3000

GEMINI_API_KEY=your_default_gemini_key
GEMINI_LIVE_API_KEY=your_gemini_live_key
GEMINI_QUESTION_FINDER_API_KEY=your_question_finder_key
GEMINI_EVALUATION_API_KEY=your_evaluation_key
GEMINI_RESOURCE_CURATION_API_KEY=your_resource_key
GEMINI_UPLOAD_PREP_API_KEY=your_upload_prep_key

ANAM_API_KEY=your_anam_api_key
ASSEMBLYAI_API_KEY=your_assemblyai_key
FIRECRAWL_API_KEY=your_firecrawl_key

NEXT_PUBLIC_BACKEND_HTTP_URL=
NEXT_PUBLIC_BACKEND_WS_URL=
