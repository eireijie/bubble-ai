// Drives a freshly installed Bubble AI.exe through first-run setup (Self-Host), creates the account
// with test values, walks onboarding up to the AI page (no model key on CI), tries Claude
// subscription there, and checks this computer joined the hub as a device. Screenshot at every step. Used by windows-smoke.yml.
//   node drive.mjs <path to Bubble AI.exe> <screenshot folder>
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [exe, shots] = process.argv.slice(2);
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9333;

const app = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: "inherit" });
let exited = null;
app.on("exit", (code) => {
  exited = code;
  console.log(`Bubble AI.exe exited with ${code}`);
});

let browser;
for (let i = 0; i < 90 && !browser && exited === null; i++) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch {
    await sleep(1000);
  }
}
if (!browser) throw new Error("Couldn't attach to Bubble AI.exe's window (it never opened a debugging port)");
console.log("attached to Bubble AI.exe");

const shot = async (page, name) => {
  const file = path.join(shots, `${String(++n).padStart(2, "0")}-${name.replace(/[^\w-]+/g, "_").slice(0, 60)}.png`);
  await page.screenshot({ path: file }).catch(() => {});
};
const visibleText = (page) => page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
const heading = async (page) => ((await page.locator("h1").first().innerText({ timeout: 1000 }).catch(() => "")) || "").trim();

const STEPS = ['[data-q="on"][data-v="yes"]', "#pick-create", "#welcome-go", "#create-go", "#ready-go"];
const clicked = new Set();
let n = 0;
const failures = [];
const proven = [];

// 1. the desktop app's own setup window, up to the hub's web app
async function hubPage() {
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    if (exited !== null) throw new Error(`Bubble AI.exe quit during setup (exit ${exited})`);
    const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.url().startsWith("devtools:"));
    for (const page of pages) {
      const url = page.url();
      try {
        if (/^http:\/\/(localhost|127\.0\.0\.1):4747/.test(url)) {
          if (/Create your account/i.test(await visibleText(page))) return page;
          continue;
        }
        for (const sel of STEPS) {
          if (clicked.has(sel)) continue;
          const el = page.locator(sel).first();
          if (await el.isVisible().catch(() => false)) {
            await shot(page, `setup-before-${sel}`);
            console.log(`click ${sel} on ${url}`);
            await el.click({ timeout: 5000 });
            clicked.add(sel);
            await sleep(800);
            break;
          }
        }
      } catch (err) {
        console.log(`(${url}) ${err.message.split("\n")[0]}`);
      }
    }
    await sleep(1500);
  }
  throw new Error('Timed out before "Create your account"');
}

const page = await hubPage();
await shot(page, "create-account");
console.log(`PASS: first-run setup reached "Create your account" at ${page.url()}`);
proven.push("desktop setup → Create your account");

// 2. create the account with test values (a throwaway hub on the CI runner)
await page.getByLabel("Your name").fill("Smoke Test");
await page.getByLabel("Email").fill("smoke@example.test");
await page.locator('input[type="password"]').first().fill(`Smoke-${crypto.randomBytes(6).toString("hex")}`);
await shot(page, "create-account-filled");
await page.locator('input[type="password"]').first().press("Enter");
await sleep(1500);
if (/Create your account/i.test(await visibleText(page))) await page.getByRole("button", { name: "Continue" }).first().click({ timeout: 5000 }).catch(() => {});
await sleep(3000);

// 3. onboarding pages up to the AI page; at each new page, log it, screenshot it, move on
const FORWARD = /^(Continue|Skip|Skip for now|Not now|Next|Later|Maybe later|Use this|Done|Start|Only at home for now)$/i;
let last = "";
let same = 0;
let aiPage = false;
const until = Date.now() + 6 * 60_000;
while (Date.now() < until) {
  if (exited !== null) throw new Error(`Bubble AI.exe quit during onboarding (exit ${exited})`);
  const text = await visibleText(page);
  const h = await heading(page);
  if (/think with\?/i.test(text)) {
    aiPage = true;
    break;
  }
  if (h !== last) {
    console.log(`\n=== page: "${h}" (${page.url()})\n${text.slice(0, 700)}`);
    await shot(page, `onboarding-${h || "untitled"}`);
    proven.push(`onboarding page "${h}"`);
    last = h;
    same = 0;
  } else same++;
  // fill an empty required text box (an agent's name) so Continue can go on
  for (const input of await page.locator('input[type="text"]:visible, input:not([type]):visible').all()) {
    if (!(await input.inputValue().catch(() => "x"))) await input.fill("Pip").catch(() => {});
  }
  const buttons = await page.locator("button:visible").all();
  const labels = [];
  for (const b of buttons) labels.push(((await b.innerText().catch(() => "")) || "").trim().split("\n")[0].trim());
  let target = null;
  // after a few tries on the same page, pick its first choice before moving on
  if (same >= 2) {
    const choice = page.locator('[role="radio"]:visible, [role="radiogroup"] button:visible, [aria-pressed]:visible').first();
    if (await choice.count()) {
      console.log("pick the first choice");
      await choice.click({ timeout: 3000 }).catch(() => {});
    }
  }
  for (const [i, label] of labels.entries()) {
    if (!FORWARD.test(label)) continue;
    if (await buttons[i].isDisabled().catch(() => true)) continue;
    // prefer skipping optional things over setting them up
    if (!target || /skip|not now|later|only at home/i.test(label)) target = { b: buttons[i], label };
  }
  if (target) {
    console.log(`click "${target.label}" (buttons: ${labels.filter(Boolean).join(" | ")})`);
    await target.b.click({ timeout: 5000 }).catch((e) => console.log(`  ${e.message.split("\n")[0]}`));
  } else console.log(`no way forward yet (buttons: ${labels.filter(Boolean).join(" | ")})`);
  if (same > 12) break;
  await sleep(2000);
}

if (aiPage) {
  const text = await visibleText(page);
  console.log(`\n=== AI page (${page.url()})\n${text.slice(0, 1500)}`);
  await shot(page, "ai-page");
  proven.push("onboarding reached the AI page");
  // the device's details (its platform) arrive a moment after the page
  let upFront = false;
  for (let i = 0; i < 20 && !upFront; i++) {
    upFront = /On Windows, use an API key/.test(await visibleText(page));
    if (!upFront) await sleep(1000);
  }
  await shot(page, "ai-page-device-known");
  if (upFront) proven.push("Claude subscription says up front it needs an API key on Windows");
  else failures.push("Claude subscription doesn't say it needs an API key on Windows");
  for (const want of ["Claude subscription", "ChatGPT subscription", "I have an API key"]) if (!text.includes(want)) failures.push(`AI page has no "${want}" option`);
  // Claude subscription on Windows: it must say plainly what to do, not fail silently
  await page.getByText("Claude subscription", { exact: true }).first().click({ timeout: 5000 }).catch((e) => failures.push(`couldn't pick Claude subscription: ${e.message}`));
  await sleep(1500);
  await shot(page, "ai-claude-picked");
  const go = page.locator("button:visible", { hasText: /^(Continue|Sign in.*)$/ }).first();
  if (await go.count()) {
    console.log(`click "${(await go.innerText()).trim()}"`);
    await go.click({ timeout: 5000 }).catch(() => {});
  }
  await sleep(10_000);
  await shot(page, "ai-claude-after");
  const after = await visibleText(page);
  console.log(`\n=== after Claude subscription\n${after.slice(0, 1500)}`);
  if (/API key/i.test(after) && /Windows|Mac or Linux/i.test(after)) proven.push("after Sign in, Claude subscription still says to use an API key on Windows");
  else console.log("NOTE: no Windows-specific explanation seen after picking Claude subscription (see screenshot)");
} else failures.push(`onboarding never reached the AI page (stuck on "${last}")`);

// 4. this computer joined its hub as a device (the app runs `bubble-ai node start` once signed in)
let joined = null;
for (let i = 0; i < 40 && !joined; i++) {
  joined = await page
    .evaluate(async () => {
      const token = localStorage.getItem("wisp.token");
      const res = await fetch("/api/nodes", { headers: { authorization: `Bearer ${token}` } });
      const nodes = res.ok ? await res.json() : [];
      return nodes.find((d) => d.online) ? nodes.map((d) => ({ name: d.name, online: d.online, os: d.os ?? d.platform })) : null;
    })
    .catch(() => null);
  if (!joined) await sleep(3000);
}
if (joined) {
  console.log(`devices: ${JSON.stringify(joined)}`);
  proven.push("this Windows computer joined its hub as a device (online)");
} else failures.push("no device came online on the hub");

console.log(`\nPROVEN:\n- ${proven.join("\n- ")}`);
if (failures.length) console.log(`FAILED:\n- ${failures.join("\n- ")}`);
await browser.close().catch(() => {});
app.kill();
process.exit(failures.length ? 1 : 0);
