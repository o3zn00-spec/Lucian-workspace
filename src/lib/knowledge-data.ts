// Knowledge Library catalog. Built-in content across 6 categories.

export type KnowledgeItem = {
  id: string
  category: "philosophy" | "psychology" | "strategy" | "leadership" | "history" | "development"
  title: string
  author: string
  summary: string
  content: string
  estimatedMinutes: number
  keyIdeas: string[]
}

export type KnowledgeProgress = {
  status: "reading" | "read"
  progress: number
  notes: string
  highlights: string
  quotes: string
}

export const KNOWLEDGE_ITEMS: KnowledgeItem[] = [
  // Philosophy
  {
    id: "ph-stoic",
    category: "philosophy",
    title: "Stoic Foundations",
    author: "LUCIAN Editorial",
    summary: "Practical wisdom from Marcus Aurelius, Epictetus, and Seneca.",
    content: "Stoicism teaches that we should distinguish between what is in our control and what is not. Our judgments, intentions, and efforts are within our power; outcomes, reputation, and the actions of others are not. By focusing on what we control, we free ourselves from unnecessary anxiety.\n\nMarcus Aurelius reminded himself each morning that he would meet the ungrateful, the arrogant, and the selfish — and that none of these could harm him unless he allowed them to. This daily rehearsal was not pessimism but preparation.\n\nPractical stoic exercises include the morning meditation, the evening review, negative visualization (imagining the loss of what we have, to deepen gratitude), and the view-from-above (placing our concerns in cosmic perspective).",
    estimatedMinutes: 12,
    keyIdeas: ["Dichotomy of control", "Negative visualization", "Evening review", "Amor fati"],
  },
  {
    id: "ph-logic",
    category: "philosophy",
    title: "Introduction to Logic",
    author: "LUCIAN Editorial",
    summary: "Core principles of valid reasoning and common fallacies.",
    content: "Logic studies the principles of valid inference. A deductive argument is valid if its conclusion necessarily follows from its premises, and sound if it is both valid and its premises are true.\n\nCommon fallacies include ad hominem (attacking the person rather than the argument), straw man (misrepresenting an opponent's position), false dilemma (presenting only two options when more exist), and appeal to authority (treating an expert's word as proof outside their domain).\n\nPracticing logic sharpens decision-making by exposing hidden assumptions and forcing precision in language.",
    estimatedMinutes: 10,
    keyIdeas: ["Deductive validity", "Soundness", "Common fallacies", "Precision in language"],
  },
  // Psychology
  {
    id: "ps-cbt",
    category: "psychology",
    title: "Cognitive Behavioral Principles",
    author: "LUCIAN Editorial",
    summary: "How thoughts shape emotions and behaviors.",
    content: "Cognitive Behavioral Therapy (CBT) is built on the observation that our interpretations of events — not the events themselves — shape our emotional responses. By identifying automatic thoughts, testing them against evidence, and replacing distortions with balanced thinking, we can change persistent negative moods.\n\nCommon cognitive distortions include all-or-nothing thinking, overgeneralization, mental filtering, disqualifying the positive, jumping to conclusions, emotional reasoning, should-statements, and personalization.\n\nA simple three-step practice: (1) write the activating event, (2) record the automatic thought and rate the emotion, (3) generate a balanced alternative thought and re-rate the emotion.",
    estimatedMinutes: 14,
    keyIdeas: ["Automatic thoughts", "Cognitive distortions", "Thought records", "Balanced alternatives"],
  },
  {
    id: "ps-habits",
    category: "psychology",
    title: "Habit Formation",
    author: "LUCIAN Editorial",
    summary: "The cue-routine-reward loop and how to reshape it.",
    content: "Habits operate through a three-step loop: a cue triggers a routine, which delivers a reward. To change a habit, keep the cue and reward but swap the routine.\n\nResearch suggests that habits form through repetition and contextual stability. The oft-cited '21 days' figure is a myth — actual formation times range from 18 to 254 days depending on complexity.\n\nImplementation intentions ('if X, then Y') dramatically increase follow-through. Stacking a new habit onto an existing one ('after I pour my morning coffee, I will write three priorities') is a reliable way to bootstrap new routines.",
    estimatedMinutes: 9,
    keyIdeas: ["Cue-routine-reward", "Implementation intentions", "Habit stacking", "Context stability"],
  },
  // Strategy
  {
    id: "st-powers",
    category: "strategy",
    title: "Sources of Power",
    author: "LUCIAN Editorial",
    summary: "Hard, soft, and structural levers of influence.",
    content: "Power is the capacity to influence outcomes. Hard power relies on coercion and payment; soft power relies on attraction and persuasion; structural power operates through the rules of the game.\n\nEffective strategists combine these sources. A leader with strong soft power can reduce the cost of hard power; one with structural power can shape the choices others perceive as available.\n\nKey questions when assessing power: Who sets the agenda? Who controls resources? Who is relied upon? Whose exit would impose the highest cost? Mapping these dependencies reveals leverage points that may not be visible on an org chart.",
    estimatedMinutes: 11,
    keyIdeas: ["Hard vs soft power", "Structural power", "Dependency mapping", "Leverage points"],
  },
  {
    id: "st-ooda",
    category: "strategy",
    title: "The OODA Loop",
    author: "LUCIAN Editorial",
    summary: "Observe, orient, decide, act — a framework for fast decision cycles.",
    content: "Developed by fighter pilot John Boyd, the OODA loop describes how individuals and organizations make decisions under uncertainty. Observe the situation, orient by integrating new information with prior mental models, decide on a course of action, and act.\n\nThe goal is to cycle faster than the opponent. A faster cycle disrupts their orientation, causing confusion and paralysis. Speed comes from preparation: rehearsed responses, clear decision criteria, and decentralized execution.\n\nIn business, OODA encourages rapid experimentation over extensive planning. Ship a small version, observe real responses, orient the strategy, and act again.",
    estimatedMinutes: 8,
    keyIdeas: ["Observe-Orient-Decide-Act", "Cycle speed", "Decentralized execution", "Rapid experimentation"],
  },
  // Leadership
  {
    id: "ld-trust",
    category: "leadership",
    title: "Building Trust",
    author: "LUCIAN Editorial",
    summary: "Competence, character, and care as the trust triangle.",
    content: "Trust has three components: competence (can you do it?), character (will you do the right thing?), and care (do you have my interests at heart?). Trust breaks when any one of these is perceived as missing.\n\nLeaders build competence trust by delivering results and developing expertise. Character trust grows through consistency between words and actions, especially when no one is watching. Care trust is built by attending to individuals as people, not just resources.\n\nRebuilding trust after a breach requires acknowledging the breach, taking responsibility, and demonstrating consistent change over time — not a single apology.",
    estimatedMinutes: 10,
    keyIdeas: ["Trust triangle", "Consistency", "Acknowledging breaches", "Care for individuals"],
  },
  {
    id: "ld-delegation",
    category: "leadership",
    title: "Effective Delegation",
    author: "LUCIAN Editorial",
    summary: "Match task, autonomy, and check-in cadence to the person.",
    content: "Delegation fails when leaders either hold on too tightly or abdicate entirely. The fix is to match the level of autonomy to the readiness of the person for the specific task.\n\nA practical ladder: (1) tell — decide and instruct; (2) sell — explain the why; (3) consult — gather input before deciding; (4) agree — decide together; (5) advise — share opinion, let them decide; (6) delegate — hand off entirely with results-only check-ins.\n\nAlways be explicit about the level of autonomy you are granting. Ambiguity here is the single most common source of friction in delegation.",
    estimatedMinutes: 9,
    keyIdeas: ["Autonomy ladder", "Readiness match", "Explicit autonomy levels", "Results-only check-ins"],
  },
  // History
  {
    id: "hi-roman",
    category: "history",
    title: "Lessons from the Roman Republic",
    author: "LUCIAN Editorial",
    summary: "Institutions, ambition, and the cost of expansion.",
    content: "The Roman Republic lasted nearly five centuries before collapsing into empire. Its mixed constitution — consuls, senate, popular assemblies — inspired later thinkers including Montesquieu and the framers of the United States Constitution.\n\nThe Republic's downfall followed a pattern: military expansion concentrated wealth, wealth concentrated political power, and concentrated power eroded the norms that restrained ambition. Reformers like the Gracchi were killed for threatening the established order; soon after, generals like Marius, Sulla, and Caesar used their armies to settle political disputes.\n\nThe lesson: institutions depend on unwritten norms. Written rules are necessary but insufficient; they must be reinforced by a culture that punishes their violation.",
    estimatedMinutes: 13,
    keyIdeas: ["Mixed constitution", "Concentration of wealth", "Norm erosion", "Military-political fusion"],
  },
  {
    id: "hi-industrial",
    category: "history",
    title: "Industrial Revolutions",
    author: "LUCIAN Editorial",
    summary: "Three waves and their social consequences.",
    content: "The First Industrial Revolution (1760-1840) replaced hand production with steam-powered machinery. The Second (1870-1914) introduced electricity, mass production, and the modern corporation. The Third (1960-2000) brought computing and digital networks. We are now in the Fourth, characterized by AI, biotechnology, and interconnected physical-digital systems.\n\nEach revolution displaced workers in the short term while raising living standards over decades. The political fault lines of each era were shaped by who captured the gains and who bore the disruption.\n\nStudying the transitions helps us anticipate the social contract questions posed by today's technologies.",
    estimatedMinutes: 11,
    keyIdeas: ["Three waves", "Short-term displacement", "Distribution of gains", "Social contract"],
  },
  // Personal development
  {
    id: "pd-deep",
    category: "development",
    title: "Deep Work",
    author: "LUCIAN Editorial",
    summary: "Cultivating focus in a distracted world.",
    content: "Deep work refers to professional activities performed in a state of distraction-free concentration that push cognitive capabilities to their limit. These efforts create new value, improve skill, and are hard to replicate.\n\nTo practice deep work: schedule dedicated blocks, eliminate digital distractions, set a clear objective for each block, and build a shutdown ritual to mark the end of focus. Treat shallow work (email, status meetings, admin) as a budget to be minimized, not a default.\n\nTracking deep work hours weekly makes the practice visible and lets you correlate focus with output over time.",
    estimatedMinutes: 10,
    keyIdeas: ["Distraction-free blocks", "Clear objectives", "Shutdown ritual", "Shallow-work budget"],
  },
  {
    id: "pd-time",
    category: "development",
    title: "Time and Energy Management",
    author: "LUCIAN Editorial",
    summary: "Aligning tasks with biological rhythms.",
    content: "Productivity is not just about time — it is about matching the right task to the right energy state. Most people have a peak cognitive window of 2-4 hours per day; protecting this window for the most important work multiplies output.\n\nA simple weekly review: list all recurring commitments, rate each by energy cost (high/medium/low), and identify which can be batched, delegated, or eliminated.\n\nRecovery is not optional. Sleep, exercise, and deliberate rest are not breaks from productive work — they are inputs to it.",
    estimatedMinutes: 9,
    keyIdeas: ["Energy-state matching", "Peak cognitive window", "Weekly review", "Recovery as input"],
  },
]

export const KNOWLEDGE_CATEGORIES = [
  { id: "philosophy", label: "Philosophy" },
  { id: "psychology", label: "Psychology" },
  { id: "strategy", label: "Strategy" },
  { id: "leadership", label: "Leadership" },
  { id: "history", label: "History" },
  { id: "development", label: "Personal Development" },
] as const
