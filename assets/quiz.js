/* ============================================================
   quiz.js — reusable QCM engine for the two simulators.

   Quiz.mount({
     el: '#quiz',                    // container selector
     bank: [...questions],           // {id, theme, q, options[4], answer, explain, sit?, say?, img?}
     themes: [{id, label}],
     storageKey: 'civic',            // history under cr10:qz:<key>
     exam: { size:40, minutes:45, passPct:80, split:{knowledge:28, situational:12} },
     passLabel / failLabel / examNote (optional strings)
   })

   Modes:
   - training: pick themes + count, instant feedback + explanation
   - exam: timed, free navigation, no feedback until submit;
     saved under cr10:qz-run:<key> so a reload can resume it
   ============================================================ */
(function () {
  'use strict';

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function mount(cfg) {
    var root = document.querySelector(cfg.el);
    if (!root) return;
    root.classList.add('quiz-shell');

    var themeLabel = {};
    (cfg.themes || []).forEach(function (t) { themeLabel[t.id] = t.label; });

    var state = null;   // {mode, questions[], answers[], idx, deadline, timerId, playCounts{}}
    var runKey = 'qz-run:' + cfg.storageKey; // exam in progress, survives reloads

    /* ---------------- setup screen ---------------- */
    function renderSetup() {
      stopTimer();
      App.stopSpeech();
      root.innerHTML = '';

      var card = el('div', 'q-card');

      // — exam in progress (saved before a reload / navigation)
      var saved = loadRun();
      if (saved) {
        var left = saved.deadline - Date.now();
        var answered = saved.answers.filter(function (a) { return a !== null; }).length;
        var box = el('div', 'note' + (left > 0 ? '' : ' warn'));
        box.style.marginTop = '0';
        box.appendChild(el('b', null, left > 0 ? '⏸ Examen blanc en cours' : '⏰ Temps écoulé pour votre examen blanc'));
        box.appendChild(el('div', 'small', answered + '/' + saved.questions.length + ' réponses' +
          (left > 0 ? ' · ' + clock(left) + ' restantes — le chrono continue pendant votre absence, comme au vrai examen.' : '.')));
        var rr = el('div', 'pill-row');
        var btnResume = el('button', 'btn small', left > 0 ? 'Reprendre l’examen' : 'Voir le résultat');
        btnResume.addEventListener('click', function () {
          state = saved;
          if (state.deadline <= Date.now()) { finish(); return; }
          startTimer();
          renderQuestion();
        });
        rr.appendChild(btnResume);
        var btnDrop = el('button', 'btn ghost small', 'Abandonner');
        btnDrop.addEventListener('click', function () {
          if (confirm('Abandonner cet examen blanc ? Il ne sera pas enregistré dans l’historique.')) {
            clearRun();
            renderSetup();
          }
        });
        rr.appendChild(btnDrop);
        box.appendChild(rr);
        card.appendChild(box);
      }

      // — exam block
      var exam = cfg.exam;
      card.appendChild(el('div', 'q-theme', 'Mode examen'));
      var h = el('div', 'q-text');
      h.textContent = 'Examen blanc — conditions réelles';
      card.appendChild(h);
      var p = el('p', 'small muted');
      p.textContent = exam.size + ' questions · ' + exam.minutes + ' minutes · réussite à ' +
        exam.passPct + ' % (' + Math.ceil(exam.size * exam.passPct / 100) + '/' + exam.size + ')' +
        (cfg.examNote ? ' · ' + cfg.examNote : '');
      card.appendChild(p);
      var btnExam = el('button', 'btn', 'Démarrer l’examen blanc');
      btnExam.addEventListener('click', function () {
        if (saved && !confirm('Un examen blanc est déjà en cours. Le remplacer par un nouveau ?')) return;
        start('exam');
      });
      card.appendChild(btnExam);

      card.appendChild(el('hr'));

      // — training block
      card.appendChild(el('div', 'q-theme', 'Mode entraînement'));
      var h2 = el('div', 'q-text', 'Entraînement par thème — correction immédiate');
      card.appendChild(h2);

      var pills = el('div', 'pill-row');
      var selected = {};
      (cfg.themes || []).forEach(function (t) {
        selected[t.id] = true;
        var b = el('button', 'btn small', t.label);
        b.type = 'button';
        b.dataset.tid = t.id;
        b.addEventListener('click', function () {
          selected[t.id] = !selected[t.id];
          b.className = selected[t.id] ? 'btn small' : 'btn small outline';
        });
        pills.appendChild(b);
      });
      card.appendChild(pills);

      var row = el('div', 'q-nav');
      var lbl = el('span', 'small muted', 'Nombre de questions : ');
      var sel = document.createElement('select');
      sel.style.cssText = 'padding:.35rem .5rem;border:1px solid var(--border);border-radius:8px;font-size:.9rem';
      [10, 20, 30, 40].forEach(function (n) {
        var o = document.createElement('option');
        o.value = n; o.textContent = n;
        if (n === 20) o.selected = true;
        sel.appendChild(o);
      });
      lbl.appendChild(sel);
      row.appendChild(lbl);
      var spacer = el('span', 'spacer');
      row.appendChild(spacer);
      var btnTrain = el('button', 'btn outline', 'Commencer l’entraînement');
      btnTrain.addEventListener('click', function () {
        var themes = Object.keys(selected).filter(function (k) { return selected[k]; });
        start('training', { themes: themes, count: parseInt(sel.value, 10) });
      });
      row.appendChild(btnTrain);
      card.appendChild(row);

      // — replay errors
      var hist = App.lsGet('qz:' + cfg.storageKey, []);
      var wrongIds = collectWrongIds(hist);
      if (wrongIds.length) {
        card.appendChild(el('hr'));
        var rw = el('div', 'q-nav');
        rw.appendChild(el('span', 'small muted', wrongIds.length + ' question(s) ratée(s) récemment.'));
        rw.appendChild(el('span', 'spacer'));
        var btnErr = el('button', 'btn outline small', 'Rejouer mes erreurs');
        btnErr.addEventListener('click', function () { start('training', { ids: wrongIds }); });
        rw.appendChild(btnErr);
        card.appendChild(rw);
      }

      root.appendChild(card);
      renderHistory();
    }

    function collectWrongIds(hist) {
      var set = {};
      hist.slice(-6).forEach(function (h) {
        (h.wrongIds || []).forEach(function (id) { set[id] = true; });
      });
      return Object.keys(set).filter(function (id) {
        return cfg.bank.some(function (q) { return String(q.id) === String(id); });
      });
    }

    function renderHistory() {
      var hist = App.lsGet('qz:' + cfg.storageKey, []);
      if (!hist.length) return;
      var card = el('div', 'q-card');
      card.style.marginTop = '1rem';
      card.appendChild(el('div', 'q-theme', 'Historique (' + hist.length + ')'));
      var list = el('div', 'history-list');
      hist.slice(-8).reverse().forEach(function (h) {
        var r = el('div', 'h-row');
        var d = new Date(h.ts);
        r.appendChild(el('span', 'muted', d.toLocaleDateString('fr-FR') + ' ' +
          d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })));
        r.appendChild(el('span', h.mode === 'exam' ? 'badge' : 'badge ghost',
          h.mode === 'exam' ? 'Examen' : 'Entraînement'));
        var pass = h.mode === 'exam' ? (h.pct >= cfg.exam.passPct) : null;
        var b = el('span', 'badge ' + (pass === null ? 'ghost' : pass ? 'green' : 'red'),
          h.score + '/' + h.total + ' — ' + h.pct + '%');
        r.appendChild(b);
        list.appendChild(r);
      });
      card.appendChild(list);
      var clr = el('button', 'btn ghost small', 'Effacer l’historique');
      clr.addEventListener('click', function () {
        if (confirm('Effacer tout l’historique de ce simulateur ?')) {
          App.lsSet('qz:' + cfg.storageKey, []);
          renderSetup();
        }
      });
      card.appendChild(clr);
      root.appendChild(card);
    }

    /* ---------------- start a run ---------------- */
    function start(mode, opts) {
      opts = opts || {};
      var pool = cfg.bank;

      if (opts.ids) {
        pool = pool.filter(function (q) { return opts.ids.indexOf(String(q.id)) !== -1; });
      } else if (opts.themes) {
        pool = pool.filter(function (q) { return opts.themes.indexOf(q.theme) !== -1; });
      }
      if (!pool.length) pool = cfg.bank;

      var questions;
      if (mode === 'exam') {
        var split = cfg.exam.split;
        if (split) {
          var know = shuffle(pool.filter(function (q) { return !q.sit; }));
          var sit = shuffle(pool.filter(function (q) { return q.sit; }));
          questions = know.slice(0, split.knowledge).concat(sit.slice(0, split.situational));
          // fill up if a bucket is short
          if (questions.length < cfg.exam.size) {
            var have = {};
            questions.forEach(function (q) { have[q.id] = true; });
            shuffle(pool).forEach(function (q) {
              if (questions.length < cfg.exam.size && !have[q.id]) { questions.push(q); have[q.id] = true; }
            });
          }
          questions = shuffle(questions);
        } else {
          questions = shuffle(pool).slice(0, cfg.exam.size);
        }
      } else {
        questions = shuffle(pool).slice(0, opts.count || opts.ids && opts.ids.length || 20);
      }

      // per-run shuffled options with remapped answer
      questions = questions.map(function (q) {
        return runQuestion(q, shuffle([0, 1, 2, 3].slice(0, q.options.length)));
      });

      state = {
        mode: mode,
        questions: questions,
        answers: new Array(questions.length).fill(null),
        checked: new Array(questions.length).fill(false), // training: feedback shown
        idx: 0,
        playCounts: {},
        timerId: null,
        deadline: mode === 'exam' ? Date.now() + cfg.exam.minutes * 60000 : null
      };

      if (mode === 'exam') startTimer();
      renderQuestion();
    }

    function runQuestion(src, order) {
      return {
        src: src,
        order: order,
        options: order.map(function (i) { return src.options[i]; }),
        answer: order.indexOf(src.answer)
      };
    }

    /* ---------------- exam in progress (survives reloads) ----------------
       Only exam mode is saved: question ids + option order, answers,
       position, listening plays and the absolute deadline (the clock
       keeps running while the page is closed, like the real exam). */
    function saveRun() {
      if (!state || state.mode !== 'exam') return;
      App.lsSet(runKey, {
        deadline: state.deadline,
        idx: state.idx,
        answers: state.answers,
        playCounts: state.playCounts,
        questions: state.questions.map(function (q) { return { id: q.src.id, order: q.order }; })
      });
    }

    function loadRun() {
      var run = App.lsGet(runKey, null);
      if (!run || !run.questions) return null;
      var byId = {};
      cfg.bank.forEach(function (q) { byId[q.id] = q; });
      // the bank may have been edited since — drop a run that no longer matches it
      var valid = run.questions.every(function (r) {
        return byId[r.id] && byId[r.id].options.length === r.order.length;
      });
      if (!valid) { clearRun(); return null; }
      return {
        mode: 'exam',
        questions: run.questions.map(function (r) { return runQuestion(byId[r.id], r.order); }),
        answers: run.answers,
        checked: new Array(run.questions.length).fill(false),
        idx: run.idx,
        playCounts: run.playCounts || {},
        timerId: null,
        deadline: run.deadline
      };
    }

    function clearRun() {
      App.lsSet(runKey, null);
    }

    /* ---------------- timer ---------------- */
    function clock(ms) {
      var m = Math.floor(ms / 60000), s = Math.floor(ms % 60000 / 1000);
      return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function startTimer() {
      stopTimer();
      state.timerId = setInterval(function () {
        var left = state.deadline - Date.now();
        if (left <= 0) { finish(); return; }
        var t = document.getElementById('qz-timer');
        if (t) {
          t.textContent = clock(left);
          t.classList.toggle('low', left < 5 * 60000);
        }
      }, 250);
    }

    function stopTimer() {
      if (state && state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    }

    /* ---------------- question screen ---------------- */
    function renderQuestion() {
      // only cut the audio when moving to another question — answering
      // or re-rendering the same one must not stop a listening in progress
      if (state.renderedIdx !== state.idx) App.stopSpeech();
      state.renderedIdx = state.idx;
      saveRun(); // every answer / navigation goes through here
      root.innerHTML = '';
      var q = state.questions[state.idx];
      var src = q.src;

      // top bar
      var top = el('div', 'quiz-top');
      top.appendChild(el('span', 'badge ghost', 'Question ' + (state.idx + 1) + ' / ' + state.questions.length));
      if (src.sit) top.appendChild(el('span', 'badge gold', 'Mise en situation'));
      if (state.mode === 'exam') {
        var spacer = el('span', 'spacer');
        spacer.style.flex = '1';
        top.appendChild(spacer);
        var timer = el('span', 'quiz-timer');
        timer.id = 'qz-timer';
        timer.textContent = '--:--';
        top.appendChild(timer);
      }
      root.appendChild(top);

      // dots (exam navigation)
      if (state.mode === 'exam') {
        var dots = el('div', 'q-dots');
        state.questions.forEach(function (_, i) {
          var d = el('i');
          if (state.answers[i] !== null) d.classList.add('answered');
          if (i === state.idx) d.classList.add('cur');
          d.title = 'Question ' + (i + 1);
          d.addEventListener('click', function () { state.idx = i; renderQuestion(); });
          dots.appendChild(d);
        });
        root.appendChild(dots);
      }

      var card = el('div', 'q-card');
      card.appendChild(el('div', 'q-theme', themeLabel[src.theme] || src.theme));

      var qt = el('div', 'q-text');
      qt.textContent = src.q;
      card.appendChild(qt);

      // image
      if (src.img) {
        var im = el('div', 'q-img');
        im.innerHTML = src.img; // trusted local SVG
        card.appendChild(im);
      }

      // reading passage (compréhension écrite)
      if (src.ctx) {
        var cx = el('div', 'transcript');
        cx.textContent = src.ctx;
        cx.style.marginBottom = '1rem';
        card.appendChild(cx);
      }

      // audio (listening comprehension)
      if (src.say) {
        var box = el('div', 'audio-box');
        var play = el('button', 'btn small');
        var setPlayLabel = function () {
          var left = Math.max(0, 2 - (state.playCounts[src.id] || 0));
          play.textContent = '🔊 Écouter (' + left + ' écoute' + (left > 1 ? 's' : '') + ' restante' + (left > 1 ? 's' : '') + ')';
          play.disabled = left === 0;
        };
        setPlayLabel();
        play.addEventListener('click', function () {
          state.playCounts[src.id] = (state.playCounts[src.id] || 0) + 1;
          saveRun();
          // update in place: a re-render would wipe the fallback transcript
          setPlayLabel();
          if (!App.speakFrench(src.say)) showTranscript(card, src, true);
        });
        box.appendChild(play);
        box.appendChild(el('span', 'xs muted', 'Comme au vrai TCF : 2 écoutes maximum. Synthèse vocale française du navigateur.'));
        card.appendChild(box);
      }

      // options
      var opts = el('div', 'q-opts');
      var keys = ['A', 'B', 'C', 'D'];
      q.options.forEach(function (optText, i) {
        var b = el('button', 'q-opt');
        b.type = 'button';
        var k = el('span', 'key', keys[i]);
        b.appendChild(k);
        var span = el('span');
        span.textContent = optText;
        b.appendChild(span);

        var answered = state.answers[state.idx];
        var isChecked = state.checked[state.idx];

        if (state.mode === 'exam') {
          if (answered === i) b.classList.add('sel');
          b.addEventListener('click', function () {
            state.answers[state.idx] = i;
            renderQuestion();
          });
        } else {
          // training
          if (isChecked) {
            b.disabled = true;
            if (i === q.answer) b.classList.add('correct');
            else if (i === answered) b.classList.add('wrong');
          } else {
            b.addEventListener('click', function () {
              state.answers[state.idx] = i;
              state.checked[state.idx] = true;
              renderQuestion();
            });
          }
        }
        opts.appendChild(b);
      });
      card.appendChild(opts);

      // training feedback
      if (state.mode === 'training' && state.checked[state.idx]) {
        var good = state.answers[state.idx] === q.answer;
        var ex = el('div', 'q-explain' + (good ? '' : ' was-wrong'));
        var t = el('b', null, good ? '✔ Bonne réponse. ' : '✘ Mauvaise réponse. ');
        ex.appendChild(t);
        ex.appendChild(document.createTextNode(src.explain || ''));
        card.appendChild(ex);
        if (src.say) showTranscript(card, src, false);
      }

      // nav
      var nav = el('div', 'q-nav');
      var quit = el('button', 'btn ghost small', '← Quitter');
      quit.addEventListener('click', function () {
        if (confirm('Quitter ? La session en cours sera perdue.')) {
          if (state.mode === 'exam') clearRun();
          renderSetup();
        }
      });
      nav.appendChild(quit);
      nav.appendChild(el('span', 'spacer'));

      if (state.mode === 'exam') {
        if (state.idx > 0) {
          var prev = el('button', 'btn outline small', '← Précédente');
          prev.addEventListener('click', function () { state.idx--; renderQuestion(); });
          nav.appendChild(prev);
        }
        if (state.idx < state.questions.length - 1) {
          var next = el('button', 'btn small', 'Suivante →');
          next.addEventListener('click', function () { state.idx++; renderQuestion(); });
          nav.appendChild(next);
        }
        var unanswered = state.answers.filter(function (a) { return a === null; }).length;
        var submit = el('button', 'btn danger small', 'Terminer' + (unanswered ? ' (' + unanswered + ' sans réponse)' : ''));
        submit.addEventListener('click', function () {
          if (!unanswered || confirm(unanswered + ' question(s) sans réponse. Terminer quand même ?')) finish();
        });
        nav.appendChild(submit);
      } else {
        if (state.checked[state.idx]) {
          var isLast = state.idx === state.questions.length - 1;
          var nextT = el('button', 'btn small', isLast ? 'Voir le résultat' : 'Question suivante →');
          nextT.addEventListener('click', function () {
            if (isLast) finish();
            else { state.idx++; renderQuestion(); }
          });
          nav.appendChild(nextT);
        }
      }
      card.appendChild(nav);
      root.appendChild(card);
      root.scrollIntoView({ block: 'nearest' });
    }

    function showTranscript(card, src, note) {
      if (card.querySelector('.transcript')) return;
      var tr = el('div', 'transcript');
      tr.textContent = (note ? '(Synthèse vocale indisponible — lisez la transcription) ' : 'Transcription : ') + '« ' + src.say + ' »';
      card.appendChild(tr);
    }

    /* ---------------- results ---------------- */
    function finish() {
      stopTimer();
      App.stopSpeech();
      if (state.mode === 'exam') clearRun();

      var score = 0;
      var byTheme = {};
      var wrongIds = [];
      state.questions.forEach(function (q, i) {
        var tid = q.src.theme;
        byTheme[tid] = byTheme[tid] || { good: 0, total: 0 };
        byTheme[tid].total++;
        if (state.answers[i] === q.answer) { score++; byTheme[tid].good++; }
        else wrongIds.push(String(q.src.id));
      });
      var total = state.questions.length;
      var pct = Math.round(score / total * 100);
      var pass = pct >= cfg.exam.passPct;

      // persist
      var hist = App.lsGet('qz:' + cfg.storageKey, []);
      hist.push({ ts: Date.now(), mode: state.mode, score: score, total: total, pct: pct, wrongIds: wrongIds });
      if (hist.length > 60) hist = hist.slice(-60);
      App.lsSet('qz:' + cfg.storageKey, hist);

      root.innerHTML = '';
      var card = el('div', 'q-card');

      var hero = el('div', 'result-hero');
      var pctEl = el('div', 'pct ' + (pass ? 'pass' : 'fail'), pct + '%');
      hero.appendChild(pctEl);
      hero.appendChild(el('div', 'muted', score + ' bonne' + (score > 1 ? 's' : '') + ' réponse' + (score > 1 ? 's' : '') + ' sur ' + total));
      if (state.mode === 'exam') {
        var verdict = el('div', 'verdict', pass
          ? (cfg.passLabel || '🎉 ADMIS — au-dessus du seuil de ' + cfg.exam.passPct + ' %')
          : (cfg.failLabel || 'Pas encore — il faut ' + cfg.exam.passPct + ' % (' + Math.ceil(total * cfg.exam.passPct / 100) + '/' + total + ')'));
        verdict.style.color = pass ? 'var(--success)' : 'var(--red)';
        hero.appendChild(verdict);
      }
      card.appendChild(hero);

      // per-theme bars
      var bars = el('div', 'theme-bars');
      Object.keys(byTheme).forEach(function (tid) {
        var row = el('div', 'row');
        row.appendChild(el('span', 'lbl', themeLabel[tid] || tid));
        var pr = el('div', 'progress' + (byTheme[tid].good === byTheme[tid].total ? ' green' : ''));
        var bar = el('i');
        bar.style.width = Math.round(byTheme[tid].good / byTheme[tid].total * 100) + '%';
        pr.appendChild(bar);
        row.appendChild(pr);
        row.appendChild(el('span', 'val', byTheme[tid].good + '/' + byTheme[tid].total));
        bars.appendChild(row);
      });
      card.appendChild(bars);

      var nav = el('div', 'q-nav');
      var again = el('button', 'btn', 'Recommencer');
      again.addEventListener('click', renderSetup);
      nav.appendChild(again);
      if (wrongIds.length) {
        var redo = el('button', 'btn outline', 'Revoir mes ' + wrongIds.length + ' erreur' + (wrongIds.length > 1 ? 's' : ''));
        redo.addEventListener('click', function () { start('training', { ids: wrongIds }); });
        nav.appendChild(redo);
      }
      card.appendChild(nav);
      root.appendChild(card);

      // review of wrong answers
      if (wrongIds.length) {
        var rv = el('div');
        rv.appendChild(el('h2', null, 'Correction des erreurs'));
        state.questions.forEach(function (q, i) {
          if (state.answers[i] === q.answer) return;
          var item = el('div', 'review-item');
          item.appendChild(el('div', 'q-theme', themeLabel[q.src.theme] || q.src.theme));
          item.appendChild(el('div', 'rq', q.src.q));
          var ra = el('div', 'ra');
          if (state.answers[i] !== null) {
            var bad = el('span', 'bad-a', q.options[state.answers[i]]);
            ra.appendChild(document.createTextNode('Votre réponse : '));
            ra.appendChild(bad);
            ra.appendChild(document.createElement('br'));
          } else {
            ra.appendChild(document.createTextNode('Sans réponse.'));
            ra.appendChild(document.createElement('br'));
          }
          ra.appendChild(document.createTextNode('Bonne réponse : '));
          ra.appendChild(el('span', 'good-a', q.options[q.answer]));
          item.appendChild(ra);
          if (q.src.explain) {
            var ex = el('div', 'small muted');
            ex.style.marginTop = '0.3rem';
            ex.textContent = '💡 ' + q.src.explain;
            item.appendChild(ex);
          }
          rv.appendChild(item);
        });
        root.appendChild(rv);
      }
      window.scrollTo({ top: root.offsetTop - 80, behavior: 'smooth' });
    }

    renderSetup();
  }

  window.Quiz = { mount: mount };
})();
