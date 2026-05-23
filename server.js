const path = require('path');
const express = require('express');
const { Pool } = require('pg');
try { require('dotenv').config(); } catch {}

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

let pool = null;
let databaseReady = Promise.reject(new Error('DATABASE_URL is not set. Add it in Vercel → Settings → Environment Variables (Neon connection string).'));
databaseReady.catch(() => {}); // avoid unhandled rejection

if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  databaseReady = pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).then(() => console.log('Neon database initialized.'));
} else {
  console.warn('[WARN] DATABASE_URL missing — API routes will return 500 until set.');
}

function withDatabase(handler) {
  return async (req, res, next) => {
    try {
      await databaseReady;
      return handler(req, res, next);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  };
}

const app = express();
app.use(express.json({ limit: '30mb' }));

const clients = new Set();
function broadcast(evt) {
  const payload = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch {} }
}

app.get('/api/health', async (_req, res) => {
  if (!pool) return res.status(500).json({ ok: false, error: 'DATABASE_URL not set' });
  try {
    await databaseReady;
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, now: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/kv', withDatabase(async (_req, res) => {
  const { rows } = await pool.query('SELECT key, value FROM kv_store');
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  res.json(out);
}));

app.put('/api/kv/:key', withDatabase(async (req, res) => {
  const key = req.params.key;
  const value = req.body?.value;
  const json = JSON.stringify(value ?? null);
  await pool.query(`
    INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, json]);
  broadcast({ type: 'set', key, value });
  res.json({ ok: true });
}));

app.delete('/api/kv/:key', withDatabase(async (req, res) => {
  const key = req.params.key;
  await pool.query('DELETE FROM kv_store WHERE key = $1', [key]);
  broadcast({ type: 'del', key });
  res.json({ ok: true });
}));

// SSE — works locally; on Vercel serverless it will simply time out (client falls back to polling).
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

// Local-only static serving (Vercel serves /public via static build)
if (!process.env.VERCEL) {
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
}

if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, () => console.log(`AV PROP MISSION on http://localhost:${PORT}`));
}
