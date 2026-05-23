/* =====================================================================
   Website Manager Portal — self-contained module.
   - Adds a small floating "Website Manager" icon (also visible at the very
     bottom of the page after scrolling down).
   - Hardcoded credentials: shaikadamarif1745@gmail.com / 1018na29@NNAA
   - Inside the portal:
       • Admin accounts (id, email, password)
       • Admin activity log
       • Pending delete-approval requests (Approve / Reject)
       • All website data (every key in localStorage that syncs via Neon)
   - Intercepts any Delete action performed inside the Admin Panel and
     converts it into an approval request. The admin sees a "Waiting for
     Website Manager approval…" animation. Only after the manager clicks
     Approve does the actual delete go through.
   - Does NOT modify Home, Admin / User / HR panels, or the Neon DB layer.
   ===================================================================== */
(function () {
  const WM_EMAIL = 'shaikadamarif1745@gmail.com';
  const WM_PWD   = '1018na29@NNAA';

  const K_PENDING  = 'av_wm_pending_deletes';   // shared via /api/kv
  const K_ACTIVITY = 'av_wm_activity';          // shared via /api/kv
  const K_SESSION  = 'av_wm_session';           // local-only (per device)

  /* ---------- small helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const fmt = (t) => { try { return new Date(t).toLocaleString(); } catch { return ''; } };

  function logActivity(entry) {
    const log = read(K_ACTIVITY, []);
    log.unshift({ id: uid(), at: Date.now(), ...entry });
    write(K_ACTIVITY, log.slice(0, 500));
  }

  function currentAdmin() {
    try {
      const s = read('av_session', null);
      if (!s || s.role !== 'admin') return null;
      const users = read('av_users', []);
      return users.find(u => u.id === s.id) || { id: s.id, name: s.name || 'Admin', email: s.email || '' };
    } catch { return null; }
  }

  /* ===================================================================
     1) Delete interception inside the admin panel.
        We listen in the capture phase and inspect any click on a button /
        link whose text or class hints at a delete/remove action, but only
        when the active session belongs to an admin and the click did not
        come from us (window.__wmApproved bypass flag).
     =================================================================== */
  window.__wmApproved = false;

  function looksLikeDelete(el) {
    if (!el || el.dataset?.wmIgnore === '1') return false;
    const txt = (el.textContent || '').trim().toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();
    if (cls.includes('wm-')) return false;
    return /(^|\s)(delete|remove|reject|wipe|erase|clear)(\s|$)/.test(txt)
        || /\b(danger)\b/.test(cls) && /(delete|remove)/.test(txt);
  }

  function describeContext(el) {
    // climb up to find a row/card description
    let cur = el, ctx = '';
    for (let i = 0; i < 6 && cur; i++, cur = cur.parentElement) {
      if (cur.matches?.('.list-row, .card, tr, li, .row, .item')) {
        ctx = cur.innerText.replace(/\s+/g, ' ').slice(0, 160).trim();
        break;
      }
    }
    return ctx || (el.closest('section,div')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160).trim();
  }

  function queueDeleteRequest(btn) {
    const admin = currentAdmin();
    const list = read(K_PENDING, []);
    const id = uid();
    // Capture an executable handle so we can run the deletion later from any
    // page/device once the manager approves. We snapshot the inline onclick
    // string (most delete buttons in this app use window._av.deleteXxx('id')).
    const onclickAttr = btn.getAttribute && btn.getAttribute('onclick') || '';
    list.unshift({
      id,
      at: Date.now(),
      adminId: admin?.id || null,
      adminName: admin?.name || 'Admin',
      adminEmail: admin?.email || '',
      label: (btn.textContent || 'Delete').trim().slice(0, 60),
      context: describeContext(btn),
      page: location.hash || location.pathname,
      onclickAttr,
      status: 'pending',
    });
    write(K_PENDING, list);
    btn.dataset.wmReqId = id;
    logActivity({ type: 'delete_request', admin: admin?.email || admin?.name || 'admin', detail: btn.textContent.trim() });
    showWaitingOverlay(id, btn);
  }

  document.addEventListener('click', function (e) {
    if (window.__wmApproved) return; // bypass for manager-approved replays
    const btn = e.target.closest('button, a, [role="button"]');
    if (!btn) return;
    // Only intercept inside the main app shell, and only when admin is logged in.
    if (!btn.closest('#app')) return;
    if (!currentAdmin()) return;
    if (!looksLikeDelete(btn)) return;
    // Don't double-queue if this button already has an active request.
    if (btn.dataset.wmReqId) {
      const exists = read(K_PENDING, []).find(p => p.id === btn.dataset.wmReqId && p.status === 'pending');
      if (exists) { e.preventDefault(); e.stopImmediatePropagation(); showWaitingOverlay(exists.id, btn); return; }
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    queueDeleteRequest(btn);
  }, true);

  /* ---- waiting overlay shown to the admin ---- */
  function showWaitingOverlay(reqId, btn) {
    let ov = document.getElementById('wm-wait');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wm-wait';
      ov.innerHTML = `
        <div class="wm-wait-card">
          <div class="wm-spinner"></div>
          <h3>Waiting for Website Manager approval…</h3>
          <p>Your delete request has been sent. It will go through once approved.</p>
          <button class="wm-btn wm-btn-ghost" data-wm-ignore="1" id="wm-wait-close">Close</button>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.classList.remove('show'); });
      $('#wm-wait-close', ov).addEventListener('click', () => ov.classList.remove('show'));
    }
    ov.classList.add('show');

    // Poll for resolution
    const start = Date.now();
    const poll = setInterval(() => {
      const rec = read(K_PENDING, []).find(p => p.id === reqId);
      if (!rec || rec.status !== 'pending') {
        clearInterval(poll);
        ov.classList.remove('show');
        if (rec) processResolvedForAdmin(rec, btn);
      }
      if (Date.now() - start > 1000 * 60 * 30) clearInterval(poll); // 30 min safety
    }, 1200);
  }

  /* ===================================================================
     Cross-page / cross-device approval handling.
     The admin may close the waiting overlay, navigate away, or even be on
     a different device when the manager resolves the request. This handler
     runs whenever the pending list changes (SSE via cloud.js dispatches a
     `storage` event for av_* keys) and also once on boot.
     =================================================================== */
  const _handledLocally = new Set();

  function executeOnclick(rec) {
    if (!rec.onclickAttr) return false;
    window.__wmApproved = true;
    try {
      // Run the captured handler in the page's global scope. Most delete
      // buttons in this app are inline `onclick="window._av.deleteXxx('id')"`
      // which is safe to evaluate directly because it came from our own UI.
      // Use Function so `this` and globals resolve correctly.
      new Function(rec.onclickAttr).call(window);
      return true;
    } catch (err) {
      console.error('[wm] failed to execute approved delete', err);
      return false;
    } finally {
      setTimeout(() => { window.__wmApproved = false; }, 50);
    }
  }

  function showRejectModal(rec) {
    let ov = document.getElementById('wm-reject');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'wm-reject';
      ov.className = 'wm-modal-base';
      ov.innerHTML = `
        <div class="wm-wait-card" style="max-width:420px">
          <div style="font-size:36px">🚫</div>
          <h3 style="color:#b91c1c">Website Manager rejected your request</h3>
          <p id="wm-reject-msg"></p>
          <button class="wm-btn wm-btn-primary" data-wm-ignore="1" id="wm-reject-close">OK</button>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', (ev) => { if (ev.target === ov) ov.classList.remove('show'); });
      ov.querySelector('#wm-reject-close').addEventListener('click', () => ov.classList.remove('show'));
    }
    ov.querySelector('#wm-reject-msg').textContent =
      `Delete request "${rec.label}" was rejected${rec.context ? ' — ' + rec.context : ''}.`;
    ov.classList.add('show');
  }

  function processResolvedForAdmin(rec, originalBtn) {
    if (!rec || rec.status === 'pending') return;
    if (_handledLocally.has(rec.id)) return;

    const admin = currentAdmin();
    // Only the admin who initiated the request reacts (executes or sees notice).
    if (!admin || (rec.adminId && rec.adminId !== admin.id)) return;

    if (rec.status === 'approved') {
      // Mark handled FIRST to avoid re-entry when the deletion mutates av_*
      // keys and the resulting SSE event fires this handler again.
      _handledLocally.add(rec.id);
      let ran = false;
      if (originalBtn && document.body.contains(originalBtn)) {
        window.__wmApproved = true;
        try { originalBtn.click(); ran = true; }
        catch (e) { console.error(e); }
        finally { setTimeout(() => { window.__wmApproved = false; }, 50); }
      }
      if (!ran) ran = executeOnclick(rec);
      if (ran) {
        logActivity({ type: 'delete_executed', admin: rec.adminEmail || rec.adminName, detail: rec.label + ' — ' + (rec.context || '') });
        toast('Delete approved — performed');
        // Persist that it ran so other tabs/devices don't try again.
        const list = read(K_PENDING, []);
        const idx = list.findIndex(p => p.id === rec.id);
        if (idx >= 0 && !list[idx].executedAt) {
          list[idx].executedAt = Date.now();
          write(K_PENDING, list);
        }
      } else {
        toast('Delete approved, but the original action could not be replayed. Please retry.');
      }
    } else if (rec.status === 'rejected') {
      _handledLocally.add(rec.id);
      showRejectModal(rec);
    }
  }

  function scanResolved() {
    const list = read(K_PENDING, []);
    for (const rec of list) {
      if (rec.status === 'pending') continue;
      if (rec.status === 'approved' && rec.executedAt) { _handledLocally.add(rec.id); continue; }
      processResolvedForAdmin(rec, null);
    }
  }

  // React to SSE-driven updates and same-tab writes to K_PENDING.
  window.addEventListener('storage', (e) => {
    if (e.key === K_PENDING) scanResolved();
  });
  // Initial scan after cloud hydrate finishes (so we catch resolutions that
  // happened while this admin's device was offline / on another page).
  function bootScan() {
    if (window.__cloudReady && typeof window.__cloudReady.then === 'function') {
      window.__cloudReady.then(() => setTimeout(scanResolved, 200));
    } else {
      setTimeout(scanResolved, 600);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootScan);
  } else { bootScan(); }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'wm-toast'; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2400);
  }

  /* ===================================================================
     2) Floating icon + bottom-of-page icon
     =================================================================== */
  function mountIcons() {
    if (document.getElementById('wm-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'wm-fab'; fab.title = 'Website Manager';
    fab.setAttribute('data-wm-ignore', '1');
    fab.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>`;
    fab.addEventListener('click', openPortal);
    document.body.appendChild(fab);

    // Show/hide the FAB based on scroll position — appears at the bottom.
    const onScroll = () => {
      const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
      fab.classList.toggle('show', nearBottom);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    setTimeout(onScroll, 200);

    // Also append a small footer entry so it's discoverable when fully scrolled.
    const footer = document.createElement('div');
    footer.id = 'wm-footer';
    footer.innerHTML = `<button id="wm-footer-btn" data-wm-ignore="1" title="Website Manager">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
        <span>Website Manager</span>
      </button>`;
    document.body.appendChild(footer);
    $('#wm-footer-btn', footer).addEventListener('click', openPortal);
  }

  /* ===================================================================
     3) Portal UI
     =================================================================== */
  function openPortal() {
    let modal = document.getElementById('wm-modal');
    if (modal) { modal.classList.add('show'); renderPortal(); return; }
    modal = document.createElement('div');
    modal.id = 'wm-modal';
    modal.innerHTML = `
      <div class="wm-card">
        <div class="wm-head">
          <div class="wm-title">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
            Website Manager Portal
          </div>
          <button class="wm-x" id="wm-close" data-wm-ignore="1">&times;</button>
        </div>
        <div class="wm-body" id="wm-body"></div>
      </div>`;
    document.body.appendChild(modal);
    $('#wm-close', modal).addEventListener('click', () => modal.classList.remove('show'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });
    modal.classList.add('show');
    renderPortal();
  }

  function isLoggedIn() {
    const s = read(K_SESSION, null);
    return s && s.email === WM_EMAIL;
  }

  function renderPortal() {
    const body = document.getElementById('wm-body');
    if (!body) return;
    body.innerHTML = isLoggedIn() ? portalDashboard() : loginScreen();
    wirePortal();
  }

  function loginScreen() {
    return `
      <div class="wm-login">
        <h2>Sign in</h2>
        <p class="wm-muted">Restricted access. Website Manager only.</p>
        <label>Email</label>
        <input id="wm-email" type="email" autocomplete="username" placeholder="email@example.com" />
        <label>Password</label>
        <input id="wm-pwd" type="password" autocomplete="current-password" placeholder="••••••••" />
        <div id="wm-err" class="wm-err"></div>
        <button class="wm-btn wm-btn-primary" id="wm-login-btn" data-wm-ignore="1">Sign in</button>
      </div>`;
  }

  function portalDashboard() {
    const users   = read('av_users', []);
    const admins  = users.filter(u => u.role === 'admin');
    const pending = read(K_PENDING, []);
    const activity = read(K_ACTIVITY, []);
    const pendingCount = pending.filter(p => p.status === 'pending').length;

    // collect every shared av_ key for the "all website data" panel
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('av_') && k !== K_SESSION) keys.push(k);
    }
    keys.sort();

    return `
      <div class="wm-tabs">
        <button class="wm-tab active" data-tab="approvals" data-wm-ignore="1">Approvals <span class="wm-badge">${pendingCount}</span></button>
        <button class="wm-tab" data-tab="admins" data-wm-ignore="1">Admin Accounts</button>
        <button class="wm-tab" data-tab="activity" data-wm-ignore="1">Activity</button>
        <button class="wm-tab" data-tab="data" data-wm-ignore="1">Website Data</button>
        <button class="wm-tab wm-tab-end" data-tab="logout" data-wm-ignore="1">Sign out</button>
      </div>

      <section class="wm-panel" data-pane="approvals">
        <h3>Pending delete approvals</h3>
        ${pending.length === 0 ? `<p class="wm-muted">No requests yet.</p>` :
          pending.map(p => `
            <div class="wm-row">
              <div class="wm-row-main">
                <div><b>${esc(p.label)}</b> <span class="wm-tag ${p.status}">${p.status}</span></div>
                <div class="wm-muted wm-sm">${esc(p.context || '—')}</div>
                <div class="wm-muted wm-sm">By ${esc(p.adminName)} &lt;${esc(p.adminEmail || '—')}&gt; · ${fmt(p.at)}</div>
              </div>
              ${p.status === 'pending' ? `
                <div class="wm-actions">
                  <button class="wm-btn wm-btn-primary" data-wm-ignore="1" data-approve="${p.id}">Approve</button>
                  <button class="wm-btn wm-btn-ghost"   data-wm-ignore="1" data-reject="${p.id}">Reject</button>
                </div>` : ``}
            </div>`).join('')}
      </section>

      <section class="wm-panel hide" data-pane="admins">
        <h3>Admin accounts (${admins.length})</h3>
        <table class="wm-table">
          <thead><tr><th>Name</th><th>Email</th><th>Slot</th><th>Password</th><th>Status</th></tr></thead>
          <tbody>
            ${admins.map(a => `
              <tr>
                <td>${esc(a.name || '')}</td>
                <td>${esc(a.email || '')}</td>
                <td>${esc(a.adminSlot || '-')}</td>
                <td><code class="wm-code">${esc(a.password || '')}</code></td>
                <td>${a.approved ? '<span class="wm-tag approved">approved</span>' : '<span class="wm-tag pending">pending</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>

      <section class="wm-panel hide" data-pane="activity">
        <h3>Recent admin activity</h3>
        ${activity.length === 0 ? `<p class="wm-muted">No activity yet.</p>` :
          `<ul class="wm-log">${activity.slice(0, 100).map(a => `
            <li><span class="wm-muted wm-sm">${fmt(a.at)}</span>
                <b>${esc(a.type)}</b> — ${esc(a.admin || '')} ${a.detail ? '· ' + esc(a.detail) : ''}</li>`).join('')}</ul>`}
        <button class="wm-btn wm-btn-ghost" id="wm-clear-log" data-wm-ignore="1">Clear log</button>
      </section>

      <section class="wm-panel hide" data-pane="data">
        <h3>All website data</h3>
        <p class="wm-muted wm-sm">Every shared key in the Neon-backed store.</p>
        <div class="wm-keys">
          ${keys.map(k => {
            const v = localStorage.getItem(k) || '';
            const preview = v.length > 600 ? v.slice(0, 600) + '…' : v;
            return `<details class="wm-kv">
              <summary><code>${esc(k)}</code> <span class="wm-muted wm-sm">${v.length} chars</span></summary>
              <pre>${esc(preview)}</pre>
            </details>`;
          }).join('')}
        </div>
      </section>
    `;
  }

  function wirePortal() {
    const body = document.getElementById('wm-body');
    if (!body) return;

    const loginBtn = $('#wm-login-btn', body);
    if (loginBtn) {
      const attemptLogin = () => {
        const em = $('#wm-email', body).value.trim().toLowerCase();
        const pw = $('#wm-pwd', body).value;
        if (em === WM_EMAIL.toLowerCase() && pw === WM_PWD) {
          localStorage.setItem(K_SESSION, JSON.stringify({ email: em, at: Date.now() }));
          renderPortal();
        } else {
          $('#wm-err', body).textContent = 'Invalid email or password.';
        }
      };
      loginBtn.addEventListener('click', attemptLogin);
      body.querySelectorAll('#wm-email,#wm-pwd').forEach(input => {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });
      });
    }

    body.querySelectorAll('.wm-tab').forEach(t => t.addEventListener('click', () => {
      const tab = t.dataset.tab;
      if (tab === 'logout') {
        localStorage.removeItem(K_SESSION);
        renderPortal();
        return;
      }
      body.querySelectorAll('.wm-tab').forEach(x => x.classList.toggle('active', x === t));
      body.querySelectorAll('.wm-panel').forEach(p => p.classList.toggle('hide', p.dataset.pane !== tab));
    }));

    body.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.approve;
      const list = read(K_PENDING, []);
      const rec = list.find(p => p.id === id);
      if (rec) { rec.status = 'approved'; rec.resolvedAt = Date.now(); write(K_PENDING, list); }
      logActivity({ type: 'manager_approved', admin: rec?.adminEmail || rec?.adminName, detail: rec?.label });
      renderPortal();
    }));
    body.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.reject;
      const list = read(K_PENDING, []);
      const rec = list.find(p => p.id === id);
      if (rec) { rec.status = 'rejected'; rec.resolvedAt = Date.now(); write(K_PENDING, list); }
      logActivity({ type: 'manager_rejected', admin: rec?.adminEmail || rec?.adminName, detail: rec?.label });
      renderPortal();
    }));

    const clr = $('#wm-clear-log', body);
    if (clr) clr.addEventListener('click', () => { write(K_ACTIVITY, []); renderPortal(); });
  }

  // Re-render the portal automatically when KV updates flow in from other devices.
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (e.key === K_PENDING || e.key === K_ACTIVITY || e.key === 'av_users') {
      const modal = document.getElementById('wm-modal');
      if (modal && modal.classList.contains('show') && isLoggedIn()) renderPortal();
    }
  });

  /* ===================================================================
     4) Styles
     =================================================================== */
  const css = `
  #wm-fab{position:fixed;right:14px;bottom:56px;z-index:99998;width:38px;height:38px;border-radius:50%;
    border:none;background:#0a3d91;color:#fff;display:none;align-items:center;justify-content:center;
    box-shadow:0 8px 22px rgba(10,61,145,.45);cursor:pointer;transition:transform .2s ease, opacity .2s ease;opacity:.95}
  #wm-fab.show{display:flex;animation:wmPop .25s ease}
  #wm-fab:hover{transform:scale(1.08);opacity:1}
  @keyframes wmPop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:.95}}

  #wm-footer{margin:40px auto 24px;display:flex;justify-content:center}
  #wm-footer-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(10,61,145,.25);
    background:transparent;color:#0a3d91;padding:6px 12px;border-radius:999px;font:600 12px/1 system-ui;cursor:pointer}
  #wm-footer-btn:hover{background:rgba(10,61,145,.08)}

  #wm-modal{position:fixed;inset:0;background:rgba(8,12,28,.6);backdrop-filter:blur(4px);z-index:100000;
    display:none;align-items:center;justify-content:center;padding:20px}
  #wm-modal.show{display:flex;animation:wmFade .2s ease}
  @keyframes wmFade{from{opacity:0}to{opacity:1}}
  #wm-modal .wm-card{background:#fff;color:#111;width:min(960px,100%);max-height:90vh;border-radius:16px;
    overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.4);
    animation:wmRise .25s ease}
  @keyframes wmRise{from{transform:translateY(16px);opacity:.5}to{transform:none;opacity:1}}
  #wm-modal .wm-head{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;
    border-bottom:1px solid #eef0f4;background:linear-gradient(90deg,#0a3d91,#1158d0);color:#fff}
  #wm-modal .wm-title{display:flex;gap:8px;align-items:center;font:700 14px/1 system-ui}
  #wm-modal .wm-x{background:transparent;border:none;color:#fff;font-size:24px;line-height:1;cursor:pointer}
  #wm-modal .wm-body{padding:18px;overflow:auto}

  .wm-login{max-width:360px;margin:8px auto}
  .wm-login h2{margin:0 0 4px;font:700 20px system-ui}
  .wm-login label{display:block;font:600 12px system-ui;margin:12px 0 4px;color:#374151}
  .wm-login input{width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font:14px system-ui}
  .wm-login input:focus{outline:none;border-color:#0a3d91;box-shadow:0 0 0 3px rgba(10,61,145,.15)}
  .wm-err{color:#b91c1c;font:600 12px system-ui;margin-top:8px;min-height:14px}

  .wm-btn{padding:9px 14px;border-radius:8px;border:1px solid transparent;font:600 13px system-ui;cursor:pointer;margin-top:10px}
  .wm-btn-primary{background:#0a3d91;color:#fff}
  .wm-btn-primary:hover{background:#0b46a8}
  .wm-btn-ghost{background:#fff;border-color:#d1d5db;color:#111}
  .wm-btn-ghost:hover{background:#f3f4f6}

  .wm-tabs{display:flex;gap:4px;border-bottom:1px solid #eef0f4;margin-bottom:14px;flex-wrap:wrap}
  .wm-tab{background:transparent;border:none;padding:10px 14px;font:600 13px system-ui;color:#475569;
    border-bottom:2px solid transparent;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
  .wm-tab:hover{color:#0a3d91}
  .wm-tab.active{color:#0a3d91;border-color:#0a3d91}
  .wm-tab-end{margin-left:auto;color:#b91c1c}
  .wm-badge{background:#0a3d91;color:#fff;border-radius:999px;padding:2px 8px;font-size:11px}

  .wm-panel{animation:wmFade .2s ease}
  .wm-panel h3{margin:0 0 10px;font:700 15px system-ui}
  .wm-panel.hide{display:none}

  .wm-row{display:flex;gap:12px;justify-content:space-between;align-items:flex-start;
    padding:12px;border:1px solid #eef0f4;border-radius:10px;margin-bottom:8px;background:#fafbfd}
  .wm-row-main{flex:1;min-width:0}
  .wm-actions{display:flex;gap:6px;flex-shrink:0}
  .wm-actions .wm-btn{margin:0}

  .wm-tag{display:inline-block;padding:1px 8px;border-radius:999px;font:600 11px system-ui;margin-left:6px}
  .wm-tag.pending{background:#fef3c7;color:#92400e}
  .wm-tag.approved{background:#dcfce7;color:#166534}
  .wm-tag.rejected{background:#fee2e2;color:#991b1b}

  .wm-table{width:100%;border-collapse:collapse;font:13px system-ui}
  .wm-table th,.wm-table td{padding:8px 10px;border-bottom:1px solid #eef0f4;text-align:left;vertical-align:top}
  .wm-table th{background:#f8fafc;font-weight:700;font-size:12px;color:#475569}
  .wm-code{background:#0b1220;color:#e2e8f0;padding:2px 6px;border-radius:6px;font:12px ui-monospace,Menlo,monospace}

  .wm-log{list-style:none;margin:0;padding:0}
  .wm-log li{padding:8px 10px;border-bottom:1px solid #eef0f4;font:13px system-ui}

  .wm-kv{border:1px solid #eef0f4;border-radius:8px;margin-bottom:6px;background:#fafbfd}
  .wm-kv summary{cursor:pointer;padding:8px 10px;font:13px system-ui}
  .wm-kv pre{margin:0;padding:10px;background:#0b1220;color:#e2e8f0;border-radius:0 0 8px 8px;
    font:12px ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto}

  .wm-muted{color:#64748b}
  .wm-sm{font-size:12px}

  #wm-wait{position:fixed;inset:0;background:rgba(8,12,28,.65);backdrop-filter:blur(4px);z-index:100001;
    display:none;align-items:center;justify-content:center;padding:20px}
  #wm-wait.show{display:flex;animation:wmFade .2s ease}
  .wm-modal-base{position:fixed;inset:0;background:rgba(8,12,28,.65);backdrop-filter:blur(4px);z-index:100003;
    display:none;align-items:center;justify-content:center;padding:20px}
  .wm-modal-base.show{display:flex;animation:wmFade .2s ease}
  .wm-wait-card{background:#fff;border-radius:14px;padding:26px 28px;max-width:380px;text-align:center;
    box-shadow:0 20px 60px rgba(0,0,0,.4);animation:wmRise .25s ease}
  .wm-wait-card h3{margin:14px 0 6px;font:700 16px system-ui;color:#0a3d91}
  .wm-wait-card p{margin:0 0 14px;color:#475569;font:14px system-ui}
  .wm-spinner{width:46px;height:46px;border-radius:50%;border:4px solid #e5e7eb;border-top-color:#0a3d91;
    margin:0 auto;animation:wmSpin 1s linear infinite}
  @keyframes wmSpin{to{transform:rotate(360deg)}}

  .wm-toast{position:fixed;left:50%;bottom:80px;transform:translateX(-50%) translateY(20px);
    background:#111827;color:#fff;padding:10px 16px;border-radius:999px;font:600 13px system-ui;
    z-index:100002;opacity:0;transition:all .25s ease}
  .wm-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
  `;
  const style = document.createElement('style');
  style.id = 'wm-styles'; style.textContent = css;
  document.head.appendChild(style);

  window.openWebsiteManagerPortal = openPortal;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountIcons);
  } else { mountIcons(); }
})();
