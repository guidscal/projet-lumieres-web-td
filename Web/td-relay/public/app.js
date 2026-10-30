// app.js: builds the page from config.js and talks to TouchDesigner.
// You normally don't need to edit this file: add or change controls in config.js.
(() => {
'use strict';

const C = CONFIG;
const $ = (id) => document.getElementById(id);
const STORE_KEY = 'tdControllerState4';
const DEFAULT_PORT = 9980;      // only used when the page is opened as a plain file
const LIGHTS = C.lightCount;
const hasValue = (c) => c.type !== 'button';
const lightCtrls = C.lightControls || [];
const globalCtrls = C.globalControls || [];
const palette = C.defaultColors && C.defaultColors.length ? C.defaultColors : ['#ffffff'];

// ---- small helpers -------------------------------------------------------
function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v);
  }
  kids.forEach((k) => e.append(k));
  return e;
}
const toPos = (v, min, max, log) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
const fromPos = (t, min, max, log) => (log ? min * Math.pow(max / min, t) : min + (max - min) * t);
const round2 = (v) => Math.round(v * 100) / 100;
const clampNum = (v, lo, hi, fb) => (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi ? v : fb);
const isHex = (s) => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s);

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => +(v / 255).toFixed(4);
  return { r: f((n >> 16) & 255), g: f((n >> 8) & 255), b: f(n & 255) };
}

function fmtSeconds(sec) {
  if (sec < 10) return sec.toFixed(1) + ' s';
  if (sec < 60) return Math.round(sec) + ' s';
  const m = Math.floor(sec / 60), r = Math.round(sec - m * 60);
  return m + ' min ' + r + ' s';
}
function fmtValue(c, v) {
  const unit = c.unit !== undefined ? c.unit : (c.type === 'range' ? 's' : '');
  if (unit === 's') return fmtSeconds(v);
  const dec = c.step ? Math.max(0, -Math.floor(Math.log10(c.step))) : 2;
  return v.toFixed(dec) + (unit ? ' ' + unit : '');
}

// ---- state ---------------------------------------------------------------
// S.global : values of the global controls, plus the switches (<id>_shared, modeSwitch ids)
// S.lights : one object per light with the value of each light control
const S = { global: {}, lights: [] };
const keyInfo = {};             // for loading saved values safely

function defaultValue(c, lightIndex = 0) {
  switch (c.type) {
    case 'color': return isHex(c.default) ? c.default : palette[lightIndex % palette.length];
    case 'colors': return Array.from({ length: c.count || 4 }, (_, k) =>
      (c.default && isHex(c.default[k])) ? c.default[k] : palette[(lightIndex + k) % palette.length]);
    case 'range': return { min: c.default ? c.default[0] : c.min, max: c.default ? c.default[1] : c.max };
    case 'slider': return c.default !== undefined ? c.default : c.min;
    case 'toggle': return !!c.default;
    case 'choice': return c.default || 0;
  }
}

function cleanValue(c, saved, fb) {
  try {
    switch (c.type) {
      case 'color': return isHex(saved) ? saved : fb;
      case 'colors': return fb.map((d, k) => (isHex(saved[k]) ? saved[k] : d));
      case 'range': {
        const lo = clampNum(saved.min, c.min, c.max, fb.min), hi = clampNum(saved.max, c.min, c.max, fb.max);
        return { min: lo, max: Math.max(lo, hi) };
      }
      case 'slider': return clampNum(saved, c.min, c.max, fb);
      case 'toggle': return typeof saved === 'boolean' ? saved : fb;
      case 'choice': return Number.isInteger(saved) && saved >= 0 && saved < c.options.length ? saved : fb;
    }
  } catch (e) {}
  return fb;
}

function initState() {
  globalCtrls.filter(hasValue).forEach((c) => {
    S.global[c.id] = defaultValue(c);
    keyInfo[c.id] = { kind: 'value', ctrl: c };
  });
  lightCtrls.forEach((c) => {
    if (c.shared) {
      if (hasValue(c)) { S.global[c.id] = defaultValue(c); keyInfo[c.id] = { kind: 'value', ctrl: c }; }
      S.global[c.id + '_shared'] = true;
      keyInfo[c.id + '_shared'] = { kind: 'flag' };
    }
    if (c.modeSwitch) { S.global[c.modeSwitch.id] = 0; keyInfo[c.modeSwitch.id] = { kind: 'mode' }; }
  });
  for (let i = 0; i < LIGHTS; i++) {
    const L = {};
    lightCtrls.filter(hasValue).forEach((c) => (L[c.id] = defaultValue(c, i)));
    S.lights.push(L);
  }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
}
function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) {}
  if (!saved || !saved.global) return;
  for (const key of Object.keys(S.global)) {
    if (!(key in saved.global)) continue;
    const info = keyInfo[key], v = saved.global[key];
    S.global[key] = info.kind === 'value' ? cleanValue(info.ctrl, v, S.global[key])
                  : info.kind === 'flag' ? !!v
                  : (v === 1 ? 1 : 0);
  }
  (saved.lights || []).forEach((sl, i) => {
    if (!S.lights[i] || !sl) return;
    lightCtrls.filter(hasValue).forEach((c) => {
      if (c.id in sl) S.lights[i][c.id] = cleanValue(c, sl[c.id], S.lights[i][c.id]);
    });
  });
}

// ---- what is sent to TouchDesigner --------------------------------------
function serialize(c, v, out) {
  switch (c.type) {
    case 'color': out[c.id] = hexToRgb(v); break;
    case 'colors': out[c.id] = v.map(hexToRgb); break;
    case 'range': out[c.id + '_min'] = round2(v.min); out[c.id + '_max'] = round2(v.max); break;
    case 'toggle': out[c.id] = v ? 1 : 0; break;
    case 'slider': out[c.id] = round2(v); break;
    case 'choice': out[c.id] = v; break;
  }
}

function eventNames() {
  const names = new Set();
  (C.topButtons || []).forEach((b) => names.add(b.id));
  globalCtrls.concat(lightCtrls).filter((c) => c.type === 'button').forEach((b) => names.add(b.id));
  return [...names];
}

function currentState() {
  const g = {};
  globalCtrls.filter(hasValue).forEach((c) => serialize(c, S.global[c.id], g));
  lightCtrls.forEach((c) => {
    if (c.shared) {
      if (hasValue(c)) serialize(c, S.global[c.id], g);
      g[c.id + '_shared'] = S.global[c.id + '_shared'] ? 1 : 0;
    }
    if (c.modeSwitch) g[c.modeSwitch.id] = S.global[c.modeSwitch.id];
  });
  const lights = S.lights.map((L) => {
    const o = {};
    lightCtrls.filter(hasValue).forEach((c) => {
      const useGlobal = c.shared && S.global[c.id + '_shared'];      // "same for all": every light gets the global value
      serialize(c, useGlobal ? S.global[c.id] : L[c.id], o);
    });
    return o;
  });
  return { type: 'state', global: g, lights, events: eventNames() };
}

// ---- UI ------------------------------------------------------------------
const refreshers = [];
function refreshUI() { refreshers.forEach((fn) => fn()); }
function changed() { save(); refreshUI(); scheduleState(); }

const globalScope = (c) => ({ get: () => S.global[c.id], set: (v) => (S.global[c.id] = v) });
const lightScope = (c, i) => ({ get: () => S.lights[i][c.id], set: (v) => (S.lights[i][c.id] = v) });

// Two (or more) choices shown as buttons: value = index of the selected one
function segControl(labels, get, set) {
  const name = 'seg' + (++segControl.n);
  const box = h('div', { class: 'seg' });
  box.style.gridTemplateColumns = labels.length <= 3 ? `repeat(${labels.length}, 1fr)` : 'repeat(auto-fit, minmax(90px, 1fr))';
  const radios = labels.map((text, k) => {
    const r = h('input', { type: 'radio', name });
    r.addEventListener('change', () => { if (r.checked) { set(k); changed(); } });
    box.append(h('label', {}, r, h('span', { text })));
    return r;
  });
  refreshers.push(() => radios.forEach((r, k) => (r.checked = get() === k)));
  return box;
}
segControl.n = 0;

function renderControl(c, scope, target) {
  const label = c.label || c.id;
  switch (c.type) {

    case 'color': {
      const input = h('input', { type: 'color' });
      input.addEventListener('input', () => { scope.set(input.value); changed(); });
      refreshers.push(() => (input.value = scope.get()));
      return h('label', {}, h('span', { text: label }), input);
    }

    case 'colors': {
      const n = c.count || 4;
      const grid = h('div', { class: 'colors' });
      const caption = h('div', { class: 'caption' });
      const cells = [], inputs = [];
      for (let k = 0; k < n; k++) {
        const input = h('input', { type: 'color' });
        input.addEventListener('input', () => { scope.get()[k] = input.value; changed(); });
        const name = h('span', { text: 'Color ' + (k + 1) });
        const cell = h('label', { class: 'mini' }, name, input);
        grid.append(cell); cells.push(cell); inputs.push(input);
      }
      refreshers.push(() => {
        const single = c.modeSwitch && S.global[c.modeSwitch.id] === 1;
        const visible = single ? 1 : n;
        caption.textContent = single ? (c.singleLabel || 'Color') : label;
        inputs.forEach((input, k) => { input.value = scope.get()[k]; cells[k].hidden = k >= visible; });
        cells[0].firstChild.textContent = single ? 'Color' : 'Color 1';
      });
      return h('div', {}, caption, grid);
    }

    case 'slider': {
      const log = !!c.log;
      const input = h('input', { type: 'range' });
      if (log) { input.min = 0; input.max = 1; input.step = 0.001; }
      else { input.min = c.min; input.max = c.max; input.step = c.step || (c.max - c.min) / 100; }
      const val = h('span', { class: 'val' });
      input.addEventListener('input', () => {
        const x = parseFloat(input.value);
        scope.set(log ? fromPos(x, c.min, c.max, true) : x);
        changed();
      });
      refreshers.push(() => {
        const v = scope.get();
        input.value = log ? toPos(v, c.min, c.max, true) : v;
        val.textContent = fmtValue(c, v);
      });
      return h('label', {}, h('span', { class: 'row' }, h('span', { text: label }), val), input);
    }

    case 'range': {
      const log = c.log !== false;
      const val = h('span', { class: 'val' }), vMin = h('span', { class: 'val' }), vMax = h('span', { class: 'val' });
      const mk = () => h('input', { type: 'range', min: 0, max: 1, step: 0.001 });
      const lo = mk(), hi = mk();
      const onMove = (which) => () => {
        const r = scope.get();
        r[which] = fromPos(parseFloat((which === 'min' ? lo : hi).value), c.min, c.max, log);
        if (r.min > r.max) { if (which === 'min') r.max = r.min; else r.min = r.max; }   // shortest never above longest
        changed();
      };
      lo.addEventListener('input', onMove('min'));
      hi.addEventListener('input', onMove('max'));
      refreshers.push(() => {
        const r = scope.get();
        lo.value = toPos(r.min, c.min, c.max, log); hi.value = toPos(r.max, c.min, c.max, log);
        vMin.textContent = fmtValue(c, r.min); vMax.textContent = fmtValue(c, r.max);
        val.textContent = fmtValue(c, r.min) + ' to ' + fmtValue(c, r.max);
      });
      return h('div', { class: 'range' },
        h('div', { class: 'row' }, h('span', { text: label }), val),
        h('label', { class: 'mini' }, h('span', { class: 'row' }, h('span', { text: 'Shortest' }), vMin), lo),
        h('label', { class: 'mini' }, h('span', { class: 'row' }, h('span', { text: 'Longest' }), vMax), hi));
    }

    case 'toggle': {
      const input = h('input', { type: 'checkbox' });
      input.addEventListener('change', () => { scope.set(input.checked); changed(); });
      refreshers.push(() => (input.checked = !!scope.get()));
      return h('label', { class: 'toggle' }, input, h('span', { text: label }));
    }

    case 'choice': {
      return h('div', {}, h('div', { class: 'caption', text: label }),
        segControl(c.options, () => scope.get(), (v) => scope.set(v)));
    }

    case 'button': {
      const b = h('button', { type: 'button', class: 'pulse small', text: label, dataset: { ev: c.id, target } });
      return b;
    }
  }
  return h('div', { text: 'Unknown control type: ' + c.type });
}

function buildUI() {
  // big buttons at the top: fire for every light
  (C.topButtons || []).forEach((b) =>
    $('topButtons').append(h('button', { type: 'button', class: 'pulse big', text: b.label || b.id, dataset: { ev: b.id, target: 'all' } })));

  // settings box: switches + global controls
  const settings = $('settings');
  lightCtrls.concat(globalCtrls).filter((c) => c.modeSwitch).forEach((c) => {
    const id = c.modeSwitch.id;
    settings.append(h('div', {}, h('div', { class: 'caption', text: c.label || c.id }),
      segControl(c.modeSwitch.labels, () => S.global[id], (v) => (S.global[id] = v))));
  });
  lightCtrls.filter((c) => c.shared).forEach((c) => {
    const key = c.id + '_shared';
    const labels = (c.shared && c.shared.labels) || ['Same for all', 'One per light'];
    const inst = h('div', {}, renderControl(c, globalScope(c), 'g'));      // the value used when "same for all"
    refreshers.push(() => (inst.hidden = !S.global[key]));
    settings.append(h('div', {}, h('div', { class: 'caption', text: c.label || c.id }),
      segControl(labels, () => (S.global[key] ? 0 : 1), (v) => (S.global[key] = v === 0))), inst);
  });
  globalCtrls.forEach((c) => settings.append(renderControl(c, globalScope(c), 'g')));
  settings.hidden = settings.children.length === 0;

  // one card per light
  for (let i = 0; i < LIGHTS; i++) {
    const card = h('section', { class: 'light' });
    const buttons = h('div', { class: 'buttons' });
    card.append(h('div', { class: 'row' }, h('strong', { text: (C.lightNames && C.lightNames[i]) || 'Light ' + (i + 1) }), buttons));
    lightCtrls.forEach((c) => {
      const node = renderControl(c, lightScope(c, i), String(i + 1));
      if (c.type === 'button') { buttons.append(node); return; }
      if (c.shared) {                                                  // hidden while "same for all" is on
        const key = c.id + '_shared';
        refreshers.push(() => (node.hidden = !!S.global[key]));
      }
      card.append(node);
    });
    $('lights').append(card);
  }
}

// ---- WebSocket -----------------------------------------------------------
let ws = null, retryTimer = null, sendTimer = null;

function setStatus(text, color) {
  $('statusText').textContent = text;
  $('dot').style.background = color;
}
function sendJSON(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; }
  return false;
}
function scheduleState() {          // throttled: at most one message per sendInterval
  if (sendTimer) return;
  sendTimer = setTimeout(() => { sendTimer = null; sendJSON(currentState()); }, C.sendInterval || 40);
}

// "wss://…" is used as is; "host:port" gets ws:// (or wss:// when this page is https)
function resolveUrl(raw) {
  raw = raw.trim();
  if (/^wss?:\/\//i.test(raw)) return raw;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + raw;
}
// Browsers refuse some connections from an https page: don't even try those
function blockReason(url) {
  if (location.protocol !== 'https:') return '';
  if (/^ws:\/\//i.test(url) && !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url))
    return 'blocked: an https page can only use wss:// (or localhost)';
  if (/^wss:\/\/\d{1,3}(\.\d{1,3}){3}(:|\/|$)/i.test(url))
    return 'wss:// needs a host name with a certificate, not a bare IP address';
  return '';
}

function connect() {
  clearTimeout(retryTimer);
  if (ws) { const old = ws; ws = null; old.onclose = null; old.close(); }
  const raw = $('host').value.trim();
  if (!raw) { setStatus('enter a server address below', '#c90'); return; }
  const url = resolveUrl(raw);
  const reason = blockReason(url);
  if (reason) { setStatus(reason, '#c00'); return; }

  let sock;
  try { sock = new WebSocket(url); } catch (e) { setStatus('invalid address', '#c00'); return; }
  ws = sock;
  setStatus('connecting…', '#c90');
  sock.onopen = () => { setStatus('connected', '#0a0'); sendJSON(currentState()); };   // sync TD on (re)connect
  sock.onclose = () => {
    if (ws !== sock) return;
    setStatus('disconnected, retrying…', '#c00');
    retryTimer = setTimeout(connect, 1500);
  };
  sock.onerror = () => sock.close();
}

// ---- go ------------------------------------------------------------------
initState();
load();
buildUI();

// Bookmark helper: open  https://yoursite/#wss://relay.example/r  once on your phone.
const hashUrl = decodeURIComponent(location.hash.slice(1));
if (/^wss?:\/\//i.test(hashUrl)) {
  try { localStorage.setItem('tdHost', hashUrl); } catch (e) {}
  history.replaceState(null, '', location.pathname + location.search);
}
// Page served by the Cloudflare relay (workers.dev): connect to the same host automatically.
const relayOpen = location.protocol === 'https:' && /\.workers\.dev$/.test(location.hostname) &&
                  (location.pathname === '/' || location.pathname === '/index.html');
$('host').value = relayOpen ? 'wss://' + location.host + '/r' :
  localStorage.getItem('tdHost') ||
    (location.protocol === 'http:' && location.host ? location.host :
     location.protocol === 'file:' ? '127.0.0.1:' + DEFAULT_PORT : '');
$('host').addEventListener('change', () => {
  try { localStorage.setItem('tdHost', $('host').value.trim()); } catch (e) {}
  connect();
});

// Buttons fire when the finger is LIFTED on the same button it touched, so scrolling the page
// with a finger that happens to start on a button doesn't trigger anything.
function fireEvent(btn) {
  sendJSON({ type: 'event', name: btn.dataset.ev, target: btn.dataset.target, count: LIGHTS });
  btn.classList.add('hit');
  setTimeout(() => btn.classList.remove('hit'), 120);
  if (navigator.vibrate) navigator.vibrate(15);
}
let downBtn = null;
document.addEventListener('pointerdown', (e) => { downBtn = e.target.closest('[data-ev]'); });
document.addEventListener('pointerup', (e) => {
  const b = e.target.closest('[data-ev]');
  if (b && b === downBtn) fireEvent(b);
  downBtn = null;
});
document.addEventListener('pointercancel', () => { downBtn = null; });
document.addEventListener('keydown', (e) => {
  if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && e.target.closest) {
    const b = e.target.closest('[data-ev]');
    if (b) { e.preventDefault(); fireEvent(b); }
  }
});

// phones suspend sockets when the screen sleeps: reconnect when the page is visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1)) connect();
});

refreshUI();
connect();
})();
