'use strict';
/* ============================================================
   KONEKSI KE BACKEND (Google Apps Script REST API) + SESI LOGIN
   - Semua permintaan: POST text/plain (tanpa CORS preflight)
   - Token sesi dikirim di body, tidak pernah di URL
   ============================================================ */
const Sesi = {
  KEY: 'kd_session_v2',
  get() { try { const s = JSON.parse(localStorage.getItem(this.KEY) || 'null'); return s && s.token && s.exp > Date.now() ? s : null; } catch (e) { return null; } },
  set(s) { try { localStorage.setItem(this.KEY, JSON.stringify({ token: s.token, exp: s.exp })); } catch (e) { /* mode privat */ } },
  clear() { try { localStorage.removeItem(this.KEY); } catch (e) { /* abaikan */ } }
};

class AuthError extends Error { constructor(m) { super(m); this.auth = true; } }

function gasUrl() {
  const u = String((window.APP_CONFIG || {}).GAS_URL || '').trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]{20,}\/exec$/.test(u) && !/GANTI|XXXX/.test(u) ? u : '';
}

async function gasCall(action, data, timeoutMs) {
  const url = gasUrl();
  if (!url) throw new Error('GAS_URL di js/config.js belum diisi.');
  const s = Sesi.get();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
  let res;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: s ? s.token : '', data: data || {} }),
      redirect: 'follow',
      signal: ctrl.signal
    });
    if (!r.ok) throw new Error('Server merespons ' + r.status);
    res = await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Koneksi ke server terlalu lama.');
    if (e instanceof SyntaxError) throw new Error('Respons server tidak valid. Pastikan deploy Web App aksesnya "Siapa saja".');
    throw new Error(/Failed to fetch|NetworkError|Load failed/i.test(e.message) ? 'Tidak dapat terhubung ke server.' : e.message);
  } finally {
    clearTimeout(timer);
  }
  if (res && res.code === 'AUTH') {
    Sesi.clear();
    if (typeof window.onAuthRequired === 'function') window.onAuthRequired(res.message);
    throw new AuthError(res.message);
  }
  return res;
}

/* Nama fungsi lama (google.script.run) → aksi API baru */
const API_MAP = {
  getAllData:     () => ['getAll', {}],
  commitBatch:    a => ['commit', { ops: a[0] }],
  uploadBukti:    a => ['upload', { dataUrl: a[0], name: a[1] }],
  getStorageInfo: () => ['storageInfo', {}]
};
function api(fn, ...args) {
  const m = API_MAP[fn];
  if (!m) return Promise.reject(new Error('API tidak dikenal: ' + fn));
  const [action, data] = m(args);
  return gasCall(action, data, fn === 'uploadBukti' ? 120000 : 60000);
}
