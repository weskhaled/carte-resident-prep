/* Sanity-check the question banks. Run: node assets/validate.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const window = {};
for (const f of ['data/civic-data.js', 'data/french-data.js']) {
  vm.runInNewContext(readFileSync(join(here, f), 'utf8'), { window });
}

let errors = 0;
const fail = (msg) => { errors++; console.error('✘', msg); };

function checkBank(name, bank, themes, opts = {}) {
  const themeIds = new Set(themes.map((t) => t.id));
  const ids = new Set();
  for (const q of bank) {
    const tag = `${name}/${q.id}`;
    if (!q.id) fail(`${name}: question without id`);
    if (ids.has(q.id)) fail(`${tag}: duplicate id`);
    ids.add(q.id);
    if (!themeIds.has(q.theme)) fail(`${tag}: unknown theme "${q.theme}"`);
    if (!q.q || q.q.length < 8) fail(`${tag}: missing/short question text`);
    if (!Array.isArray(q.options) || q.options.length !== 4) fail(`${tag}: needs exactly 4 options`);
    if (new Set(q.options).size !== q.options.length) fail(`${tag}: duplicate options`);
    if (q.answer !== 0) fail(`${tag}: convention is answer: 0 (correct option first)`);
    if (!q.explain) fail(`${tag}: missing explanation`);
    if (q.img && !/^\s*<svg/.test(q.img)) fail(`${tag}: img must be inline SVG`);
  }
  const byTheme = {};
  for (const q of bank) byTheme[q.theme] = (byTheme[q.theme] || 0) + 1;
  const sit = bank.filter((q) => q.sit).length;
  console.log(`✔ ${name}: ${bank.length} questions`, byTheme, sit ? `(${sit} situational)` : '');
  if (opts.minSit && sit < opts.minSit) fail(`${name}: exam needs ≥ ${opts.minSit} situational questions, found ${sit}`);
  if (opts.minKnow && bank.length - sit < opts.minKnow) fail(`${name}: exam needs ≥ ${opts.minKnow} knowledge questions`);
}

checkBank('civic', window.CIVIC_QUESTIONS, window.CIVIC_THEMES, { minSit: 12, minKnow: 28 });
checkBank('french', window.FRENCH_QUESTIONS, window.FRENCH_THEMES);

for (const t of window.FRENCH_EE_TASKS) {
  if (!t.prompt || !t.model || !t.min || !t.max) fail(`ee/${t.id}: incomplete task`);
}
console.log(`✔ EE tasks: ${window.FRENCH_EE_TASKS.length}`);
for (const p of window.FRENCH_EO_PARTS) {
  if (!p.desc || !p.model || !p.questions?.length) fail(`eo/${p.id}: incomplete part`);
}
console.log(`✔ EO parts: ${window.FRENCH_EO_PARTS.length}`);

const co = window.FRENCH_QUESTIONS.filter((q) => q.say).length;
const ce = window.FRENCH_QUESTIONS.filter((q) => q.ctx).length;
console.log(`✔ french extras: ${co} listening (say), ${ce} reading (ctx)`);

if (errors) { console.error(`\n${errors} problem(s) found.`); process.exit(1); }
console.log('\nAll good ✅');
