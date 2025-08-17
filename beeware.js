// beeware.js — BeeReaders Auto (bookmarklet)
// © Tú. Úsalo solo donde tengas permiso. Funciona en student.beereaders.com

(() => {
  if (window.__BeeWare) { console.log('[BeeWare] ya cargado'); return; }
  const BeeWare = window.__BeeWare = { version: '2.3' };

  /* ========== utils ========== */
  const vis = el => !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
  const $all = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const $one = (sel, root=document) => root.querySelector(sel);
  const clean = s => (s||'')
    .replace(/[\u00A0]/g,' ')         // nbsp
    .replace(/\s+/g,' ')              // colapsa espacios
    .replace(/[“”«»]/g,'"')
    .replace(/[‘’]/g,"'")
    .trim();
  const norm = s => clean(s).toLowerCase();

  const contains = (a,b) => norm(a).includes(norm(b));
  const sim = (a,b) => {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    // score simple por intersección de tokens
    const A = new Set(a.split(/\W+/).filter(Boolean));
    const B = new Set(b.split(/\W+/).filter(Boolean));
    const inter = [...A].filter(x => B.has(x)).length;
    return inter / Math.max(1, Math.min(A.size, B.size));
  };

  const sleep = ms => new Promise(r=>setTimeout(r,ms));

  /* ========== claves de estado/DB ========== */
  const KEY_DB      = 'beeware-db-v2';       // { [title]: { [question]: answer } }
  const KEY_RUN     = 'beeware-run';
  const KEY_LEARN   = 'beeware-learn';
  const KEY_LOOP    = 'beeware-loop';
  const KEY_TARGET  = 'beeware-target-title';

  /* ========== DB local ========== */
  const loadDB = () => {
    try { return JSON.parse(localStorage.getItem(KEY_DB)||'{}'); }
    catch { return {}; }
  };
  const saveDB = db => localStorage.setItem(KEY_DB, JSON.stringify(db));
  let DB = loadDB();

  /* ========== Overlay UI (tu look & feel) ========== */
  const css = `
  .bw-box{position:fixed;top:16px;right:16px;z-index:999999;font:12px/1.2 system-ui,Segoe UI,Roboto,Arial}
  .bw-card{background:#101114cc;color:#eee;border:1px solid #2c2f36;border-radius:10px;padding:10px 12px;box-shadow:0 8px 24px #0007;backdrop-filter:saturate(1.5) blur(6px)}
  .bw-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .bw-btn{cursor:pointer;border:1px solid #3a3f48;border-radius:8px;padding:6px 10px;background:#1a1d23;color:#eaeaea}
  .bw-btn:hover{background:#242935}
  .bw-badge{padding:2px 6px;border-radius:6px;background:#2e3441;font-weight:600}
  .bw-sep{height:1px;background:#2c2f36;margin:8px 0}
  .bw-small{opacity:.75}
  `;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'bw-box';
  box.innerHTML = `
    <div class="bw-card">
      <div class="bw-row" style="margin-bottom:6px">
        <div><b>🐝 BeeWare</b> <span class="bw-small">v${BeeWare.version}</span></div>
        <span class="bw-badge" id="bwState">OFF</span>
      </div>
      <div class="bw-row">
        <button class="bw-btn" id="bwAuto">Auto</button>
        <button class="bw-btn" id="bwLearn">Aprender</button>
        <button class="bw-btn" id="bwSolve">Resolver ahora</button>
      </div>
      <div class="bw-sep"></div>
      <div class="bw-row">
        <button class="bw-btn" id="bwImport">Importar DB</button>
        <button class="bw-btn" id="bwExport">Exportar DB</button>
        <button class="bw-btn" id="bwClear">Borrar DB</button>
      </div>
      <div class="bw-sep"></div>
      <div class="bw-row">
        <button class="bw-btn" id="bwLoop">Loop</button>
        <button class="bw-btn" id="bwBack">Atrás</button>
        <span class="bw-small" id="bwHint">Ctrl+Alt+S start • Ctrl+Alt+X stop</span>
      </div>
    </div>`;
  document.body.appendChild(box);

  const $ = id => box.querySelector('#'+id);
  const setBadge = on => $('#bwState').textContent = on ? 'AUTO' : 'OFF';

  /* ========== heurísticas para título/pregunta/opciones (mejoradas) ========== */

  function getChallengeTitle() {
    const el = document.querySelector('[data-cy="mainContainer-title"], .challenge-title, h1');
    return clean(el?.textContent || '');
  }

  function findOptions() {
    // 1) botones/ítems visibles que parecen opciones (evita "Siguiente pregunta")
    let cands = $all('button,[role="button"],.v-btn,.q-btn,.v-list-item,.option,.answer,.choice,.selectable')
      .filter(el => vis(el))
      .filter(el => {
        const t = norm(el.textContent);
        if (!t) return false;
        if (/siguiente|comprobar|enviar|continuar|next|check|submit|comenzar|preguntas|ir a las preguntas/.test(t)) return false;
        return true;
      });

    // agrupamos por padre; elegimos un contenedor con 3..6 items
    const groups = new Map();
    for (const el of cands) {
      const p = el.parentElement;
      if (!p) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(el);
    }
    const arr = [...groups.values()].sort((a,b)=>Math.abs(4-a.length)-Math.abs(4-b.length));
    const first = arr.find(g => g.length>=2) || [];
    return (first.length ? first : cands.slice(0,6)).map(el=>({el,text:clean(el.innerText||el.textContent||'')})).filter(o=>o.text);
  }

  function findQuestionNear(options) {
    if (!options.length) return null;
    const top = Math.min(...options.map(o => o.el.getBoundingClientRect().top));
    // contenedor oficial si existe
    const cy = $one('[data-cy="challenge-content-container"]');
    if (cy && vis(cy)) {
      const tx = clean(cy.textContent);
      if (tx.length > 6) return tx;
    }
    // fallback: último bloque de texto sobre las opciones
    const all = $all('h1,h2,h3,h4,.text-h1,.text-h2,.text-h3,.text-h4,.question,.v-card__text, p, div')
      .filter(e => vis(e) && e.getBoundingClientRect().bottom < top - 6)
      .filter(e => clean(e.textContent).length > 6);
    const last = all.slice(-1)[0];
    return last ? clean(last.textContent) : '';
  }

  function getQA() {
    const challengeTitle = getChallengeTitle();
    const options = findOptions();
    const question = findQuestionNear(options) || '';
    return { challengeTitle, question, options };
  }

  /* ========== resolver (usa DB por título+pregunta) ========== */
  let RUN = localStorage.getItem(KEY_RUN) === '1';
  let LEARN = localStorage.getItem(KEY_LEARN) === '1';
  let LOOP = localStorage.getItem(KEY_LOOP) === '1';
  let targetTitle = localStorage.getItem(KEY_TARGET) || null;

  setBadge(RUN);

  function clickOptionByText(text, options) {
    const target = norm(text);
    // mejor coincidencia por similitud
    let best = null, bestScore = 0;
    for (const o of options) {
      const sc = Math.max(
        sim(o.text, text),
        contains(o.text, text) ? 0.95 : 0
      );
      if (sc > bestScore) { bestScore = sc; best = o; }
    }
    if (best && bestScore >= 0.55) {
      best.el.click();
      return true;
    }
    // fallback: incluye estricta
    const inc = options.find(o => contains(o.text, text));
    if (inc) { inc.el.click(); return true; }
    return false;
  }

  function nextButtonsClick() {
    const btns = $all('button,[role="button"],.v-btn,.q-btn').filter(vis);
    const next = btns.find(b => /siguiente|comprobar|enviar|check|submit|continuar/i.test(b.textContent||''));
    if (next) next.click();
  }

  function retryIfEnd() {
    const btns = $all('button,[role="button"],.v-btn,.q-btn,a').filter(vis);
    const retry = btns.find(b => /(reintentar|intentar|comenzar|empezar)/i.test(b.textContent||''));
    if (retry) { retry.click(); return true; }
    return false;
  }

  function enterQuestionsIfPossible() {
    // Cuando estamos en la lectura: “Ir a las preguntas” / “Comenzar desafío”
    const btn = $all('button,[role="button"],.v-btn').filter(vis)
      .find(b => /ir a las preguntas|comenzar desafío|empezar|iniciar|continuar/i.test((b.textContent||'')));
    if (btn) { btn.click(); return true; }
    return false;
  }

  function solveOnce() {
    const { challengeTitle, question, options } = getQA();
    if (!options.length) return false;

    const tKey = norm(challengeTitle);
    const qKey = norm(question);

    // si no hay título/pregunta, no forzamos
    if (!tKey || !qKey) return false;

    DB[tKey] = DB[tKey] || {};
    const ans = DB[tKey][qKey];

    if (ans) {
      const ok = clickOptionByText(ans, options);
      setTimeout(nextButtonsClick, 150);
      return ok;
    } else if (LEARN) {
      // modo aprender: al primer click del usuario, guardamos
      for (const o of options) {
        o.el.addEventListener('click', () => {
          DB[tKey][qKey] = o.text;
          saveDB(DB);
          console.log('[BeeWare] Aprendido:', `[${tKey}] ${qKey}`, '→', o.text);
        }, { once: true, capture: true });
      }
    }

    return false;
  }

  /* ========== LOOP del mismo desafío (persistente) ========== */

  function captureTarget() {
    const t = getChallengeTitle();
    if (t) {
      targetTitle = t;
      localStorage.setItem(KEY_TARGET, t);
      console.log('[BeeWare] Objetivo:', t);
    }
  }

  function goBack() {
    const back = document.querySelector('[data-cy="challenge-back"], .mdi-arrow-left, button[aria-label*="atrás" i], button[aria-label*="volver" i]');
    if (back) { back.click(); return true; }
    history.back();
    return true;
  }

  function openSameChallenge() {
    if (!targetTitle) return false;

    // 1) Tarjeta/lista de desafíos
    const cards = $all('[data-cy="challenge-card"], .challenge-card, .v-card, article, a, div').filter(vis);
    const card = cards.find(c => contains(c.textContent||'', targetTitle));
    if (card) {
      const clicky = card.querySelector('a,button,[role="button"]') || card;
      clicky.click();
      return true;
    }

    // 2) Si ya estamos dentro, intenta ir a preguntas
    if (enterQuestionsIfPossible()) return true;

    return false;
  }

  async function tick() {
    if (!RUN) return;

    if (retryIfEnd()) { await sleep(400); if (LOOP) captureTarget(); return; }

    // resolver esta pregunta
    solveOnce();

    // si estamos en lista y hay loop activo, intenta reabrir el mismo
    if (LOOP) {
      const inChallenge = !!document.querySelector('[data-cy="mainContainer-title"], .challenge-title');
      if (inChallenge) {
        if (!targetTitle) captureTarget();
      } else {
        openSameChallenge();
      }
    }
  }

  /* ========== wiring UI ========== */
  $('#bwAuto').onclick = () => {
    RUN = !RUN; setBadge(RUN);
    localStorage.setItem(KEY_RUN, RUN ? '1':'0');
    if (RUN) {
      captureTarget();
      BeeWare.intv = setInterval(tick, 800);
    } else {
      clearInterval(BeeWare.intv);
    }
  };
  $('#bwLearn').onclick = () => {
    LEARN = !LEARN;
    localStorage.setItem(KEY_LEARN, LEARN ? '1':'0');
    alert('Modo aprender: '+(LEARN?'ON':'OFF'));
  };
  $('#bwSolve').onclick = () => { solveOnce() || alert('No se detectó pregunta/opciones'); };

  $('#bwImport').onclick = async () => {
    const txt = prompt('Pega tu JSON ({"título":{"pregunta":"respuesta"}, ...})');
    if (!txt) return;
    try {
      const imp = JSON.parse(txt);
      Object.keys(imp).forEach(t=>{
        DB[t] = DB[t] || {};
        Object.assign(DB[t], imp[t]);
      });
      saveDB(DB);
      alert('DB importada ('+Object.keys(imp).length+' títulos)');
    }
    catch(e){ alert('JSON inválido: '+e); }
  };

  $('#bwExport').onclick = () => {
    const blob = new Blob([JSON.stringify(DB,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'),{href:url,download:'beeware-db.json'}); a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  };

  $('#bwClear').onclick = () => { if (confirm('¿Borrar DB local?')) { DB={}; saveDB(DB);} };

  $('#bwLoop').onclick = () => {
    LOOP = !LOOP;
    localStorage.setItem(KEY_LOOP, LOOP ? '1':'0');
    alert('Loop: '+(LOOP?'ON':'OFF')+'\n(Recordará el mismo desafío y lo reabrirá cuando vea la lista)');
    if (LOOP) captureTarget();
  };

  $('#bwBack').onclick = goBack;

  // atajos
  window.addEventListener('keydown', e=>{
    if (!(e.ctrlKey && e.altKey)) return;
    const k = e.key.toLowerCase();
    if (k === 's') { $('#bwAuto').click(); e.preventDefault(); }
    if (k === 'x') { RUN=false; localStorage.setItem(KEY_RUN,'0'); clearInterval(BeeWare.intv); setBadge(false); e.preventDefault(); }
  },true);

  // reactivar estados persistidos
  if (RUN) { setBadge(true); BeeWare.intv = setInterval(tick, 800); }
  console.log('%cBeeWare listo.','color:#7ad; font-weight:700');
})();
