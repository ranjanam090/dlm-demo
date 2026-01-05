
/* Dynamic Load Management Demo (50 kW granularity)
 * Author: Clean-room implementation for marketing/demo use
 */

const MODULE_KW = 50;
const MAX_MODULES = 8;           // 8 * 50 kW = 400 kW site capacity
const MAX_SITE_KW = MAX_MODULES * MODULE_KW;
const STALL_COUNT = 6;

const state = {
  peakShave: false,
  modulesTotal: MAX_MODULES,
  modulesFree: MAX_MODULES,
  stalls: [], // { id, connected, requestKw, allocKw, priority (1..5) }
};

const els = {
  addEv: document.getElementById('addEv'),
  removeEv: document.getElementById('removeEv'),
  randomize: document.getElementById('randomize'),
  peakShave: document.getElementById('peakShave'),
  stage: document.getElementById('stage'),
  stalls: document.getElementById('stalls'),
  moduleStack: document.getElementById('moduleStack'),
  tokensLayer: document.getElementById('tokensLayer'),
  poolKw: document.getElementById('poolKw'),
  summaryBody: document.getElementById('summaryBody'),
};

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; // MDN: prefers-reduced-motion [3](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)

/** Utility **/
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/** Initialize stalls UI **/
function init() {
  // Create empty stalls
  for (let i=0; i<STALL_COUNT; i++) {
    state.stalls.push({
      id: i+1,
      connected: false,
      requestKw: 0,
      allocKw: 0,
      priority: 3
    });
  }
  renderStalls();
  renderPoolModules();
  updateSummary();

  // Wire controls
  els.addEv.addEventListener('click', handleAddEv);
  els.removeEv.addEventListener('click', handleRemoveEv);
  els.randomize.addEventListener('click', () => randomizeRequests());
  els.peakShave.addEventListener('change', (e) => {
    state.peakShave = e.target.checked;
    allocateAndAnimate();
  });

  // Pause when off-screen using IntersectionObserver (MDN) [5](https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver)
  const io = new IntersectionObserver((entries) => {
    const visible = entries[0].isIntersecting;
    document.body.dataset.paused = visible ? 'false' : 'true';
  }, { threshold: 0.05 });
  io.observe(els.stage);
}

function renderStalls() {
  els.stalls.innerHTML = '';
  state.stalls.forEach(stall => {
    const card = document.createElement('article');
    card.className = 'stall';
    card.dataset.stallId = stall.id;

    card.innerHTML = `
      <h3>
        Stall ${stall.id}
        <span class="tag">${stall.connected ? 'Connected' : 'Idle'}</span>
      </h3>

      <div class="meter" aria-label="Allocated power">
        <div class="bar" id="bar-${stall.id}" style="width:0%"></div>
      </div>

      <div class="meta">
        <div><strong>Request:</strong> <span id="req-${stall.id}">${stall.requestKw}</span> kW</div>
        <div><strong>Allocated:</strong> <span id="alloc-${stall.id}">${stall.allocKw}</span> kW</div>
      </div>

      <div class="priority">
        <label for="prio-${stall.id}">Priority</label>
        <input type="range" min="1" max="5" value="${stall.priority}" id="prio-${stall.id}" />
      </div>

      <div class="controls-row">
        <button class="btn" id="plug-${stall.id}">${stall.connected ? 'Unplug' : 'Plug in'}</button>
        <button class="btn btn-outline" id="set-${stall.id}">Set request</button>
      </div>
    `;

    // Attach events
    card.querySelector(`#plug-${stall.id}`).addEventListener('click', () => togglePlug(stall.id));
    card.querySelector(`#set-${stall.id}`).addEventListener('click', () => promptRequest(stall.id));
    card.querySelector(`#prio-${stall.id}`).addEventListener('input', (e) => {
      stall.priority = Number(e.target.value);
      allocateAndAnimate();
    });

    els.stalls.appendChild(card);
  });
  updateRemoveEvButton();
}

function renderPoolModules() {
  els.moduleStack.innerHTML = '';
  const total = state.modulesTotal;
  const free = state.modulesFree;
  for (let i=0; i<total; i++){
    const cell = document.createElement('div');
    cell.className = 'stack-cell';
    cell.style.minHeight = '20px';
    const mod = document.createElement('div');
    mod.className = 'module-chip';
    if (i >= free) {
      // occupied -> dim (allocated)
      mod.style.opacity = .25;
      mod.style.filter = 'grayscale(1)';
    }
    cell.appendChild(mod);
    els.moduleStack.appendChild(cell);
  }
  const siteKw = (state.peakShave ? 300 : MAX_SITE_KW);
  els.poolKw.textContent = `${siteKw} kW total`;
}

/** Interactions **/
function handleAddEv() {
  const empty = state.stalls.find(s => !s.connected);
  if (!empty) return;
  empty.connected = true;
  empty.requestKw = MODULE_KW * rand(1, 6); // 50..300 kW
  document.querySelector(`[data-stall-id="${empty.id}"] .tag`).textContent = 'Connected';
  document.getElementById(`req-${empty.id}`).textContent = empty.requestKw;
  updateRemoveEvButton();
  allocateAndAnimate();
}

function handleRemoveEv() {
  const connected = state.stalls.filter(s => s.connected);
  const last = connected[connected.length - 1];
  if (!last) return;
  last.connected = false;
  last.requestKw = 0;
  last.priority = 3;
  // Any allocated modules will be returned during re-allocation
  document.querySelector(`[data-stall-id="${last.id}"] .tag`).textContent = 'Idle';
  document.getElementById(`req-${last.id}`).textContent = 0;
  updateRemoveEvButton();
  allocateAndAnimate();
}

function updateRemoveEvButton() {
  const any = state.stalls.some(s => s.connected);
  els.removeEv.setAttribute('aria-disabled', any ? 'false' : 'true');
}

function randomizeRequests() {
  state.stalls.forEach(s => {
    if (s.connected) s.requestKw = MODULE_KW * rand(1, 6);
    document.getElementById(`req-${s.id}`).textContent = s.requestKw;
  });
  allocateAndAnimate();
}

function togglePlug(id) {
  const s = state.stalls.find(x => x.id === id);
  if (!s) return;
  s.connected = !s.connected;
  s.requestKw = s.connected ? MODULE_KW * rand(1, 6) : 0;
  document.querySelector(`[data-stall-id="${s.id}"] .tag`).textContent = s.connected ? 'Connected' : 'Idle';
  document.getElementById(`req-${s.id}`).textContent = s.requestKw;
  allocateAndAnimate();
}

function promptRequest(id) {
  const s = state.stalls.find(x => x.id === id);
  if (!s) return;
  const val = window.prompt('Enter request in kW (50-300 in steps of 50):', s.requestKw || 100);
  if (val === null) return;
  let req = Math.round(Number(val) / MODULE_KW) * MODULE_KW;
  req = clamp(req, 0, 300);
  s.requestKw = req;
  s.connected = s.requestKw > 0;
  document.querySelector(`[data-stall-id="${s.id}"] .tag`).textContent = s.connected ? 'Connected' : 'Idle';
  document.getElementById(`req-${s.id}`).textContent = s.requestKw;
  allocateAndAnimate();
}

/** Allocation algorithm (50 kW steps, priority-aware, greedy round-robin) **/
function allocate() {
  // Determine available modules
  const siteLimitKw = state.peakShave ? 300 : MAX_SITE_KW;
  const siteModules = Math.floor(siteLimitKw / MODULE_KW);
  const connected = state.stalls.filter(s => s.connected);
  // compute desired modules and priority
  connected.forEach(s => {
    s.desiredModules = Math.min(Math.floor(s.requestKw / MODULE_KW), siteModules);
  });

  // sort by priority desc then stall id
  const sorted = [...connected].sort((a, b) => b.priority - a.priority || a.id - b.id);

  // greedy round-robin allocation of modules
  const allocMap = new Map(state.stalls.map(s => [s.id, 0]));
  let remaining = siteModules;

  // Round 1+: hand out one module at a time in priority order
  while (remaining > 0){
    let gave = false;
    for (const s of sorted){
      if (allocMap.get(s.id) < s.desiredModules && remaining > 0){
        allocMap.set(s.id, allocMap.get(s.id) + 1);
        remaining--;
        gave = true;
      }
    }
    if (!gave) break; // no more demand
  }

  // Fill allocKw on stalls
  state.stalls.forEach(s => {
    const m = allocMap.get(s.id) || 0;
    s.allocKw = m * MODULE_KW;
  });

  // pool free modules
  state.modulesTotal = siteModules;
  const usedModules = Array.from(allocMap.values()).reduce((a,b)=>a+b, 0);
  state.modulesFree = Math.max(0, siteModules - usedModules);
}

function allocateAndAnimate() {
  const before = state.stalls.map(s => s.allocKw);
  allocate(); // updates state.allocKw and modulesFree/Total

  // Animate bars & tokens per stall
  state.stalls.forEach((s, idx) => {
    const after = s.allocKw;
    const bar = document.getElementById(`bar-${s.id}`);
    const req = document.getElementById(`req-${s.id}`);
    const alloc = document.getElementById(`alloc-${s.id}`);
    const pct = (after / (MAX_SITE_KW / 2)) * 100; // bar vs 200 kW scale per stall (visual only)
    bar.style.width = clamp(pct, 0, 100) + '%';
    alloc.textContent = after;

    // If allocation changed, animate token travel
    const deltaKw = after - before[idx];
    if (deltaKw !== 0 && !prefersReduced && document.body.dataset.paused !== 'true'){
      const modules = Math.abs(deltaKw) / MODULE_KW;
      for (let i = 0; i < modules; i++){
        if (deltaKw > 0) flyFromPoolToStall(s.id);
        else flyFromStallToPool(s.id);
      }
    }
  });

  renderPoolModules();
  updateSummary();
}

/** Summary table **/
function updateSummary(){
  els.summaryBody.innerHTML = '';
  state.stalls.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>Stall ${s.id}</td>
      <td>${s.connected ? s.requestKw + ' kW' : '-'}</td>
      <td>${s.allocKw} kW</td>
      <td>${s.priority}</td>
    `;
    els.summaryBody.appendChild(tr);
  });
}

/** Token animation along a simple quadratic curve (requestAnimationFrame) — MDN: rAF [6](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) */
function flyToken(pointA, pointB, reverse=false){
  const token = document.createElement('div');
  token.className = 'token';
  els.tokensLayer.appendChild(token);

  const cp = { // control point for arc
    x: (pointA.x + pointB.x)/2 + (reverse ? -60 : 60),
    y: Math.min(pointA.y, pointB.y) - 60
  };

  const duration = 600 + Math.random()*200;
  let t0;

  function step(ts){
    if (!t0) t0 = ts;
    const p = clamp((ts - t0)/duration, 0, 1);
    // quadratic Bezier
    const x = (1-p)*(1-p)*pointA.x + 2*(1-p)*p*cp.x + p*p*pointB.x;
    const y = (1-p)*(1-p)*pointA.y + 2*(1-p)*p*cp.y + p*p*pointB.y;
    token.style.left = x + 'px';
    token.style.top = y + 'px';
    if (p < 1 && document.body.dataset.paused !== 'true') {
      requestAnimationFrame(step);
    } else {
      token.classList.add('fade');
      setTimeout(()=> token.remove(), 160);
    }
  }
  requestAnimationFrame(step);
}

function getElemCenter(el){
  const r = el.getBoundingClientRect();
  const stage = els.stage.getBoundingClientRect();
  return { x: r.left - stage.left + r.width/2, y: r.top - stage.top + r.height/2 };
}

function flyFromPoolToStall(stallId){
  const poolRef = els.moduleStack;
  const toRef = document.getElementById(`bar-${stallId}`);
  if (!poolRef || !toRef) return;
  const a = getElemCenter(poolRef);
  const b = getElemCenter(toRef);
  flyToken(a, b, false);
}

function flyFromStallToPool(stallId){
  const poolRef = els.moduleStack;
  const fromRef = document.getElementById(`bar-${stallId}`);
  if (!poolRef || !fromRef) return;
  const a = getElemCenter(fromRef);
  const b = getElemCenter(poolRef);
  flyToken(a, b, true);
}

// Boot
document.addEventListener('DOMContentLoaded', init);
