export const AGENTS = [
  {
    slug: "professor",
    name: "Professor Panel",
    role: "Academic judge",
    duration: "12 min room",
    description:
      "Practice thesis defenses, capstone demos, and research presentations with a skeptical but fair faculty lens.",
    longDescription:
      "A sharper academic rehearsal room for students, researchers, and founders who need to defend ideas with clarity. Use it when the audience expects structured thinking, evidence, and calm responses under questioning.",
    scenario:
      "A faculty-style review with emphasis on structure, evidence, confidence, and depth.",
    focus: ["Concept clarity", "Research framing", "Defense under pressure"],
    flow: [
      "Short salutation and framing of the academic scenario.",
      "Opening question anchored in your topic or uploaded PDF.",
      "Follow-up probing on assumptions, evidence, and tradeoffs.",
    ],
    previewMetrics: [
      { label: "Clarity", value: "84" },
      { label: "Confidence", value: "76" },
    ],
  },
  {
    slug: "recruiter",
    name: "Recruiter Loop",
    role: "Hiring screen",
    duration: "15 min room",
    description:
      "Run through behavioral and role-fit questions in a recruiter-style conversation focused on polish, impact, and communication.",
    longDescription:
      "This room is designed for first-round screens, internship interviews, and polished storytelling practice. It emphasizes concise examples, confidence signals, and strong communication without losing authenticity.",
    scenario:
      "A realistic recruiter conversation focused on fit, ownership, communication, and role alignment.",
    focus: ["Behavioral answers", "Role fit", "Impact storytelling"],
    flow: [
      "Warm greeting and interview-style intro.",
      "One question at a time with natural pacing.",
      "Follow-ups when the answer lacks specifics or confidence.",
    ],
    previewMetrics: [
      { label: "Presence", value: "88" },
      { label: "Impact", value: "81" },
    ],
  },
  {
    slug: "investor",
    name: "Investor Room",
    role: "Pitch judge",
    duration: "10 min room",
    description:
      "Rehearse startup pitches, demo days, and partner meetings with attention on market logic, traction, and conviction.",
    longDescription:
      "Use this room when the conversation needs to feel fast, skeptical, and high stakes. It is framed around clarity of market, traction, product edge, and how convincingly you handle challenge questions.",
    scenario:
      "A concise investor-style pitch room with direct questions about market, traction, and differentiation.",
    focus: ["Narrative sharpness", "Traction framing", "Conviction"],
    flow: [
      "Fast introduction with a high-stakes room setup.",
      "Questions targeting why now, why you, and why this market.",
      "Pressure-test answers around differentiation and risk.",
    ],
    previewMetrics: [
      { label: "Traction", value: "79" },
      { label: "Conviction", value: "85" },
    ],
  },
  {
    slug: "custom",
    name: "Custom Agent",
    role: "Flexible rehearsal",
    duration: "Flexible room",
    description:
      "A general-purpose rehearsal setup for demos, presentations, oral exams, or anything that needs a live audience simulation.",
    longDescription:
      "A flexible room for when you need the UI and workflow of PitchMirror without being boxed into one archetype. It works well for product demos, leadership updates, class presentations, and hybrid prep sessions.",
    scenario:
      "A configurable general-purpose practice room with the same live avatar pipeline and dashboard layout.",
    focus: ["Adaptability", "Delivery", "Audience handling"],
    flow: [
      "Neutral opening with a simple introduction.",
      "Conversation adapts to what you say and what your document contains.",
      "A balanced mix of broad and pointed follow-up questions.",
    ],
    previewMetrics: [
      { label: "Adaptability", value: "82" },
      { label: "Delivery", value: "80" },
    ],
  },
];

export const AGENT_LOOKUP = AGENTS.reduce((acc, agent) => {
  acc[agent.slug] = agent;
  return acc;
}, {});

export const DEFAULT_METRICS = {
  score: 82,
  metrics: [
    { label: "Confidence", value: 78 },
    { label: "Clarity", value: 86 },
    { label: "Depth", value: 80 },
    { label: "Composure", value: 84 },
  ],
};

export const STATIC_POST_SESSION_METRICS = {
  professor: {
    score: 86,
    metrics: [
      { label: "Confidence", value: 81 },
      { label: "Clarity", value: 89 },
      { label: "Depth", value: 87 },
      { label: "Composure", value: 85 },
    ],
  },
  recruiter: {
    score: 88,
    metrics: [
      { label: "Confidence", value: 84 },
      { label: "Clarity", value: 91 },
      { label: "Depth", value: 82 },
      { label: "Composure", value: 89 },
    ],
  },
  investor: {
    score: 84,
    metrics: [
      { label: "Confidence", value: 88 },
      { label: "Clarity", value: 82 },
      { label: "Depth", value: 79 },
      { label: "Composure", value: 85 },
    ],
  },
  custom: {
    score: 85,
    metrics: [
      { label: "Confidence", value: 83 },
      { label: "Clarity", value: 84 },
      { label: "Depth", value: 81 },
      { label: "Composure", value: 90 },
    ],
  },
};
