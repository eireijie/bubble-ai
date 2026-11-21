// Drives a freshly installed Wisp.exe through first-run setup (Self-Host) until the hub's
// "Create your account" page shows, taking a screenshot at every step. Used by windows-smoke.yml.
//   node drive.mjs <path to Wisp.exe> <screenshot folder>
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [exe, shots] = process.argv.slice(2);
fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9333;

const app = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: "inherit" });
let exited = null;
app.on("exit", (code) => {
  exited = code;
  console.log(`Wisp.exe exited with ${code}`);
});

let browser;
for (let i = 0; i < 90 && !browser && exited === null; i++) {
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  } catch {
    await sleep(1000);
  }
}
if (!browser) throw new Error("Couldn't attach to Wisp.exe's window (it never opened a debugging port)");
console.log("attached to Wisp.exe");

const STEPS = ['[data-q="on"][data-v="yes"]', "#pick-create", "#welcome-go", "#create-go", "#ready-go"];
const clicked = new Set();
let n = 0;
const until = Date.now() + 5 * 60_000;
while (Date.now() < until) {
  if (exited !== null) throw new Error(`Wisp.exe quit during setup (exit ${exited})`);
  const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => !p.url().startsWith("devtools:"));
  for (const page of pages) {
    const url = page.url();
    try {
      if (/^http:\/\/(localhost|127\.0\.0\.1):4747/.test(url)) {
        const body = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
        if (/Create your account/i.test(body)) {
          await page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, "0")}-create-account.png`) });
          console.log(`PASS: first-run setup reached "Create your account" at ${url}`);
          await browser.close().catch(() => {});
          app.kill();
          process.exit(0);
        }
        continue;
      }
      for (const sel of STEPS) {
        if (clicked.has(sel)) continue;
        const el = page.locator(sel).first();
        if (await el.isVisible().catch(() => false)) {
          await page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, "0")}-before-${sel.replace(/\W+/g, "_")}.png`) }).catch(() => {});
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
for (const page of browser.contexts().flatMap((c) => c.pages())) {
  console.log(`page left at ${page.url()}`);
  await page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, "0")}-timeout.png`) }).catch(() => {});
  console.log((await page.locator("body").innerText().catch(() => "")).slice(0, 2000));
}
app.kill();
throw new Error('Timed out before "Create your account"');
