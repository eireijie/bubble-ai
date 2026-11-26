/**
 * What an agent does, as it says it about itself. People describe an agent in their own words, in
 * the third person ("Says pong", "Keeps my days on track"), as a job ("Engineer") or as a topic
 * ("Emails and calendar"). These turn that into one grammatical first-person sentence for its
 * hello, instead of splicing the words into a template ("I'm here to says pong").
 */

/** Verbs a description usually starts with, in their base form. */
const VERBS = new Set(
  (
    "answer ask book build buy call catch check clean code collect compare cook count create debug deploy design do draft " +
    "edit email file find fix follow get go handle have help hunt keep learn list log look make manage map monitor move note " +
    "order organize organise pay plan play post practice prepare read record remember remind reply report research respond " +
    "review run save say schedule search sell send set share shop sort spot start study summarize summarise support take talk " +
    "teach test text tidy track train translate triage try turn update watch work write"
  ).split(" "),
);

/** Words that name a job: "your engineer", "your assistant". */
const JOB = /(?:er|or|ist|ant|ent|ian|ee|bot|agent|assistant|manager|helper|buddy|coach|tutor|guide|partner|friend|aide|clerk|lead|expert|pro)$/i;

/** "says" → "say", "watches" → "watch", "tries" → "try"; null when it isn't a verb it knows. */
export function baseVerb(word: string): string | null {
  const w = word.toLowerCase();
  if (VERBS.has(w)) return w;
  if (w === "does") return "do";
  if (w === "has") return "have";
  if (w === "goes") return "go";
  if (w.endsWith("ies") && VERBS.has(w.slice(0, -3) + "y")) return w.slice(0, -3) + "y";
  if (/(?:ch|sh|ss|x|z|o)es$/.test(w) && VERBS.has(w.slice(0, -2))) return w.slice(0, -2);
  if (w.endsWith("s") && VERBS.has(w.slice(0, -1))) return w.slice(0, -1);
  return null;
}

/** The person's words as the agent says them back: "my" → "your", "me" → "you". */
function toYou(text: string): string {
  return text
    .replace(/\bmy\b/gi, "your")
    .replace(/\bmine\b/gi, "yours")
    .replace(/\bmyself\b/gi, "yourself")
    .replace(/\bme\b/gi, "you")
    .replace(/\bI'm\b/g, "you're")
    .replace(/\bI\b/g, "you");
}

/** A description with the bits people add in front taken off: "An agent that", "It", "Helps to"… */
function trimLead(text: string): string {
  return text
    .trim()
    .replace(/[.!\s]+$/, "")
    .replace(/^(?:(?:an?|the|my|your)\s+)?(?:agent|bot|assistant|helper)\s+(?:that|who|which|to)\s+/i, "")
    .replace(/^(?:it|he|she|they|this(?:\s+agent)?)\s+(?:will\s+|should\s+|can\s+)?/i, "")
    .replace(/^(?:i'm|i am)\s+here\s+to\s+/i, "")
    .replace(/^(?:i\s+will|i'll|i\s+can|will|to)\s+/i, "")
    .trim();
}

/**
 * One sentence in the agent's voice about what it does, or "" for no description:
 *   "Says pong" → "I'm here to say pong."
 *   "Keeps my days on track" → "I'm here to keep your days on track."
 *   "Answering support emails" → "I'll be answering support emails."
 *   "Engineer" → "I'm your engineer."
 *   "Emails and calendar" → "I'll help with emails and calendar."
 */
export function roleSentence(description: string): string {
  const text = trimLead(description);
  if (!text) return "";
  const [first, ...rest] = text.split(/\s+/);
  const tail = toYou(rest.join(" "));
  // "Emails and calendar", "Reports": a word that could be a verb but has nothing after it to act on is a topic
  const listed = !rest.length || /^(?:and|or|&)$/i.test(rest[0]) || /,$/.test(first);
  const verb = listed ? null : baseVerb(first.replace(/[^a-z']/gi, ""));
  if (verb) return `I'm here to ${[verb, tail].filter(Boolean).join(" ")}.`;
  if (/ing$/i.test(first) && first.length > 4) return `I'll be ${toYou(text.charAt(0).toLowerCase() + text.slice(1))}.`;
  const phrase = toYou(text.replace(/^(?:an?|the|your|my)\s+/i, ""));
  const lower = phrase.charAt(0).toLowerCase() + phrase.slice(1);
  // a job ("Engineer", "Sales assistant", "Researcher for my shop"): the part before "for"/"at"/"of"
  const job = lower.split(/\s+(?:for|at|of|in|on|with)\s+/)[0];
  if (JOB.test(job.trim())) return `I'm your ${lower}.`;
  return `I'll help with ${lower}.`;
}
