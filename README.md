# 🇫🇷 Objectif Carte de Résident 10 ans — Prep Kit

**🌐 Live site: <https://weskhaled.github.io/carte-resident-prep/>**

Personal preparation project for the **March 2027 titre de séjour renewal**, targeting the **carte de résident (10 years)**. Since 1 January 2026, that card requires two exams — this kit prepares both:

1. **Examen civique** — 40 QCM · 45 min · pass at 32/40 (80 %)
2. **French level B1** — proven by TCF IRN or TEF IRN (or a French diploma ≥ B1)

## Quick start

Open [`index.html`](index.html) in any browser — that's it. No build, no dependencies, works offline from `file://`.

Optional local server (nicer URLs):

```sh
cd carte-resident-prep
python3 -m http.server 4630
# → http://localhost:4630
```

## What's inside

| File | What it is |
|---|---|
| `index.html` | Dashboard — countdown to your titre's expiry, current phase + ANEF filing window, both requirements at a glance, your scores, official links |
| `roadmap.html` | The **8-week plan** (interactive checklists, auto-dated weeks, daily routine) + post-exam application checklist |
| `civic-guide.html` | Civic exam rules, registration, **7 fiches de révision** (values, symbols, institutions, rights, history timeline, geography map, daily life), exam-day strategy |
| `civic-simulator.html` | **Mock exam engine** — real format (40 Q = 28 knowledge + 12 situational, 45 min timer, 32/40 pass), training mode by theme, error replay, score history. Bank: 111 questions in French |
| `french-guide.html` | B1 requirement, exemption diplomas, TCF/TEF/DELF comparison, per-skill training plan, grammar checklist, admin vocabulary |
| `french-simulator.html` | QCM (listening via browser speech synthesis · reading · grammar, 52 items) + **writing studio** (3 TCF-style tasks, live word counter, model answers, auto-saved drafts) + **speaking practice** (3 parts, model answers read aloud) |
| `MEMORY.md` | Living memory: verified facts + sources, decisions, status log, next actions — **kept local only** (gitignored, not published) |
| `assets/` | `style.css` (DSFR-inspired design system) · `app.js` (storage, countdown, checklists) · `quiz.js` (exam engine) · `data/*.js` (question banks) · `validate.mjs` (data sanity check) |

## How progress is stored

Everything lives in your browser's `localStorage` under the `cr10:` prefix (roadmap checkboxes, quiz history, writing drafts, goal/start dates). Clearing site data resets it. Nothing leaves your machine.

## Editing the question banks

Questions live in `assets/data/civic-data.js` and `assets/data/french-data.js`.
Convention: **`options[0]` is always the correct answer** (`answer: 0`) — the engine shuffles options at display time. Flags: `sit: true` = mise en situation (civic), `say:` = read aloud (listening), `ctx:` = reading passage, `img:` = inline SVG.

After editing, sanity-check with:

```sh
node assets/validate.mjs
```

## Disclaimer

Unofficial personal study tool. Facts were verified against official sources (service-public.gouv.fr, formation-civique.interieur.gouv.fr, france-education-international.fr) in **July 2026** — always confirm formats, prices and your personal situation (exemptions, bilateral agreements) on the official pages or with your préfecture before booking or filing.
