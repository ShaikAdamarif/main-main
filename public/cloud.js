// Self-hosted sync shim — talks to the bundled Node + SQLite server.
// All keys starting with "av_" are shared across every device in real time,
// EXCEPT av_session which is per-device (so each browser keeps its own login).
const SHARED_PREFIX = 'av_';
const LOCAL_ONLY = new Set(['av_session']);
const isShared = (k) => typeof k === 'string' && k.startsWith(SHARED_PREFIX) && !LOCAL_ONLY.has(k);

const origSet = Storage.prototype.setItem;
const origDel = Storage.prototype.removeItem;
let suppress = false;
let online = false;
let lastSyncAt = null;

function setBadge(state, text) {
  const b = document.getElementById('__cloud_badge');
  if (!b) return;
  b.dataset.state = state;
  b.querySelector('.txt').textContent = text;
}

function fetchWithTimeout(url, options = {}, ms = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

Storage.prototype.setItem = function (key, value) {
  origSet.call(this, key, value);
  if (this === localStorage && !suppress && isShared(key)) {
    let parsed; try { parsed = JSON.parse(value); } catch { parsed = value; }
    fetchWithTimeout('/api/kv/' + encodeURIComponent(key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: parsed })
    }).then(() => { lastSyncAt = new Date(); })
      .catch(e => console.error('[sync] push', key, e));
  }
};

Storage.prototype.removeItem = function (key) {
  origDel.call(this, key);
  if (this === localStorage && !suppress && isShared(key)) {
    fetchWithTimeout('/api/kv/' + encodeURIComponent(key), { method: 'DELETE' })
      .then(() => { lastSyncAt = new Date(); })
      .catch(e => console.error('[sync] del', key, e));
  }
};

async function hydrate() {
  const r = await fetchWithTimeout('/api/kv');
  const data = await r.json();
  suppress = true;
  try {
    // Apply server keys
    const seen = new Set();
    for (const [key, value] of Object.entries(data || {})) {
      if (!isShared(key)) continue;
      seen.add(key);
      try { origSet.call(localStorage, key, JSON.stringify(value)); } catch {}
    }
    // Push any local-only shared keys the server doesn't have yet (first device)
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!isShared(k) || seen.has(k)) continue;
      const v = localStorage.getItem(k);
      let parsed; try { parsed = JSON.parse(v); } catch { parsed = v; }
      fetchWithTimeout('/api/kv/' + encodeURIComponent(k), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parsed })
      }).catch(() => {});
    }
  } finally { suppress = false; }
  lastSyncAt = new Date();
  if (typeof window.renderAll === 'function') { try { window.renderAll(); } catch {} }
}

function subscribe() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { online = true; setBadge('on', 'Live sync'); };
  es.onerror = () => { online = false; setBadge('off', 'Reconnecting…'); };
  es.onmessage = (m) => {
    let evt; try { evt = JSON.parse(m.data); } catch { return; }
    if (!evt || !isShared(evt.key)) return;
    suppress = true;
    try {
      if (evt.type === 'del') origDel.call(localStorage, evt.key);
      else origSet.call(localStorage, evt.key, JSON.stringify(evt.value));
    } finally { suppress = false; }
    lastSyncAt = new Date();
    window.dispatchEvent(new StorageEvent('storage', { key: evt.key }));
    if (typeof window.renderAll === 'function') { try { window.renderAll(); } catch {} }
  };
}

// Public manual sync
window.cloudSync = async function () {
  setBadge('sync', 'Syncing…');
  try { await hydrate(); setBadge('on', 'Synced ' + new Date().toLocaleTimeString()); }
  catch (e) { console.error(e); setBadge('off', 'Sync failed'); }
};

function mountBadge() {
  if (document.getElementById('__cloud_badge')) return;
  const el = document.createElement('div');
  el.id = '__cloud_badge';
  el.innerHTML = `
    <style>
      #__cloud_badge{position:fixed;right:14px;bottom:14px;z-index:99999;
        font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
        background:#111;color:#fff;border-radius:999px;padding:8px 12px;
        box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;cursor:pointer;
        user-select:none;opacity:.92}
      #__cloud_badge:hover{opacity:1}
      #__cloud_badge .dot{width:8px;height:8px;border-radius:50%;background:#888}
      #__cloud_badge[data-state="on"] .dot{background:#22c55e;box-shadow:0 0 8px #22c55e}
      #__cloud_badge[data-state="off"] .dot{background:#ef4444}
      #__cloud_badge[data-state="sync"] .dot{background:#f59e0b;animation:cb 1s linear infinite}
      @keyframes cb{50%{opacity:.3}}
    </style>
    <span class="dot"></span><span class="txt">Connecting…</span>
    <span style="opacity:.7;border-left:1px solid #444;padding-left:8px;margin-left:2px">Sync</span>
  `;
  el.title = 'Click to force re-sync from server';
  el.addEventListener('click', () => window.cloudSync());
  document.body.appendChild(el);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountBadge);
} else { mountBadge(); }

window.__cloudReady = (async () => {
  try { await hydrate(); } catch (e) { console.error('[sync] hydrate', e); setBadge('off','Offline'); }
  try { subscribe(); } catch (e) { console.error('[sync] subscribe', e); }
})();
