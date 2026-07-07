/* ============================================================
   app.js — shared helpers: storage, countdown, roadmap
   checklist persistence, dashboard aggregation, TTS.
   Plain JS, no deps. Works from file:// or any static server.
   ============================================================ */
(function () {
  'use strict';

  var NS = 'cr10:'; // localStorage namespace

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch (e) { /* private mode: ignore */ }
  }

  /* ---------- active nav ---------- */
  function markNav() {
    var here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav.main a').forEach(function (a) {
      var target = a.getAttribute('href').split('/').pop();
      if (target === here) a.classList.add('active');
    });
  }

  /* ---------- countdown to goal date ---------- */
  function initCountdown() {
    var box = document.getElementById('countdown');
    if (!box) return;
    var input = document.getElementById('goal-date');
    var goal = lsGet('goalDate', '2027-03-01');
    if (input) {
      input.value = goal;
      input.addEventListener('change', function () {
        if (!input.value) return;
        lsSet('goalDate', input.value);
        render();
      });
    }

    function render() {
      var g = input && input.value ? input.value : goal;
      var target = new Date(g + 'T00:00:00');
      var now = new Date();
      var ms = target - now;
      var days = Math.max(0, Math.floor(ms / 86400000));
      var weeks = Math.floor(days / 7);
      var months = Math.max(0, Math.round(days / 30.44 * 10) / 10);
      box.innerHTML =
        unit(days, 'jours') + unit(weeks, 'semaines') + unit(months, 'mois');
    }

    function unit(n, u) {
      return '<div class="unit"><div class="n">' + n + '</div><div class="u">' + u + '</div></div>';
    }

    render();
  }

  /* ---------- generic persisted checklists ----------
     Any <ul class="checklist" data-store="KEY"> with
     <li><input type="checkbox" id="UNIQUE"><label for="UNIQUE">…</label></li>
     is persisted automatically. */
  function initChecklists() {
    document.querySelectorAll('ul.checklist[data-store]').forEach(function (ul) {
      var key = 'chk:' + ul.dataset.store;
      var state = lsGet(key, {});
      ul.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
        if (state[cb.id]) cb.checked = true;
        toggleClass(cb);
        cb.addEventListener('change', function () {
          state[cb.id] = cb.checked;
          lsSet(key, state);
          toggleClass(cb);
          updateAllProgress();
        });
      });
    });
    updateAllProgress();

    function toggleClass(cb) {
      var li = cb.closest('li');
      if (li) li.classList.toggle('done', cb.checked);
    }
  }

  /* every element with data-progress-of="storePrefix" shows the
     completion % of all checklists whose store starts with that prefix */
  function updateAllProgress() {
    document.querySelectorAll('[data-progress-of]').forEach(function (el) {
      var prefix = el.dataset.progressOf;
      var total = 0, done = 0;
      document.querySelectorAll('ul.checklist[data-store]').forEach(function (ul) {
        if (ul.dataset.store.indexOf(prefix) !== 0) return;
        ul.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
          total++;
          if (cb.checked) done++;
        });
      });
      if (total === 0) {
        // page without the checklists (e.g. dashboard) → read the summary
        // persisted by the page that owns them (e.g. roadmap.html)
        var saved = lsGet('sum:' + prefix, null);
        if (saved) { done = saved.done; total = saved.total; }
      } else {
        lsSet('sum:' + prefix, { done: done, total: total });
      }
      var pct = total ? Math.round(done / total * 100) : 0;
      el.querySelectorAll('.progress > i').forEach(function (bar) { bar.style.width = pct + '%'; });
      el.querySelectorAll('.pct-val').forEach(function (v) { v.textContent = pct + '%'; });
      el.querySelectorAll('.pct-count').forEach(function (v) { v.textContent = done + '/' + total; });
    });
    // per-week percentages on the roadmap
    document.querySelectorAll('details.week').forEach(function (wk) {
      var boxes = wk.querySelectorAll('input[type="checkbox"]');
      if (!boxes.length) return;
      var done = 0;
      boxes.forEach(function (cb) { if (cb.checked) done++; });
      var pctEl = wk.querySelector('.w-pct');
      if (pctEl) pctEl.textContent = Math.round(done / boxes.length * 100) + '%';
      wk.classList.toggle('past', done === boxes.length);
    });
  }

  /* ---------- roadmap week highlighting ---------- */
  function initRoadmap() {
    var host = document.getElementById('roadmap-weeks');
    if (!host) return;
    var startInput = document.getElementById('plan-start');
    var start = lsGet('planStart', '2026-07-13');
    if (startInput) {
      startInput.value = start;
      startInput.addEventListener('change', function () {
        if (!startInput.value) return;
        lsSet('planStart', startInput.value);
        applyDates();
      });
    }

    function applyDates() {
      var s = startInput && startInput.value ? startInput.value : start;
      var d0 = new Date(s + 'T00:00:00');
      var now = new Date();
      var fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
      document.querySelectorAll('details.week').forEach(function (wk, i) {
        var from = new Date(d0.getTime() + i * 7 * 86400000);
        var to = new Date(from.getTime() + 6 * 86400000);
        var dates = wk.querySelector('.w-dates');
        if (dates) dates.textContent = fmt.format(from) + ' → ' + fmt.format(to);
        var isCurrent = now >= from && now <= new Date(to.getTime() + 86399000);
        wk.classList.toggle('current', isCurrent);
        if (isCurrent && !wk.dataset.autoOpened) {
          wk.open = true;
          wk.dataset.autoOpened = '1';
        }
      });
    }

    applyDates();
  }

  /* ---------- dashboard: pull quiz history ---------- */
  function initDashboard() {
    ['civic', 'french'].forEach(function (key) {
      var el = document.getElementById('stat-' + key);
      if (!el) return;
      var hist = lsGet('qz:' + key, []);
      var best = null, last = null;
      hist.forEach(function (h) {
        if (h.mode !== 'exam') return;
        last = h;
        if (!best || h.pct > best.pct) best = h;
      });
      var lastAny = hist.length ? hist[hist.length - 1] : null;
      if (!hist.length) {
        el.innerHTML = '<span class="muted">Aucun essai pour l’instant — lance une simulation.</span>';
        return;
      }
      var html = '';
      if (best) {
        var cls = best.pct >= (key === 'civic' ? 80 : 65) ? 'green' : 'warn';
        html += '<span class="badge ' + cls + '">Meilleur examen blanc : ' + best.pct + '%</span> ';
      }
      if (lastAny) {
        html += '<span class="badge ghost">Dernier essai : ' + lastAny.score + '/' + lastAny.total +
          ' (' + lastAny.pct + '%)</span> ';
      }
      html += '<span class="badge ghost">' + hist.length + ' essai' + (hist.length > 1 ? 's' : '') + '</span>';
      el.innerHTML = html;
    });
  }

  /* ---------- text-to-speech (French) ---------- */
  var frVoice = null;

  function pickVoice() {
    if (!('speechSynthesis' in window)) return null;
    var voices = speechSynthesis.getVoices();
    if (!voices.length) return null;
    frVoice =
      voices.find(function (v) { return /^fr[-_]FR/i.test(v.lang) && /google|thomas|amelie|audrey|siri/i.test(v.name); }) ||
      voices.find(function (v) { return /^fr[-_]FR/i.test(v.lang); }) ||
      voices.find(function (v) { return /^fr/i.test(v.lang); }) ||
      null;
    return frVoice;
  }

  function speakFrench(text, opts) {
    opts = opts || {};
    if (!('speechSynthesis' in window)) {
      if (opts.onUnavailable) opts.onUnavailable();
      return false;
    }
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    var v = frVoice || pickVoice();
    if (v) u.voice = v;
    u.lang = 'fr-FR';
    u.rate = opts.rate || 0.92;
    u.pitch = 1;
    if (opts.onEnd) u.onend = opts.onEnd;
    speechSynthesis.speak(u);
    return true;
  }

  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = pickVoice;
    pickVoice();
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    markNav();
    initCountdown();
    initChecklists();
    initRoadmap();
    initDashboard();
  });

  /* public surface */
  window.App = {
    lsGet: lsGet,
    lsSet: lsSet,
    speakFrench: speakFrench,
    stopSpeech: function () { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
    refreshProgress: updateAllProgress
  };
})();
