import { WISP_COMMANDS, agentSkillPath, cronMatches, describeCron, parseCron, skillFile, skillSlug, zonedParts, type Actor, type RecordedStep, type Routine } from "@wisp/core";
import { MAX_LEARNED } from "./connectors.ts";
import { featureOn } from "./features.ts";
import { agentPolicy } from "./policy.ts";
import type { Hub } from "./hub.ts";

const WISP = { name: "Wisp", email: "wisp@localhost" };

export function routineSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "routine"
  );
}

const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, "0")}`;

/** One line per recorded step, the way the agent reads it. Exported for tests. */
export function stepLine(s: RecordedStep, i: number): string {
  const where = s.x !== undefined && s.y !== undefined ? ` at (${Math.round(s.x)}, ${Math.round(s.y)})` : "";
  const what =
    s.kind === "type"
      ? `typed "${s.text ?? ""}"`
      : s.kind === "key"
        ? `pressed ${s.keys}`
        : s.kind === "scroll"
          ? `scrolled ${s.direction ?? "down"}${where}`
          : s.kind === "drag"
            ? `dragged from (${Math.round(s.x ?? 0)}, ${Math.round(s.y ?? 0)}) to (${Math.round(s.toX ?? 0)}, ${Math.round(s.toY ?? 0)})`
            : s.kind === "note"
              ? `said: "${s.text ?? ""}"`
              : `${{ click: "clicked", double_click: "double-clicked", right_click: "right-clicked" }[s.kind]}${where}`;
  const on = s.element ? ` on the ${s.element.role}${s.element.name ? ` "${s.element.name}"` : ""}${s.element.selector ? ` (${s.element.selector})` : ""} at ${s.element.url}` : "";
  return `${i + 1}. [${clock(s.at)}] ${what}${on}${s.imageFileId ? ` (screen before: file ${s.imageFileId})` : ""}`;
}

/** Teach a task can't start: why, in words for the person. */
export class TeachRefused extends Error {}

/**
 * Routines: things an agent does again, often on a schedule. People write the steps, or ask the
 * agent to make one that follows a skill. Teaching a task (doing it once while the agent watches)
 * lives here too, but it ends in a skill, not a routine.
 */
export class Routines {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private hub: Hub) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 20_000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Run every scheduled routine whose time has come (once per matching minute). */
  async tick(at = new Date()) {
    const minute = new Date(Math.floor(at.getTime() / 60_000) * 60_000);
    for (const r of this.hub.store.scheduledRoutines()) {
      // schedules rest while the organization has Routines switched off (Settings → General → Mods)
      if (!featureOn(this.hub.store, r.workspaceId, "routines")) continue;
      try {
        if (!cronMatches(parseCron(r.schedule!), zonedParts(minute, r.timezone))) continue;
      } catch {
        continue;
      }
      if (r.lastRunAt && new Date(r.lastRunAt).getTime() >= minute.getTime()) continue;
      // its agent's plan limit is reached: the run would only fail. This time is skipped (not retried), and said once.
      const agent = this.hub.store.agent(r.agentId);
      const reached = agent && this.hub.limits.reached(agent, at);
      if (agent && reached) {
        this.hub.store.updateRoutine(r.id, { lastRunAt: minute.toISOString() });
        const channelId = this.channelFor(r);
        if (channelId) this.hub.limits.saySkipped(agent, channelId, `routine:${r.id}`, r.createdBy.kind === "user" ? r.createdBy.id : null, reached, `the routine "${r.name}"`, at);
        continue;
      }
      this.run(r, null, minute);
    }
  }

  /** Where a routine's runs are posted: its channel, or a DM between the agent and whoever made it. */
  channelFor(r: Routine): string | null {
    if (r.channelId && this.hub.store.channel(r.channelId)) return r.channelId;
    const owner = r.createdBy.kind === "user" ? r.createdBy.id : this.hub.store.members(r.workspaceId).find((m) => m.role === "owner")?.id;
    return owner ? this.hub.store.dmChannel(r.workspaceId, owner, r.agentId).id : null;
  }

  /** Wake the agent to do the routine. `by` is the person who pressed Run; null for the schedule (due at `at`). */
  run(r: Routine, by: Actor | null, at = new Date()) {
    const agent = this.hub.store.agent(r.agentId);
    const channelId = this.channelFor(r);
    if (!agent || !channelId) return null;
    this.hub.store.updateRoutine(r.id, { lastRunAt: at.toISOString() });
    const why = by ? "" : ` (${r.schedule ? describeCron(r.schedule).replace(/^Every/, "every") : "scheduled"})`;
    const msg = this.hub.postMessage({
      channelId,
      author: by ?? { kind: "user", id: "system" },
      body: `@${agent.handle} Run the routine **${r.name}**${why}.`,
      parts: [{ type: "routine", routineId: r.id }],
      // on a schedule, the routine works for whoever set it up
      onBehalfOf: by ? undefined : r.createdBy.kind === "user" ? r.createdBy.id : null,
    });
    this.hub.broadcast(r.workspaceId, { type: "routines_changed" });
    return msg;
  }

  /**
   * A run ended successfully: if it was a request to run a routine, record the completion time.
   * Other messages can carry a routine part (an agent saying it made one), so run requests are told
   * apart by their body, which run() writes as "@handle Run the routine **name**".
   */
  runFinished(run: { triggerMessageId: string }) {
    const msg = this.hub.store.message(run.triggerMessageId);
    if (!msg || !/^@\S+ Run the routine\b/.test(msg.body)) return;
    for (const part of msg.parts) {
      if (part.type !== "routine") continue;
      const r = this.hub.store.routine(part.routineId);
      if (!r) continue;
      this.hub.store.routineCompleted(r.id);
      this.hub.broadcast(r.workspaceId, { type: "routines_changed" });
    }
  }

  /**
   * A person showed the agent how to do something (Teach a task). The recording becomes a note,
   * and the agent is asked in their chat to save the steps as a skill (skill_save). A skill has no
   * schedule: if the person wants it done regularly, the agent offers a routine that follows it.
   * Refused while agents can't save skills (Settings → Skills) or this one has saved all it can.
   */
  async teach(o: { workspaceId: string; agentId: string; userId: string; name: string; computerId: string | null; steps: RecordedStep[]; durationMs: number; narration?: string }) {
    if (!agentPolicy(this.hub, o.workspaceId).learnSkills) throw new TeachRefused("Saving skills is off in Settings → Skills. Turn it on to teach a task.");
    const agent = this.hub.store.agent(o.agentId)!;
    const known = this.hub.skills.learnedBy(o.workspaceId, agent.id);
    const again = known.some((k) => k.name.toLowerCase() === o.name.trim().toLowerCase() || k.slug === skillSlug(o.name));
    if (!again && known.length >= MAX_LEARNED) throw new TeachRefused(`${agent.name} has saved as many skills as it can. Forget some in Settings → Skills.`);
    const user = this.hub.store.user(o.userId);
    const vault = this.hub.vault(o.workspaceId);
    const slug = routineSlug(o.name);
    let recordingPath = `agents/${agent.id}/lessons/${slug}.md`;
    for (let i = 2; vault.list((p) => p.toLowerCase() === recordingPath.toLowerCase()).length; i++) recordingPath = `agents/${agent.id}/lessons/${slug}-${i}.md`;
    const computer = o.computerId ? this.hub.store.computer(o.computerId) : undefined;
    const recording = [
      `# Recording: ${o.name}`,
      "",
      `${user?.name ?? "Someone"} did this once on ${computer ? `the computer "${computer.name}"` : "a computer"} so @${agent.handle} could learn it (${clock(o.durationMs)} long, ${o.steps.length} steps).`,
      o.narration?.trim() ? `\n## What they said\n${o.narration.trim()}` : "",
      "",
      "## Steps",
      ...o.steps.map(stepLine),
      "",
    ].join("\n");
    await vault.write(recordingPath, recording, WISP, `Recording of "${o.name}" for @${agent.handle}`);
    const channelId = this.hub.store.dmChannel(o.workspaceId, o.userId, agent.id).id;
    const msg = this.hub.postMessage({
      channelId,
      author: { kind: "user", id: o.userId },
      body: `@${agent.handle} I just showed you how to **${o.name}**. Save it as a skill so you can do it on your own next time.`,
      parts: [{ type: "lesson", name: o.name, recordingPath }],
    });
    return { name: o.name, recordingPath, channelId, messageId: msg.id };
  }

  /**
   * Older hubs turned Teach a task into a routine that stayed "learning" until the agent saved
   * steps. Each one still learning becomes a skill made from its recording (no model run). One
   * with a schedule stays a routine whose steps follow that skill; the rest go away. The
   * recording note stays.
   */
  async migrateLearning() {
    for (const r of this.hub.store.learningRoutines()) {
      const agent = this.hub.store.agent(r.agentId);
      if (!agent) {
        this.hub.store.deleteRoutine(r.id);
        continue;
      }
      const vault = this.hub.vault(r.workspaceId);
      const recordingPath = r.notePath.replace(/\.md$/, ".recording.md");
      const rec = await vault.read(recordingPath).then((n) => n.content, () => "");
      const who = r.createdBy.kind === "user" ? (this.hub.store.user(r.createdBy.id)?.name ?? "Someone") : "Someone";
      const content = [
        `${who} showed this once on a computer${rec ? ` ([[${recordingPath.split("/").pop()!.replace(/\.md$/, "")}]])` : ""}. Follow the steps by the labels of buttons and fields, not by where they were, since layouts move. If a step doesn't match what you see, adapt; if you get stuck, ask.`,
        "",
        rec.replace(/^# .*\n+/, "").trim() || "(The recording is missing. Ask how it's done before doing it.)",
      ].join("\n");
      const reserved = [...WISP_COMMANDS.map((w) => w.name), ...(this.hub.catalogFor(agent)?.commands ?? []).map((x) => x.name)];
      const skill = this.hub.skills.create(r.workspaceId, agent.id, {
        name: r.name,
        slug: this.hub.skills.freeSlug(r.workspaceId, skillSlug(r.name), reserved),
        description: `${r.name}, the way ${who} showed it`.slice(0, 200),
        source: "learned",
        content,
        learnedBy: agent.id,
      });
      this.hub.skills.attach(skill.id, agent.id, true);
      await vault.write(agentSkillPath(agent.id, skill.slug), skillFile(skill), WISP, `Skill "${skill.name}" for @${agent.handle}, from a routine it was learning`);
      if (r.schedule) {
        await vault.write(r.notePath, `# ${r.name}\n\nFollow the skill /${skill.slug}.\n`, WISP, `Routine "${r.name}" follows /${skill.slug}`);
        this.hub.store.updateRoutine(r.id, { status: "ready" });
      } else {
        this.hub.store.deleteRoutine(r.id);
        await vault.remove(r.notePath, WISP).catch(() => {});
      }
    }
  }

  /** What an agent should know about its routines, for its prompt. */
  async promptSection(agentId: string, trigger: { parts: { type: string; routineId?: string }[] }): Promise<string> {
    const agent = this.hub.store.agent(agentId);
    if (!agent) return "";
    const mine = this.hub.store.routines(agent.workspaceId, agentId);
    const out: string[] = [];
    const lesson = trigger.parts.find((p): p is { type: "lesson"; name: string; recordingPath: string } => p.type === "lesson");
    if (lesson && lesson.recordingPath.startsWith(`agents/${agentId}/lessons/`)) {
      const rec = await this.hub.vault(agent.workspaceId).read(lesson.recordingPath).then((n) => n.content, () => "");
      out.push(
        `## Learning a skill: ${lesson.name}`,
        `A person did this task once while you watched. Their recording is below; the "screen before" files are screenshots you can look at with file_view.`,
        `Work out the steps so you could do it yourself next time: what to open, which buttons and fields to use (describe them by their labels, not by coordinates, since layouts move), what to type, and which parts change from one time to the next. If something is unclear, ask.`,
        `Save the steps with skill_save (name "${lesson.name}"): short numbered steps, and where to stop and ask a person. Then reply with a short summary of what you learned and anything you need to know before doing it on your own.`,
        `A skill has no schedule. If this sounds like something they'd want done regularly, ask whether you should do it on a schedule; only if they say yes, make a routine with routine_save whose steps say to follow the skill you saved.`,
        "",
        rec,
      );
    }
    const part = trigger.parts.find((p) => p.type === "routine");
    const r = part?.routineId ? this.hub.store.routine(part.routineId) : undefined;
    if (r && r.agentId === agentId && r.status === "ready") {
      const note = await this.hub.vault(agent.workspaceId).read(r.notePath).then((n) => n.content, () => "");
      out.push(`## Routine to run now: ${r.name}`, `Follow these steps (from ${r.notePath}). If a step doesn't match what you see, adapt; if you get stuck, say what blocked you.`, "", note);
    }
    const others = mine.filter((x) => x.id !== r?.id && x.status === "ready");
    if (others.length) out.push(`\nRoutines you know (steps in your memory, run one when asked): ${others.map((x) => `"${x.name}"${x.schedule ? ` (${describeCron(x.schedule).toLowerCase()})` : ""}`).join(", ")}.`);
    return out.join("\n");
  }
}
