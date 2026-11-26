/** The default role line on "Make me yours" when nothing was picked or learned: no goal to build on. */
const NO_GOAL = /^Helps with whatever you need/i;

/**
 * The setup onboarding recommends from what the person told it: a morning routine when "What I do"
 * says something real or page 3 found their work, else nothing (Here's your Bubble AI then shows only
 * what was really set up).
 */
export function recommendedSetup(person: string, role: string, facts: readonly { group: string; text: string }[]): { routine: { name: string; schedule: string; steps: string } | null } {
  // "Helps with your inbox and research, so you have more time." → "your inbox and research"
  const goal = role.trim() && !NO_GOAL.test(role.trim()) ? role.trim().replace(/^helps? with\s+/i, "").replace(/,?\s*(so you have more time|and whatever else you need)\.?$/i, "").replace(/[.\s]+$/, "") : "";
  const work = facts.filter((f) => f.group === "Work").map((f) => f.text.trim()).filter(Boolean).slice(0, 4);
  if (!goal && !work.length) return { routine: null };
  const who = person.trim().split(/\s+/)[0] || "them";
  const steps = [
    "# Morning plan",
    "",
    `Every morning, message ${who} in your chat with a short plan for the day:`,
    "- what needs them today",
    "- one thing you can do for them now, asked as a yes/no question",
    "",
    ...(goal ? [`What they want help with: ${goal}.`] : []),
    ...(work.length ? [`What they're working on: ${work.join(", ")}.`] : []),
    "",
    "Keep it under 80 words. Never send, buy or post anything as them without a yes.",
  ].join("\n");
  return { routine: { name: "Morning plan", schedule: "0 8 * * *", steps } };
}
