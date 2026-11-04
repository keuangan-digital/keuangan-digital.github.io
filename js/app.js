'use strict';
/* ============================================================
   KEUANGAN DIGITAL — Frontend (js/app.js) • GitHub Pages + GAS REST API
   Prinsip instant UX:
   1. SPA: semua halaman ada di DOM, navigasi = show/hide (0 ms)
   2. Optimistic UI: perubahan tampil seketika, disimpan ke
      localStorage, lalu disinkronkan ke server lewat antrean
   3. Data dibaca sekali (getAllData, di-cache di server)
   4. Satu aksi = satu panggilan commitBatch (batch)
   ============================================================ */

/* ───────────── STATE ───────────── */
const SHEETS = ['Transaksi', 'Akun', 'Kartu_Kredit', 'Tagihan_Kartu', 'Cicilan', 'Langganan', 'Kendaraan',
  'Riwayat_Pajak', 'Tagihan_Rutin', 'Riwayat_Tagihan', 'Kategori', 'Pengaturan'];
const NUM_FIELDS = ['Nominal', 'SaldoAwal', 'Limit', 'TglCetak', 'TglJatuhTempo', 'Pengingat', 'Total', 'Minimum',
  'Dibayar', 'HargaTotal', 'Tenor', 'PerBulan', 'NominalTahunan', 'Nominal5Th', 'Perkiraan', 'Anggaran'];
const LS = { snap: 'kd_snapshot_v1', queue: 'kd_queue_v1', theme: 'kd_theme', sb: 'kd_sidebar' };
const SYS_CAT = { ID: 'SYS-KARTU', Nama: 'Pembayaran Kartu', Jenis: 'Transfer', Warna: '#FF7A00', Ikon: 'bi-credit-card' };
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const ICONS = ['bi-cup-hot', 'bi-cart3', 'bi-fuel-pump', 'bi-house-door', 'bi-play-btn', 'bi-heart-pulse', 'bi-bag-check',
  'bi-bank', 'bi-three-dots', 'bi-cash-stack', 'bi-briefcase', 'bi-lightning-charge', 'bi-droplet', 'bi-fire', 'bi-wifi',
  'bi-phone', 'bi-mortarboard', 'bi-gift', 'bi-airplane', 'bi-scissors', 'bi-basket', 'bi-car-front', 'bi-piggy-bank', 'bi-graph-up-arrow'];
const PAGE_TITLES = { dashboard: 'Dashboard', transaksi: 'Transaksi', kartu: 'Kartu Kredit', kartuDetail: 'Detail Kartu',
  tagihan: 'Tagihan & Pengingat', laporan: 'Laporan', pengaturan: 'Pengaturan' };

const S = {
  data: emptyData(),
  ready: false,
  page: 'dashboard',
  queue: [],
  syncing: false,
  retry: 0,
  charts: {},
  trx: { q: '', from: '', to: '', jenis: '', kat: '', src: '', page: 1, sort: 'Tanggal', dir: -1 },
  tagihanTab: 'langganan',
  settingsTab: 'akun',
  laporanRange: 6,
  kartuDetail: { id: null, tab: 'tagihan' },
  storageInfo: null,
  gajiYm: null,
  tsDraft: null
};

function emptyData() {
  const d = {};
  SHEETS.forEach(s => { d[s] = []; });
  return d;
}

/* ───────────── UTIL ───────────── */
function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kuota penuh / diblokir */ } }
/** Teks aman untuk argumen string JS di dalam atribut onclick='...' */
function jsq(s) { return esc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function pad(n) { return String(n).padStart(2, '0'); }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function keyOf(sheet) { return sheet === 'Pengaturan' ? 'Kunci' : 'ID'; }

function uid(prefix) {
  const d = new Date();
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// Tanggal disimpan sebagai teks 'yyyy-MM-dd' (bebas zona waktu)
function dstr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function today() { return dstr(new Date()); }
function toDate(s) { if (!s) return null; const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function ym(s) { return String(s || '').slice(0, 7); }
function thisYm() { return ym(today()); }
function ymAdd(y, n) { const [a, b] = y.split('-').map(Number); const d = new Date(a, b - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function ymDiff(a, b) { const [y1, m1] = a.split('-').map(Number); const [y2, m2] = b.split('-').map(Number); return (y2 - y1) * 12 + (m2 - m1); }
function lastDay(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function dateInYm(y, day) { const [a, b] = y.split('-').map(Number); return `${y}-${pad(Math.min(num(day) || 1, lastDay(a, b - 1)))}`; }
function addMonths(s, n) {
  const d = toDate(s); if (!d) return '';
  const day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  t.setDate(Math.min(day, lastDay(t.getFullYear(), t.getMonth())));
  return dstr(t);
}
function daysUntil(s) { const d = toDate(s); if (!d) return 9999; const t = toDate(today()); return Math.round((d - t) / 86400000); }
function fmtDate(s, long) { const d = toDate(s); if (!d) return '—'; return `${d.getDate()} ${(long ? BULAN_PANJANG : BULAN)[d.getMonth()]} ${d.getFullYear()}`; }
function fmtYm(y, long) { if (!y) return '—'; const [a, b] = y.split('-').map(Number); return `${(long ? BULAN_PANJANG : BULAN)[b - 1]} ${a}`; }

function rp(n) { const v = Math.round(num(n)); return (v < 0 ? '-Rp ' : 'Rp ') + Math.abs(v).toLocaleString('id-ID'); }
function money(n) { const v = Math.round(num(n)); return `<span class="rp">${v < 0 ? '-Rp' : 'Rp'}</span>${Math.abs(v).toLocaleString('id-ID')}`; }
function rpShort(n) {
  const v = num(n), a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e9) return `${s}Rp ${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })}M`;
  if (a >= 1e6) return `${s}Rp ${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 2 })}jt`;
  if (a >= 1e3) return `${s}Rp ${Math.round(a / 1e3)}rb`;
  return rp(v);
}
function parseMoney(s) { return num(String(s || '').replace(/[^\d]/g, '')); }
function fmtMoneyInput(s) { const v = parseMoney(s); return v ? v.toLocaleString('id-ID') : ''; }

function terbilang(n) {
  n = Math.floor(num(n));
  const s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  const f = x => {
    if (x < 12) return s[x];
    if (x < 20) return f(x - 10) + ' belas';
    if (x < 100) return f(Math.floor(x / 10)) + ' puluh ' + f(x % 10);
    if (x < 200) return 'seratus ' + f(x - 100);
    if (x < 1000) return f(Math.floor(x / 100)) + ' ratus ' + f(x % 100);
    if (x < 2000) return 'seribu ' + f(x - 1000);
    if (x < 1e6) return f(Math.floor(x / 1000)) + ' ribu ' + f(x % 1000);
    if (x < 1e9) return f(Math.floor(x / 1e6)) + ' juta ' + f(x % 1e6);
    if (x < 1e12) return f(Math.floor(x / 1e9)) + ' miliar ' + f(x % 1e9);
    return f(Math.floor(x / 1e12)) + ' triliun ' + f(x % 1e12);
  };
  if (!n) return 'nol rupiah';
  const out = f(n).replace(/\s+/g, ' ').trim() + ' rupiah';
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

/* ───────────── SERVER & SINKRONISASI ───────────── */
/* api(), gasCall(), Sesi → lihat js/api.js */

function normalizeRec(sheet, rec) {
  const o = Object.assign({}, rec);
  NUM_FIELDS.forEach(f => { if (f in o) o[f] = num(o[f]); });
  return o;
}

function applyOps(ops) {
  ops.forEach(o => {
    const k = keyOf(o.sheet);
    if (o.op === 'delete') {
      S.data[o.sheet] = S.data[o.sheet].filter(r => r[k] !== o.id);
      return;
    }
    const rec = normalizeRec(o.sheet, o.rec);
    const arr = S.data[o.sheet];
    const i = arr.findIndex(r => r[k] === rec[k]);
    if (i > -1) arr[i] = rec; else arr.push(rec);
  });
}

const up = (sheet, rec) => ({ op: 'upsert', sheet, rec });
const del = (sheet, id) => ({ op: 'delete', sheet, id });

const saveSnapshot = debounce(() => lsSet(LS.snap, S.data), 250);

/** Optimistic commit: UI berubah sekarang, server menyusul di latar belakang. */
function commit(ops, msg) {
  applyOps(ops);
  saveSnapshot();
  refresh();
  if (msg) toast(msg, 'success');
  S.queue.push({ id: uid('Q'), ops });
  lsSet(LS.queue, S.queue);
  flushQueue();
}

async function flushQueue() {
  if (S.syncing) return;
  if (!S.queue.length) { setSync('ok'); return; }
  S.syncing = true;
  setSync('sync');
  const item = S.queue[0];
  try {
    const res = await api('commitBatch', item.ops);
    S.queue.shift();
    lsSet(LS.queue, S.queue);
    S.syncing = false;
    S.retry = 0;
    if (!res || !res.success) {
      toast('Gagal menyimpan: ' + (res ? res.message : 'tanpa respons'), 'error');
      loadFromServer(true); // kembalikan ke data server yang benar
    }
    flushQueue();
  } catch (err) {
    S.syncing = false;
    setSync('err');
    if (err.auth) return; // menunggu login; antrean tetap tersimpan & dikirim setelah masuk
    S.retry++;
    setTimeout(flushQueue, Math.min(30000, 2000 * S.retry));
  }
}

async function loadFromServer(silent) {
  if (!silent) setSync('sync');
  try {
    const res = await api('getAllData');
    if (!res || !res.success) throw new Error(res ? res.message : 'Tidak ada respons');
    const fresh = emptyData();
    SHEETS.forEach(s => { fresh[s] = (res.data.tables[s] || []).map(r => normalizeRec(s, r)); });
    S.data = fresh;
    S.queue.forEach(q => applyOps(q.ops)); // perubahan yang belum tersinkron tetap tampil
    S.ready = true;
    saveSnapshot();
    renderAll();
    setSync(S.queue.length ? 'sync' : 'ok');
  } catch (err) {
    setSync('err', err.message);
    if (err.auth) return;
    if (!S.ready) renderBootError(err.message);
    else toast('Menampilkan data tersimpan di perangkat. ' + err.message, 'warning');
  }
}

function setSync(state, msg) {
  const dot = $('#syncDot'), txt = $('#syncText'), banner = $('#syncBanner');
  dot.className = 'dot ' + (state === 'ok' ? 'dot-ok' : state === 'sync' ? 'dot-sync' : 'dot-err');
  const nama = setting('namaPemilik', 'Pemilik');
  txt.textContent = state === 'ok' ? `Tersinkron • ${nama}` : state === 'sync' ? 'Menyimpan…' : 'Belum tersinkron';
  if (state === 'err' && S.queue.length) {
    banner.hidden = false;
    banner.innerHTML = `<i class="bi bi-cloud-slash"></i> ${S.queue.length} perubahan tersimpan di perangkat dan akan dikirim otomatis saat koneksi kembali.`;
  } else if (state === 'err' && msg && !S.ready) {
    banner.hidden = true;
  } else {
    banner.hidden = true;
  }
}

function renderBootError(msg) {
  $('#page-dashboard').innerHTML = `
    <div class="card"><div class="empty">
      <div class="empty-ic"><i class="bi bi-database-exclamation"></i></div>
      <h4>Data belum bisa dimuat</h4>
      <p>${esc(msg)}</p>
      <button class="btn btn-primary" onclick="loadFromServer()"><i class="bi bi-arrow-clockwise"></i> Coba lagi</button>
    </div></div>`;
}

/* ───────────── LOOKUP & HITUNGAN ───────────── */
function setting(k, def) { const r = S.data.Pengaturan.find(x => x.Kunci === k); return r && r.Nilai !== '' ? r.Nilai : def; }
const findBy = (sheet, id) => S.data[sheet].find(r => r.ID === id);
const akun = id => findBy('Akun', id);
const kartu = id => findBy('Kartu_Kredit', id);
const isActive = r => (r.Status || 'Aktif') !== 'Nonaktif' && r.Status !== 'Berhenti';
function catInfo(id) { if (id === SYS_CAT.ID) return SYS_CAT; return findBy('Kategori', id) || { ID: id, Nama: 'Tanpa kategori', Warna: '#A1A1AA', Ikon: 'bi-question-circle' }; }
function catByName(name) { const c = S.data.Kategori.find(k => k.Nama === name); return c ? c.ID : (S.data.Kategori.find(k => k.Nama === 'Lainnya') || {}).ID || ''; }
function cats(jenis) { return S.data.Kategori.filter(c => c.Jenis === jenis && isActive(c)); }
function sourceName(id) {
  const a = akun(id); if (a) return a.Nama;
  const k = kartu(id); if (k) return `${k.Nama} •${k.Digit4}`;
  return id ? '—' : '—';
}
function sourceOptions(includeCards) {
  const o = S.data.Akun.filter(isActive).map(a => ({ v: a.ID, l: `${a.Nama} (${rp(saldoAkun(a))})` }));
  if (includeCards) S.data.Kartu_Kredit.filter(isActive).forEach(k => o.push({ v: k.ID, l: `Kartu ${k.Nama} •${k.Digit4}` }));
  return o;
}
function remindDays(item) { const n = num(item && item.Pengingat); return n > 0 ? n : num(setting('pengingatDefault', 7)) || 7; }

function saldoAkun(a) {
  let s = num(a.SaldoAwal);
  S.data.Transaksi.forEach(t => {
    if (t.SumberDana !== a.ID) return;
    s += t.Jenis === 'Pemasukan' ? num(t.Nominal) : -num(t.Nominal);
  });
  return s;
}
function totalSaldo() { return S.data.Akun.filter(isActive).reduce((s, a) => s + saldoAkun(a), 0); }

/** Pemasukan & pengeluaran per bulan. Pembayaran kartu tidak dihitung (pengeluarannya sudah tercatat saat belanja). */
function monthTotals(m) {
  let inc = 0, exp = 0, nIn = 0, nOut = 0;
  S.data.Transaksi.forEach(t => {
    if (ym(t.Tanggal) !== m) return;
    if (t.Jenis === 'Pemasukan') { inc += num(t.Nominal); nIn++; }
    else if (t.Jenis === 'Pengeluaran') { exp += num(t.Nominal); nOut++; }
  });
  return { inc, exp, net: inc - exp, nIn, nOut };
}
function expenseByCat(m) {
  const map = {};
  S.data.Transaksi.forEach(t => {
    if (t.Jenis !== 'Pengeluaran' || ym(t.Tanggal) !== m) return;
    map[t.Kategori] = map[t.Kategori] || { total: 0, n: 0 };
    map[t.Kategori].total += num(t.Nominal);
    map[t.Kategori].n++;
  });
  return map;
}

/* ── Siklus tagihan kartu: (tgl cetak bulan lalu, tgl cetak bulan ini] ──
   Contoh cetak tgl 5: periode Nov 2026 = transaksi 6 Okt – 5 Nov, jatuh tempo 25 Nov. */
function addDays(s, n) { const d = toDate(s); d.setDate(d.getDate() + n); return dstr(d); }
function cetakDate(k, P) { return dateInYm(P, num(k.TglCetak) || 1); }
function periodOf(k, dateStr) { const P = ym(dateStr); return dateStr <= cetakDate(k, P) ? P : ymAdd(P, 1); }
function cycleRange(k, P) { return { start: addDays(cetakDate(k, ymAdd(P, -1)), 1), end: cetakDate(k, P) }; }
function lastClosedPeriod(k) { const P = thisYm(); return daysUntil(cetakDate(k, P)) <= 0 ? P : ymAdd(P, -1); }
function cardCharges(k) { return S.data.Transaksi.filter(t => t.Jenis === 'Pengeluaran' && t.SumberDana === k.ID); }
function cycleTx(k, P) { return cardCharges(k).filter(t => periodOf(k, t.Tanggal) === P).sort((a, b) => b.Tanggal.localeCompare(a.Tanggal)); }

function cicilanInfo(c) {
  const k = kartu(c.KartuID);
  const L = k ? lastClosedPeriod(k) : thisYm();
  const elapsed = ymDiff(c.BulanMulai || thisYm(), L) + 1;   // cicilan ke-n ditagih di tgl cetak
  const tenor = Math.max(1, num(c.Tenor));
  const paid = Math.max(0, Math.min(tenor, elapsed));
  const sisaBulan = tenor - paid;
  const lunas = paid >= tenor || c.Status === 'Lunas';
  return { paid, tenor, sisaBulan: lunas ? 0 : sisaBulan, sisaPokok: lunas ? 0 : sisaBulan * num(c.PerBulan), lunas, pct: Math.round(paid / tenor * 100) };
}

function cardBills(k) { return S.data.Tagihan_Kartu.filter(b => b.KartuID === k.ID).sort((a, b) => a.Periode.localeCompare(b.Periode)); }
function currentBill(k) { const b = cardBills(k); return b[b.length - 1] || null; }
function billDueDate(k, periode) {
  const sameMonth = num(k.TglJatuhTempo) > num(k.TglCetak);
  return dateInYm(sameMonth ? periode : ymAdd(periode, 1), k.TglJatuhTempo);
}
function billSisa(b) { return Math.max(0, num(b.Total) - num(b.Dibayar)); }

/**
 * Pemakaian limit = semua tagihan tercetak − semua pembayaran
 *                 + transaksi kartu yang belum ditagih (siklus berjalan)
 *                 + sisa pokok cicilan yang belum ditagih.
 */
function kartuInfo(k) {
  const bills = cardBills(k);
  const billed = new Set(bills.map(b => b.Periode));
  const openP = ymAdd(lastClosedPeriod(k), 1);
  let payments = 0, openTotal = 0, orphan = 0;
  const openTx = [];
  S.data.Transaksi.forEach(t => {
    if (t.Jenis === 'Pembayaran Kartu' && t.Referensi === k.ID) payments += num(t.Nominal);
    if (t.Jenis !== 'Pengeluaran' || t.SumberDana !== k.ID) return;
    const P = periodOf(k, t.Tanggal);
    if (P >= openP) { openTotal += num(t.Nominal); openTx.push(t); }
    else if (!billed.has(P)) orphan += num(t.Nominal);
  });
  const cicilan = S.data.Cicilan.filter(c => c.KartuID === k.ID).map(c => Object.assign({ c }, cicilanInfo(c)));
  const sisaCicilan = cicilan.reduce((s, x) => s + x.sisaPokok, 0);
  const unpaid = bills.filter(b => b.Status !== 'Lunas' && billSisa(b) > 0);
  const outstanding = unpaid.reduce((s, b) => s + billSisa(b), 0);
  // pembayaran yang belum teralokasi ke tagihan (bayar lebih awal) mengurangi transaksi belum ditagih
  const unalloc = Math.max(0, payments - bills.reduce((s, b) => s + num(b.Dibayar), 0));
  const pakai = outstanding + Math.max(0, openTotal + orphan - unalloc) + sisaCicilan;
  const limit = num(k.Limit);
  return { pakai, limit, sisa: Math.max(0, limit - pakai), pct: limit ? Math.min(100, Math.round(pakai / limit * 100)) : 0,
    bill: bills[bills.length - 1] || null, bills, unpaid, outstanding,
    open: (() => {
      // cicilan yang akan ditagih pada tgl cetak siklus ini (belum diposting)
      const cc = cicilan.filter(x => { const idx = ymDiff(x.c.BulanMulai || openP, openP);
        return x.c.Status !== 'Lunas' && idx >= 0 && idx < num(x.c.Tenor) && !findBy('Transaksi', `TRX-CCL-${x.c.ID}-${openP}`); })
        .map(x => ({ c: x.c, ke: ymDiff(x.c.BulanMulai, openP) + 1, nominal: num(x.c.PerBulan) }));
      const cicilanTotal = cc.reduce((s, x) => s + x.nominal, 0);
      return Object.assign({ P: openP, total: openTotal, tx: openTx.sort((a, b) => b.Tanggal.localeCompare(a.Tanggal)),
        cicilan: cc, cicilanTotal, estimasi: openTotal + cicilanTotal }, cycleRange(k, openP));
    })(),
    cicilan, sisaCicilan };
}

function estimasiRutin(t) {
  const h = S.data.Riwayat_Tagihan.filter(r => r.TagihanID === t.ID).sort((a, b) => b.TglBayar.localeCompare(a.TglBayar)).slice(0, 3);
  if (!h.length) return { val: num(t.Perkiraan), min: 0, max: 0, n: 0 };
  const vals = h.map(r => num(r.Nominal));
  return { val: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}

/** Semua pengingat dihitung di perangkat (tanpa trigger/email). */
function getReminders() {
  const out = [];
  const push = (r) => { if (r.days <= r.window || r.days < 0) out.push(r); };

  S.data.Kartu_Kredit.filter(isActive).forEach(k => {
    const w = remindDays(k);
    S.data.Tagihan_Kartu.filter(b => b.KartuID === k.ID && b.Status !== 'Lunas').forEach(b => {
      push({ key: 'kb-' + b.ID, type: 'kartu', id: b.ID, icon: 'bi-credit-card', cls: 'ic-sq',
        title: `Tagihan ${k.Nama} ${fmtYm(b.Periode)}`, sub: `•••• ${k.Digit4} • Min. ${rp(b.Minimum)}`, amount: billSisa(b),
        due: b.JatuhTempo, days: daysUntil(b.JatuhTempo), window: w });
    });
  });
  S.data.Langganan.filter(l => isActive(l) && !isCardPaid(l)).forEach(l => {
    push({ key: 'lg-' + l.ID, type: 'langganan', id: l.ID, icon: 'bi-play-btn', cls: 'ic-sq',
      title: l.Nama, sub: `${l.Siklus} • ${sourceName(l.DibayarPakai)}`, amount: num(l.Nominal),
      due: l.TglTagih, days: daysUntil(l.TglTagih), window: remindDays(l) });
  });
  S.data.Tagihan_Rutin.filter(t => isActive(t) && !isAutoRutin(t)).forEach(t => {
    const ic = { PLN: 'bi-lightning-charge', PDAM: 'bi-droplet', Gas: 'bi-fire', PBB: 'bi-buildings' }[t.Jenis] || 'bi-house-door';
    push({ key: 'tr-' + t.ID, type: 'rutin', id: t.ID, icon: ic, cls: 'ic-sq ic-warn',
      title: t.Nama, sub: `${t.NoPelanggan ? 'ID ' + t.NoPelanggan + ' • ' : ''}${t.Prabayar === 'Ya' ? 'Isi token' : 'Estimasi'}`,
      amount: estimasiRutin(t).val, due: t.JatuhTempo, days: daysUntil(t.JatuhTempo), window: remindDays(t) });
  });
  S.data.Kendaraan.filter(isActive).forEach(v => {
    const ic = v.Jenis === 'Mobil' ? 'bi-car-front' : 'bi-scooter';
    if (!isAutoPajak(v, false)) push({ key: 'pk1-' + v.ID, type: 'pajak', sub2: 'Tahunan', id: v.ID, icon: ic, cls: 'ic-sq ic-ink',
      title: `Pajak Tahunan ${v.Nama}`, sub: v.Nopol, amount: num(v.NominalTahunan),
      due: v.JatuhTempoTahunan, days: daysUntil(v.JatuhTempoTahunan), window: remindDays(v) });
    if (v.JatuhTempo5Th && !isAutoPajak(v, true)) {
      push({ key: 'pk5-' + v.ID, type: 'pajak', sub2: '5Th', id: v.ID, icon: ic, cls: 'ic-sq ic-ink',
        title: `STNK 5 Tahunan ${v.Nama}`, sub: `${v.Nopol} • ganti plat`, amount: num(v.Nominal5Th),
        due: v.JatuhTempo5Th, days: daysUntil(v.JatuhTempo5Th), window: remindDays(v) });
    }
  });
  return out.sort((a, b) => a.days - b.days);
}

/** Langganan yang dibayar pakai kartu kredit = didebit otomatis ke kartu. */
function isCardPaid(l) { return !!kartu(l.DibayarPakai); }
/** Tagihan rumah berbayar kartu kredit (dengan nominal estimasi > 0) didebit otomatis. */
function isAutoRutin(t) { return isCardPaid(t) && estimasiRutin(t).val > 0; }
function rutinAutoId(t, due) { return { tid: `TRX-TR-${t.ID}-${due}`, rid: `RTG-AUTO-${t.ID}-${due}` }; }
/** Pajak kendaraan berbayar kartu kredit (dengan perkiraan nominal > 0) didebit otomatis. */
function isAutoPajak(v, five) { return isCardPaid(v) && num(five ? v.Nominal5Th : v.NominalTahunan) > 0; }
function pajakAutoId(v, five, due) { const j = five ? '5' : 'T'; return { tid: `TRX-PK-${v.ID}-${j}-${due}`, rid: `RPJ-AUTO-${v.ID}-${j}-${due}` }; }
function autoPill(days) {
  if (days <= 0) return '<span class="pill pill-orange"><i class="bi bi-credit-card"></i> Didebit hari ini</span>';
  return `<span class="pill pill-gray">${days} hari lagi</span>`;
}

/**
 * Langganan berbayar kartu kredit yang sudah lewat tanggal perpanjangan dicatat
 * otomatis sebagai pengeluaran di kartu tsb, lalu tanggalnya maju ke periode berikut.
 * ID transaksi deterministik (TRX-LG-<id>-<tanggal>) → aman dijalankan berulang
 * tanpa duplikat. Pembayarannya ikut tagihan kartu.
 */
let _autoBusy = false;
/**
 * Posting otomatis ke kartu kredit (dijalankan setiap data berubah, aman diulang):
 *  1. Langganan berbayar kartu → pengeluaran di tanggal perpanjangan.
 *  2. Cicilan → pengeluaran sebesar cicilan/bulan di setiap tanggal cetak.
 *  3. Tagihan kartu per siklus = jumlah semua pengeluaran kartu di siklus itu.
 * ID deterministik → tidak pernah dobel. Tagihan yang diubah manual tidak ditimpa.
 */
function autoPost() {
  if (_autoBusy || !S.ready) return;
  const ops = [], notes = [];
  const now = new Date().toISOString();
  const trxRec = (id, tgl, kat, ket, nominal, src, ref, cat) => up('Transaksi', { ID: id, Tanggal: tgl, Jenis: 'Pengeluaran', Kategori: kat,
    Keterangan: ket, Nominal: nominal, SumberDana: src, Referensi: ref, Catatan: cat, Bukti: '', Dibuat: now, Diubah: '' });

  // 1. Langganan
  const katLg = catByName('Hiburan & Langganan');
  S.data.Langganan.filter(l => isActive(l) && isCardPaid(l) && l.TglTagih).forEach(l => {
    let due = l.TglTagih, n = 0;
    const step = l.Siklus === 'Tahunan' ? 12 : 1;
    while (daysUntil(due) <= 0 && n < 12) {
      const id = `TRX-LG-${l.ID}-${due}`;
      if (!findBy('Transaksi', id)) { ops.push(trxRec(id, due, katLg, `${l.Nama} — ${fmtYm(ym(due))}`, num(l.Nominal), l.DibayarPakai, l.ID, 'Auto-debit kartu kredit (langganan)')); notes.push('lg'); }
      due = addMonths(due, step); n++;
    }
    if (due !== l.TglTagih) ops.push(up('Langganan', Object.assign({}, l, { TglTagih: due })));
  });

  // 1b. Tagihan rumah (PBB/PDAM/PLN/Gas) berbayar kartu: dicatat sebesar estimasi, bisa disesuaikan
  const katRt = catByName('Tagihan Rumah');
  S.data.Tagihan_Rutin.filter(t => isActive(t) && isAutoRutin(t) && t.JatuhTempo).forEach(t => {
    let due = t.JatuhTempo, n = 0;
    const step = t.Siklus === 'Tahunan' ? 12 : 1, est = estimasiRutin(t).val;
    while (daysUntil(due) <= 0 && n < 12) {
      const { tid, rid } = rutinAutoId(t, due);
      if (!findBy('Transaksi', tid)) { ops.push(trxRec(tid, due, katRt, `${t.Nama} — ${fmtYm(ym(due))}`, est, t.DibayarPakai, t.ID, 'Auto-debit kartu kredit (tagihan rumah, nominal estimasi)')); notes.push('tr'); }
      if (!findBy('Riwayat_Tagihan', rid)) ops.push(up('Riwayat_Tagihan', { ID: rid, TagihanID: t.ID, Periode: ym(due), TglBayar: due, Nominal: est, DibayarPakai: t.DibayarPakai, Bukti: '' }));
      due = addMonths(due, step); n++;
    }
    if (due !== t.JatuhTempo) ops.push(up('Tagihan_Rutin', Object.assign({}, t, { JatuhTempo: due })));
  });

  // 1c. Pajak kendaraan berbayar kartu (STNK 5 tahunan diproses dulu; PKB di bulan yang sama ikut maju)
  const katPj = catByName('Pajak & Kendaraan');
  S.data.Kendaraan.filter(isActive).forEach(v => {
    const upd = Object.assign({}, v);
    [true, false].forEach(five => {
      const field = five ? 'JatuhTempo5Th' : 'JatuhTempoTahunan';
      if (!upd[field] || !isAutoPajak(v, five)) return;
      let n = 0;
      while (daysUntil(upd[field]) <= 0 && n < 6) {
        const due = upd[field], { tid, rid } = pajakAutoId(v, five, due), nominal = num(five ? v.Nominal5Th : v.NominalTahunan);
        const label = five ? 'STNK 5 Tahunan' : 'Pajak Tahunan';
        if (!findBy('Transaksi', tid)) { ops.push(trxRec(tid, due, katPj, `${label} — ${v.Nama} (${v.Nopol})`, nominal, v.DibayarPakai, v.ID, 'Auto-debit kartu kredit (pajak kendaraan, nominal perkiraan)')); notes.push('pj'); }
        if (!findBy('Riwayat_Pajak', rid)) ops.push(up('Riwayat_Pajak', { ID: rid, KendaraanID: v.ID, Jenis: five ? '5 Tahunan' : 'Tahunan', TglBayar: due, Nominal: nominal, DibayarPakai: v.DibayarPakai, Bukti: '' }));
        upd[field] = addMonths(due, five ? 60 : 12);
        if (five && upd.JatuhTempoTahunan && Math.abs((toDate(upd.JatuhTempoTahunan) - toDate(due)) / 864e5) <= 31) upd.JatuhTempoTahunan = addMonths(upd.JatuhTempoTahunan, 12);
        n++;
      }
    });
    if (upd.JatuhTempo5Th !== v.JatuhTempo5Th || upd.JatuhTempoTahunan !== v.JatuhTempoTahunan) ops.push(up('Kendaraan', upd));
  });

  // 2. Cicilan (cicilan sebelum dicatat di aplikasi dianggap sudah ditagih di luar aplikasi)
  const katCc = catByName('Cicilan Barang');
  S.data.Cicilan.forEach(c => {
    const k = kartu(c.KartuID); if (!k || !c.BulanMulai) return;
    const L = lastClosedPeriod(k), tenor = num(c.Tenor);
    const from = c.DitagihSampai || (c.BulanMulai >= L ? ymAdd(c.BulanMulai, -1) : L);
    let P = ymAdd(from, 1), last = from, n = 0;
    while (P <= L && n < 24) {
      const idx = ymDiff(c.BulanMulai, P);
      const id = `TRX-CCL-${c.ID}-${P}`;
      if (idx >= 0 && idx < tenor && !findBy('Transaksi', id)) {
        ops.push(trxRec(id, cetakDate(k, P), katCc, `Cicilan ${c.Barang} (${idx + 1}/${tenor})`, num(c.PerBulan), k.ID, c.ID, 'Cicilan kartu kredit (otomatis)'));
        notes.push('cc');
      }
      last = P; P = ymAdd(P, 1); n++;
    }
    if (last !== c.DitagihSampai) ops.push(up('Cicilan', Object.assign({}, c, { DitagihSampai: last })));
  });
  // 2b. Gaji dari timesheet (pemasukan pada tanggal gajian)
  ops.push(...gajiOps(notes));
  if (ops.length) applyOps(ops); // agar langkah 3 ikut menghitungnya

  // 3. Tagihan per siklus
  S.data.Kartu_Kredit.forEach(k => {
    const L = lastClosedPeriod(k), sums = {};
    cardCharges(k).forEach(t => { const P = periodOf(k, t.Tanggal); if (P <= L) sums[P] = (sums[P] || 0) + num(t.Nominal); });
    const periods = new Set(Object.keys(sums));
    S.data.Tagihan_Kartu.forEach(b => { if (b.KartuID === k.ID && b.Sumber === 'Otomatis') periods.add(b.Periode); });
    periods.forEach(P => {
      const ex = S.data.Tagihan_Kartu.find(b => b.KartuID === k.ID && b.Periode === P);
      if (ex && ex.Sumber !== 'Otomatis') return; // diubah manual → dikunci
      const total = Math.round(sums[P] || 0);
      if (!total) { if (ex && !num(ex.Dibayar)) ops.push(del('Tagihan_Kartu', ex.ID)); return; }
      const dib = ex ? num(ex.Dibayar) : 0;
      const rec = { ID: ex ? ex.ID : `TGK-${k.ID}-${P}`, KartuID: k.ID, Periode: P, Total: total, Minimum: Math.round(total * 0.1),
        JatuhTempo: billDueDate(k, P), Status: dib >= total ? 'Lunas' : dib > 0 ? 'Sebagian' : 'Belum',
        TglBayar: ex ? ex.TglBayar : '', Dibayar: dib, DibayarDari: ex ? ex.DibayarDari : '', Sumber: 'Otomatis' };
      if (!ex) notes.push(P === L ? `Tagihan ${k.Nama} ${fmtYm(P)} tercetak: ${rp(total)}` : 'old');
      if (!ex || ['Total', 'Minimum', 'JatuhTempo', 'Status'].some(f => String(ex[f]) !== String(rec[f]))) ops.push(up('Tagihan_Kartu', rec));
    });
  });

  if (!ops.length) return;
  _autoBusy = true;
  try {
    commit(ops);
    const nLg = notes.filter(x => x === 'lg').length, nCc = notes.filter(x => x === 'cc').length;
    if (nLg) toast(`${nLg} langganan didebit otomatis ke kartu kredit`, 'info');
    const nPj = notes.filter(x => x === 'pj').length;
    if (nPj) toast(`${nPj} pajak kendaraan didebit otomatis ke kartu kredit (nominal perkiraan — bisa disesuaikan)`, 'info');
    const nTr = notes.filter(x => x === 'tr').length;
    if (nTr) toast(`${nTr} tagihan rumah didebit otomatis ke kartu kredit (nominal estimasi — bisa disesuaikan)`, 'info');
    if (nCc) toast(`${nCc} cicilan ditagihkan ke kartu kredit`, 'info');
    notes.filter(x => x.length > 3).forEach(m => toast(m, 'info'));
    const nOld = notes.filter(x => x === 'old').length;
    if (nOld) toast(`${nOld} tagihan periode lama dibuat dari transaksi kartu sebelumnya — cek Kartu Kredit › Riwayat`, 'warning');
  } finally { _autoBusy = false; }
}

function duePill(days) {
  if (days < 0) return `<span class="pill pill-bad">Terlambat ${-days} hari</span>`;
  if (days === 0) return `<span class="pill pill-bad">Hari ini</span>`;
  if (days === 1) return `<span class="pill pill-warn">Besok</span>`;
  if (days <= 7) return `<span class="pill pill-warn">${days} hari lagi</span>`;
  return `<span class="pill pill-gray">${days} hari lagi</span>`;
}

/* ───────────── NAVIGASI (SPA, 0 ms) ───────────── */
function navigateTo(page) {
  if (page === 'lainnya') { openMore(); return; }
  if (!PAGE_TITLES[page]) page = 'dashboard';
  S.page = page;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + page));
  const navKey = page === 'kartuDetail' ? 'kartu' : page;
  $$('[data-nav]').forEach(b => {
    const on = b.dataset.nav === navKey || (b.dataset.nav === 'lainnya' && ['kartu', 'laporan', 'pengaturan'].includes(navKey));
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#crumbTitle').textContent = PAGE_TITLES[page];
  $('#mobileTitle').textContent = PAGE_TITLES[page];
  document.title = PAGE_TITLES[page] + ' • Keuangan Digital';
  window.scrollTo(0, 0);
  renderPage(page);
}

function renderPage(page) {
  if (!S.ready) return;
  const fn = { dashboard: renderDashboard, transaksi: renderTransaksi, kartu: renderKartu, kartuDetail: renderKartuDetail,
    tagihan: renderTagihan, laporan: renderLaporan, pengaturan: renderPengaturan }[page];
  try { fn && fn(); } catch (e) { console.error(e); toast('Gagal menampilkan halaman: ' + e.message, 'error'); }
}

function renderAll() { autoPost(); renderPage(S.page); updateBadges(); updateAvatar(); if ($('#drawer').classList.contains('show')) renderDrawer(); }
function refresh() { renderAll(); }

function updateBadges() {
  const n = getReminders().length;
  $$('[data-badge="reminder"]').forEach(b => { b.textContent = n; b.hidden = !n; });
  $$('[data-badge="reminder-dot"]').forEach(b => { b.hidden = !n; });
}
function updateAvatar() {
  const nama = setting('namaPemilik', 'Pemilik');
  const ini = nama.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'KD';
  $('#avatar').textContent = ini;
  $('#avatar').title = nama;
}

function toggleSidebar() {
  document.body.classList.toggle('sb-collapsed');
  lsSet(LS.sb, document.body.classList.contains('sb-collapsed'));
  setTimeout(() => Object.values(S.charts).forEach(c => c && c.resize()), 220);
}
function toggleTheme() { setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); }
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(LS.theme, t); } catch (e) { /* abaikan */ }
  renderPage(S.page);
}

/* ───────────── OVERLAY: drawer, modal, toast ───────────── */
function showBackdrop() { $('#backdrop').classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeAllOverlays() {
  $('#backdrop').classList.remove('show');
  $('#drawer').classList.remove('show');
  $('#moreMenu').classList.remove('show');
  $('#modal').classList.remove('show');
  document.body.style.overflow = '';
  if (S._confirmResolve) { S._confirmResolve(false); S._confirmResolve = null; }
}
function openMore() { showBackdrop(); $('#moreMenu').classList.add('show'); }
function openDrawer() { renderDrawer(); showBackdrop(); $('#drawer').classList.add('show'); setTimeout(() => $('#drawer .icon-btn').focus(), 50); }

function reminderRow(r, compact) {
  const action = r.type === 'input-kartu'
    ? `<button class="btn btn-secondary btn-xs" onclick="closeAllOverlays(); openBillInput('${r.id}')">Input</button>`
    : `<button class="btn btn-primary btn-xs" onclick="closeAllOverlays(); payReminder('${r.key}')"><i class="bi bi-check2-circle"></i> ${compact ? 'Lunas' : 'Tandai Lunas'}</button>`;
  return `
    <div class="r-item ${r.days <= 0 ? 'bad' : ''}">
      <div class="${r.cls} sm"><i class="bi ${r.icon}"></i></div>
      <div class="r-main">
        <div class="r-title"><span class="t">${esc(r.title)}</span></div>
        <div class="r-sub">${esc(r.sub)} • ${fmtDate(r.due)}</div>
        <div class="r-meta">${duePill(r.days)}${r.amount != null ? `<b>${rp(r.amount)}</b>` : ''}</div>
      </div>
      ${action}
    </div>`;
}

function renderDrawer() {
  const list = getReminders();
  const now = list.filter(r => r.days <= 0), soon = list.filter(r => r.days > 0);
  $('#drawerBody').innerHTML = !list.length ? emptyState('bi-emoji-smile', 'Semua aman', 'Tidak ada tagihan yang mendekati jatuh tempo.') : `
    ${now.length ? `<div class="group-h"><span><i class="bi bi-exclamation-circle" style="color:var(--danger)"></i> Hari ini &amp; terlambat</span><span class="pill pill-bad">${now.length} perlu tindakan</span></div>
      <div class="r-list" style="margin-bottom:20px">${now.map(r => reminderRow(r, true)).join('')}</div>` : ''}
    ${soon.length ? `<div class="group-h"><span>Akan datang</span><span>${soon.length} tagihan</span></div>
      <div class="r-list">${soon.map(r => reminderRow(r, true)).join('')}</div>` : ''}`;
  $('#drawerFootNote').textContent = `Jarak pengingat default: ${setting('pengingatDefault', 7)} hari sebelum jatuh tempo`;
}

function toast(msg, type = 'info') {
  const icons = { success: 'bi-check-circle-fill', error: 'bi-x-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i><span>${esc(msg)}</span>`;
  const wrap = $('#toastWrap');
  wrap.appendChild(el);
  while (wrap.children.length > 4) wrap.firstChild.remove(); // jangan menumpuk
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, type === 'error' ? 5000 : 2600);
}

function openModal(html, size) {
  const card = $('#modalCard');
  card.className = 'modal-card' + (size ? ' ' + size : '');
  card.innerHTML = html;
  $('#drawer').classList.remove('show');
  $('#moreMenu').classList.remove('show');
  showBackdrop();
  $('#modal').classList.add('show');
  setTimeout(() => { const f = card.querySelector('[autofocus], .modal-body input:not([type=file]), .modal-body select'); if (f && window.innerWidth > 767) f.focus(); }, 60);
}
function closeModal() { closeAllOverlays(); }

function modalHead(title, sub, icon) {
  return `<div class="modal-head">
    ${icon ? `<div class="ic-sq sm"><i class="bi ${icon}"></i></div>` : ''}
    <h3 id="modalTitle">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h3>
    <button class="btn-icon" onclick="closeModal()" aria-label="Tutup"><i class="bi bi-x-lg"></i></button>
  </div>`;
}

function confirmDialog({ title, msg, ok = 'Ya, lanjutkan', danger = false }) {
  return new Promise(resolve => {
    openModal(`${modalHead(title, '', danger ? 'bi-exclamation-triangle' : 'bi-question-circle')}
      <div class="modal-body"><p style="margin:0">${msg}</p></div>
      <div class="modal-foot">
        <button class="btn btn-secondary" id="cfNo">Batal</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="cfYes">${esc(ok)}</button>
      </div>`, 'sm');
    S._confirmResolve = resolve;
    $('#cfNo').onclick = () => closeAllOverlays();
    $('#cfYes').onclick = () => { S._confirmResolve = null; closeAllOverlays(); resolve(true); };
  });
}

function emptyState(icon, title, text, btn) {
  return `<div class="empty"><div class="empty-ic"><i class="bi ${icon}"></i></div><h4>${esc(title)}</h4><p>${esc(text)}</p>${btn || ''}</div>`;
}

/* ───────────── FORM BUILDER ───────────── */
/**
 * fields: { name, label, type: text|money|number|date|month|select|textarea|file|color|icon, options, required,
 *           min, max, hint, span, placeholder, quick: [{l, v}] }
 */
function openForm(cfg) {
  const v = cfg.values || {};
  const fieldHtml = f => {
    const val = v[f.name] != null ? v[f.name] : (f.default != null ? f.default : '');
    const req = f.required ? ' <span class="req">*</span>' : '';
    const id = 'f_' + f.name;
    let input = '';
    if (f.type === 'money') {
      input = `<div class="money-input"><input class="input" id="${id}" name="${f.name}" inputmode="numeric" autocomplete="off" value="${fmtMoneyInput(val)}" placeholder="0" oninput="this.value=fmtMoneyInput(this.value)"></div>
        ${f.quick ? `<div class="choice-chips" style="margin-top:8px">${f.quick.map((q, i) => `<button type="button" class="${i === 0 && f.quickOn ? 'on' : ''}" onclick="pickQuick(this,'${id}',${q.v})">${esc(q.l)}</button>`).join('')}</div>` : ''}`;
    } else if (f.type === 'select') {
      input = `<select class="input" id="${id}" name="${f.name}">${f.placeholder ? `<option value="">${esc(f.placeholder)}</option>` : ''}${(f.options || []).map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea class="input" id="${id}" name="${f.name}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
    } else if (f.type === 'file') {
      input = fileDrop(id);
    } else if (f.type === 'icon') {
      input = `<div class="cat-grid" style="grid-template-columns:repeat(6,1fr)">${ICONS.map(ic => `<button type="button" class="cat-tile ${ic === val ? 'on' : ''}" style="min-height:52px;padding:8px" data-icon="${ic}" onclick="$$('[data-icon]',this.parentNode).forEach(b=>b.classList.remove('on'));this.classList.add('on')" aria-label="${ic}"><i class="bi ${ic}" style="background:var(--primary-soft);color:var(--primary)"></i></button>`).join('')}</div><input type="hidden" id="${id}" name="${f.name}" value="${esc(val)}">`;
    } else {
      const type = f.type || 'text';
      input = `<input class="input" type="${type}" id="${id}" name="${f.name}" value="${esc(val)}" ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} placeholder="${esc(f.placeholder || '')}" ${type === 'number' ? 'inputmode="numeric"' : ''}>`;
    }
    return `<div class="field ${f.span === 2 || ['file', 'textarea', 'icon'].includes(f.type) ? 'span-2' : ''}" data-field="${f.name}">
      <label class="lbl" for="${id}"><span>${esc(f.label)}${req}</span>${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</label>
      ${input}<span class="field-err"></span></div>`;
  };

  openModal(`
    ${modalHead(cfg.title, cfg.sub, cfg.icon)}
    <form id="dynForm" novalidate>
      <div class="modal-body">
        ${cfg.top || ''}
        <div class="form-grid">${cfg.fields.map(fieldHtml).join('')}</div>
        ${cfg.info ? `<div class="callout"><i class="bi bi-info-circle"></i><div>${cfg.info}</div></div>` : ''}
      </div>
      <div class="modal-foot">
        ${cfg.extraFoot || ''}
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>
        <button type="submit" class="btn btn-primary"><i class="bi bi-check2"></i> ${esc(cfg.submitLabel || 'Simpan')}</button>
      </div>
    </form>`, cfg.size);

  if (cfg.onRender) cfg.onRender();
  $('#dynForm').onsubmit = (e) => {
    e.preventDefault();
    const vals = {}, files = {};
    let ok = true;
    cfg.fields.forEach(f => {
      const wrap = $(`[data-field="${f.name}"]`);
      wrap.classList.remove('has-err');
      const el = $('#f_' + f.name);
      let val;
      if (f.type === 'money') val = parseMoney(el.value);
      else if (f.type === 'number') val = el.value === '' ? '' : num(el.value);
      else if (f.type === 'file') { files[f.name] = el.files && el.files[0]; return; }
      else if (f.type === 'icon') { const on = $('[data-icon].on', wrap); val = on ? on.dataset.icon : el.value; }
      else val = String(el.value || '').trim();
      let err = '';
      if (f.required && (val === '' || val === 0 && f.type === 'money')) err = `${f.label} wajib diisi.`;
      else if (f.type === 'number' && val !== '' && ((f.min != null && val < f.min) || (f.max != null && val > f.max))) err = `${f.label} harus ${f.min}–${f.max}.`;
      else if (f.validate) err = f.validate(val) || '';
      if (err) { ok = false; wrap.classList.add('has-err'); $('.field-err', wrap).textContent = err; }
      vals[f.name] = val;
    });
    if (!ok) { const first = $('.has-err .input'); if (first) first.focus(); return; }
    const res = cfg.onSubmit(vals, files);
    if (typeof res === 'string') { toast(res, 'error'); return; }
    if (res !== false) closeModal();
  };
}

function pickQuick(btn, id, val) {
  $$('button', btn.parentNode).forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (val != null) { $('#' + id).value = fmtMoneyInput(val); $('#' + id).dispatchEvent(new Event('input')); }
  else $('#' + id).focus();
}

function fileDrop(id) {
  return `<label class="dropzone" for="${id}">
    <i class="bi bi-cloud-arrow-up"></i>
    <span data-drop-text>Seret &amp; lepas foto struk / PDF, atau <b style="color:var(--primary-ink)">klik untuk unggah</b><br><small>JPG, PNG, PDF • maks. 5 MB • disimpan ke Google Drive</small></span>
    <input type="file" id="${id}" name="${id}" accept="image/*,application/pdf" hidden onchange="onFilePicked(this)">
  </label>`;
}
function onFilePicked(input) {
  const f = input.files && input.files[0];
  const t = $('[data-drop-text]', input.parentNode);
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) { toast('Ukuran berkas maksimal 5 MB.', 'error'); input.value = ''; return; }
  t.innerHTML = `<span class="file-ok"><i class="bi bi-check-circle" style="display:inline;font-size:14px;color:var(--success)"></i> ${esc(f.name)}</span><br><small>Klik untuk mengganti</small>`;
}

/** Unggah bukti di latar belakang, lalu tempelkan URL-nya ke catatan terkait. */
function uploadBuktiThenPatch(file, targets) {
  if (!file) return;
  toast('Mengunggah bukti bayar…', 'info');
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const res = await api('uploadBukti', reader.result, file.name);
      if (!res.success) throw new Error(res.message);
      const ops = [];
      targets.forEach(t => {
        const rec = findBy(t.sheet, t.id);
        if (rec) ops.push(up(t.sheet, Object.assign({}, rec, { Bukti: res.data.url })));
      });
      if (ops.length) commit(ops, 'Bukti bayar tersimpan di Google Drive');
    } catch (e) { toast('Unggah bukti gagal: ' + e.message, 'error'); }
  };
  reader.readAsDataURL(file);
}

function openPreview(url) {
  const m = /\/d\/([\w-]+)/.exec(url) || /id=([\w-]+)/.exec(url);
  const id = m ? m[1] : '';
  openModal(`${modalHead('Pratinjau Bukti Bayar', '', 'bi-image')}
    <div class="modal-body">
      ${id ? `<iframe src="https://drive.google.com/file/d/${id}/preview" style="width:100%;height:60vh;border:0;border-radius:12px;background:var(--surface-2)" title="Pratinjau bukti"></iframe>` : '<p class="muted">Pratinjau tidak tersedia.</p>'}
    </div>
    <div class="modal-foot">
      <button class="btn btn-secondary" onclick="closeModal()">Tutup</button>
      <a class="btn btn-primary" href="${esc(url)}" target="_blank" rel="noopener"><i class="bi bi-download"></i> Buka / Unduh</a>
    </div>`, 'lg');
}

/* ───────────── FORM TRANSAKSI ───────────── */
function openTrxForm(id) {
  if (!S.ready) { toast('Data masih dimuat…', 'info'); return; }
  const t = id ? findBy('Transaksi', id) : null;
  if (t && t.Jenis === 'Pembayaran Kartu') { openTrxEditSimple(t); return; }
  const st = { jenis: t ? t.Jenis : 'Pengeluaran', kat: t ? t.Kategori : '' };

  const catGrid = () => {
    const list = cats(st.jenis);
    if (!list.some(c => c.ID === st.kat)) st.kat = list[0] ? list[0].ID : '';
    return list.map(c => `<button type="button" class="cat-tile ${c.ID === st.kat ? 'on' : ''}" data-cat="${c.ID}">
      <i class="bi ${esc(c.Ikon)}" style="background:${esc(c.Warna)}1f;color:${esc(c.Warna)}"></i>${esc(c.Nama)}</button>`).join('');
  };
  const srcOpts = () => sourceOptions(st.jenis === 'Pengeluaran').map(o => `<option value="${o.v}" ${t && t.SumberDana === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('');

  openModal(`
    ${modalHead(t ? 'Ubah Transaksi' : 'Catat Transaksi Baru', t ? t.ID : '', 'bi-plus-circle')}
    <form id="trxForm" novalidate>
      <div class="modal-body">
        <div class="seg full" role="tablist">
          <button type="button" data-j="Pengeluaran"><i class="bi bi-arrow-up-right"></i> Pengeluaran</button>
          <button type="button" data-j="Pemasukan"><i class="bi bi-arrow-down-left"></i> Pemasukan</button>
          ${t ? '' : `<button type="button" data-j="Bayar Kartu"><i class="bi bi-credit-card"></i> Bayar Kartu</button>`}
        </div>
        <div class="big-amount">
          <div class="lbl" style="margin-bottom:8px"><span>NOMINAL TRANSAKSI <span class="req">*</span></span><small>IDR</small></div>
          <div class="row"><span>Rp</span><input id="trxAmt" inputmode="numeric" autocomplete="off" placeholder="0" value="${t ? fmtMoneyInput(t.Nominal) : ''}" aria-label="Nominal"></div>
          <div class="meta"><span id="trxWords"><i class="bi bi-info-circle"></i> ${t ? terbilang(t.Nominal) : 'Ketik nominal'}</span>
            <span class="choice-chips"><button type="button" data-add="50000">+50rb</button><button type="button" data-add="100000">+100rb</button><button type="button" data-add="500000">+500rb</button></span></div>
        </div>
        <div class="form-grid">
          <div class="field"><label class="lbl" for="trxDate">Tanggal <span class="req">*</span></label><input class="input" type="date" id="trxDate" value="${t ? t.Tanggal : today()}"></div>
          <div class="field"><label class="lbl" for="trxSrc">Sumber dana <span class="req">*</span></label><select class="input" id="trxSrc">${srcOpts()}</select></div>
        </div>
        <div class="field"><span class="lbl" id="catLbl">Kategori</span><div class="cat-grid" id="trxCats" role="radiogroup" aria-labelledby="catLbl">${catGrid()}</div></div>
        <div class="field"><label class="lbl" for="trxKet"><span>Keterangan <span class="req">*</span></span><small id="ketCount">0/80</small></label>
          <input class="input" id="trxKet" maxlength="80" placeholder="Contoh: Belanja bulanan" value="${t ? esc(t.Keterangan) : ''}"><span class="field-err"></span></div>
        <div class="field"><label class="lbl" for="trxNote">Catatan tambahan <small>Opsional</small></label>
          <textarea class="input" id="trxNote" placeholder="Rincian tambahan…">${t ? esc(t.Catatan) : ''}</textarea></div>
        <div class="field"><span class="lbl">Lampiran / bukti bayar <small>Opsional</small></span>${t && t.Bukti ? `<button type="button" class="btn-link" onclick="openPreview('${jsq(t.Bukti)}')"><i class="bi bi-paperclip"></i> Lihat bukti tersimpan</button>` : ''}${fileDrop('trxFile')}</div>
      </div>
      <div class="modal-foot">
        ${t ? `<button type="button" class="btn btn-ghost" style="margin-right:auto;color:var(--danger-ink)" onclick="deleteTrx('${t.ID}')"><i class="bi bi-trash"></i> Hapus</button>` : ''}
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Batal</button>
        <button type="submit" class="btn btn-primary"><i class="bi bi-check2"></i> Simpan Transaksi</button>
      </div>
    </form>`);

  const amt = $('#trxAmt');
  const syncSeg = () => $$('.seg [data-j]').forEach(b => {
    b.classList.toggle('on', b.dataset.j === st.jenis);
    b.classList.toggle('ok', b.dataset.j === 'Pemasukan');
  });
  syncSeg();
  amt.oninput = () => { amt.value = fmtMoneyInput(amt.value); $('#trxWords').innerHTML = `<i class="bi bi-info-circle"></i> ${parseMoney(amt.value) ? terbilang(parseMoney(amt.value)) : 'Ketik nominal'}`; };
  $$('[data-add]').forEach(b => b.onclick = () => { amt.value = fmtMoneyInput(parseMoney(amt.value) + num(b.dataset.add)); amt.oninput(); });
  $$('.seg [data-j]').forEach(b => b.onclick = () => {
    if (b.dataset.j === 'Bayar Kartu') { closeModal(); openCardPay(); return; }
    st.jenis = b.dataset.j; syncSeg();
    $('#trxCats').innerHTML = catGrid();
    $('#trxSrc').innerHTML = srcOpts();
  });
  $('#trxCats').onclick = e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    st.kat = b.dataset.cat;
    $$('[data-cat]').forEach(x => x.classList.toggle('on', x === b));
  };
  const ket = $('#trxKet');
  const cnt = () => { $('#ketCount').textContent = `${ket.value.length}/80`; };
  ket.oninput = cnt; cnt();

  $('#trxForm').onsubmit = e => {
    e.preventDefault();
    const nominal = parseMoney(amt.value);
    if (!nominal) { toast('Nominal harus lebih dari 0.', 'error'); amt.focus(); return; }
    if (!ket.value.trim()) { ket.closest('.field').classList.add('has-err'); $('.field-err', ket.closest('.field')).textContent = 'Keterangan wajib diisi.'; ket.focus(); return; }
    if (!$('#trxSrc').value) { toast('Tambahkan akun di Pengaturan terlebih dahulu.', 'error'); return; }
    const rec = {
      ID: t ? t.ID : uid('TRX'), Tanggal: $('#trxDate').value || today(), Jenis: st.jenis, Kategori: st.kat,
      Keterangan: ket.value.trim(), Nominal: nominal, SumberDana: $('#trxSrc').value, Referensi: t ? t.Referensi : '',
      Catatan: $('#trxNote').value.trim(), Bukti: t ? t.Bukti : '', Dibuat: t ? t.Dibuat : new Date().toISOString(),
      Diubah: t ? new Date().toISOString() : ''
    };
    const file = $('#trxFile').files[0];
    closeModal();
    commit([up('Transaksi', rec)], t ? 'Transaksi diperbarui' : 'Transaksi tersimpan');
    uploadBuktiThenPatch(file, [{ sheet: 'Transaksi', id: rec.ID }]);
  };
}

function openTrxEditSimple(t) {
  openForm({
    title: 'Ubah Pembayaran Kartu', sub: t.ID, icon: 'bi-credit-card',
    values: t,
    fields: [
      { name: 'Tanggal', label: 'Tanggal', type: 'date', required: true },
      { name: 'Nominal', label: 'Nominal', type: 'money', required: true },
      { name: 'Keterangan', label: 'Keterangan', span: 2, required: true }
    ],
    info: 'Status tagihan kartu tidak berubah otomatis saat transaksi ini diubah. Sesuaikan di halaman Kartu Kredit bila perlu.',
    extraFoot: `<button type="button" class="btn btn-ghost" style="margin-right:auto;color:var(--danger-ink)" onclick="deleteTrx('${t.ID}')"><i class="bi bi-trash"></i> Hapus</button>`,
    onSubmit: v => { commit([up('Transaksi', Object.assign({}, t, v, { Diubah: new Date().toISOString() }))], 'Transaksi diperbarui'); }
  });
}

async function deleteTrx(id) {
  const t = findBy('Transaksi', id); if (!t) return;
  const ok = await confirmDialog({ title: 'Hapus transaksi ini?', msg: `<b>${esc(t.Keterangan)}</b> (${rp(t.Nominal)}) akan dihapus dan saldo ${esc(sourceName(t.SumberDana))} dihitung ulang.`, ok: 'Hapus Transaksi', danger: true });
  if (ok) commit([del('Transaksi', id)], 'Transaksi dihapus');
}

/** Sesuaikan nominal tagihan rumah yang didebit otomatis dengan angka sebenarnya. */
function openRutinAdjust(rid) {
  const r = findBy('Riwayat_Tagihan', rid); if (!r) return;
  const t = findBy('Tagihan_Rutin', r.TagihanID) || { Nama: 'Tagihan', ID: r.TagihanID };
  const trx = findBy('Transaksi', rutinAutoId(t, r.TglBayar).tid);
  openForm({
    title: 'Sesuaikan Nominal', sub: `${t.Nama} — ${fmtYm(r.Periode, true)}`, icon: 'bi-sliders',
    values: { Nominal: r.Nominal },
    fields: [{ name: 'Nominal', label: 'Nominal sebenarnya (sesuai struk / aplikasi PLN, PDAM, PGN)', type: 'money', required: true, span: 2 }],
    info: `Didebit ke <b>${esc(sourceName(r.DibayarPakai))}</b> pada ${fmtDate(r.TglBayar, true)}. Tagihan kartu kreditnya ikut diperbarui otomatis.`,
    onSubmit: v => {
      const ops = [up('Riwayat_Tagihan', Object.assign({}, r, { Nominal: v.Nominal }))];
      if (trx) ops.push(up('Transaksi', Object.assign({}, trx, { Nominal: v.Nominal, Catatan: 'Auto-debit kartu kredit (tagihan rumah)', Diubah: new Date().toISOString() })));
      commit(ops, 'Nominal disesuaikan');
    }
  });
}

function openPajakAdjust(rid) {
  const r = findBy('Riwayat_Pajak', rid); if (!r) return;
  const v = findBy('Kendaraan', r.KendaraanID) || { ID: r.KendaraanID, Nama: 'Kendaraan', Nopol: '' };
  const five = r.Jenis === '5 Tahunan';
  const trx = findBy('Transaksi', pajakAutoId(v, five, r.TglBayar).tid);
  openForm({
    title: 'Sesuaikan Nominal Pajak', sub: `${five ? 'STNK 5 Tahunan' : 'Pajak Tahunan'} — ${v.Nama}`, icon: 'bi-sliders',
    values: { Nominal: r.Nominal },
    fields: [{ name: 'Nominal', label: 'Nominal sebenarnya (sesuai SIGNAL / notice Samsat)', type: 'money', required: true, span: 2 },
      { name: 'Simpan', label: 'Jadikan perkiraan untuk tahun berikutnya?', type: 'select', span: 2, options: [{ v: 'Ya', l: 'Ya' }, { v: 'Tidak', l: 'Tidak' }] }],
    info: `Didebit ke <b>${esc(sourceName(r.DibayarPakai))}</b> pada ${fmtDate(r.TglBayar, true)}. Tagihan kartu kreditnya ikut diperbarui otomatis.`,
    onSubmit: val => {
      const ops = [up('Riwayat_Pajak', Object.assign({}, r, { Nominal: val.Nominal }))];
      if (trx) ops.push(up('Transaksi', Object.assign({}, trx, { Nominal: val.Nominal, Catatan: 'Auto-debit kartu kredit (pajak kendaraan)', Diubah: new Date().toISOString() })));
      const cur = findBy('Kendaraan', v.ID);
      if (val.Simpan === 'Ya' && cur) ops.push(up('Kendaraan', Object.assign({}, cur, five ? { Nominal5Th: val.Nominal } : { NominalTahunan: val.Nominal })));
      commit(ops, 'Nominal pajak disesuaikan');
    }
  });
}

/* ───────────── AKSI KARTU KREDIT ───────────── */
async function markOverduePaidOutside(cardId) {
  const list = kartuInfo(kartu(cardId)).unpaid.filter(b => daysUntil(b.JatuhTempo) < 0);
  if (!list.length) return;
  const ok = await confirmDialog({ title: `Tandai ${list.length} tagihan lama lunas?`, msg: `Tagihan ${list.map(b => fmtYm(b.Periode)).join(', ')} (total ${rp(list.reduce((s, b) => s + billSisa(b), 0))}) akan ditandai lunas <b>tanpa</b> mencatat pembayaran baru. Pakai hanya jika memang sudah dibayar di luar aplikasi.`, ok: 'Tandai Lunas' });
  if (ok) commit(list.map(b => up('Tagihan_Kartu', Object.assign({}, b, { Dibayar: num(b.Total), Status: 'Lunas', TglBayar: b.TglBayar || today(), DibayarDari: b.DibayarDari || 'Di luar aplikasi' }))), `${list.length} tagihan ditandai lunas`);
}
/** Untuk tagihan lama yang sudah dibayar sebelum memakai aplikasi: tandai lunas tanpa memotong saldo rekening. */
async function markBillPaidOutside(id) {
  const b = findBy('Tagihan_Kartu', id); if (!b) return;
  const ok = await confirmDialog({ title: 'Sudah dibayar di luar aplikasi?', msg: `Tagihan <b>${fmtYm(b.Periode, true)}</b> (${rp(b.Total)}) akan ditandai lunas <b>tanpa</b> mencatat pembayaran baru dan tanpa memotong saldo rekening. Pakai ini hanya untuk tagihan yang memang sudah Anda bayar sebelumnya.`, ok: 'Tandai Lunas' });
  if (ok) commit([up('Tagihan_Kartu', Object.assign({}, b, { Dibayar: num(b.Total), Status: 'Lunas', TglBayar: b.TglBayar || today(), DibayarDari: b.DibayarDari || 'Di luar aplikasi' }))], 'Tagihan ditandai lunas');
}

function openCardPay(cardId) {
  const cards = S.data.Kartu_Kredit.filter(isActive);
  if (!cards.length) { toast('Belum ada kartu kredit. Tambahkan di Pengaturan.', 'warning'); return; }
  const k = kartu(cardId) || cards[0];
  const i = kartuInfo(k), out = i.outstanding, oldest = i.unpaid[0] || null;
  const minDue = i.unpaid.reduce((s, b) => s + Math.min(billSisa(b), num(b.Minimum)), 0);
  const maxPay = out + i.open.total;
  openForm({
    title: 'Bayar Tagihan Kartu Kredit', icon: 'bi-credit-card',
    top: `<div class="bill-box" style="margin:0">
        <div class="kv"><span>${esc(k.Nama)} •••• ${esc(k.Digit4)}</span>${oldest ? `<span class="pill pill-gray">Periode ${fmtYm(oldest.Periode)}${i.unpaid.length > 1 ? ` +${i.unpaid.length - 1}` : ''}</span>` : ''}</div>
        <div class="kv"><span>Sisa tagihan tercetak</span><b class="big">${rp(out)}</b></div>
        ${oldest ? `<div class="kv"><span>Jatuh tempo</span><b>${fmtDate(oldest.JatuhTempo)} ${duePill(daysUntil(oldest.JatuhTempo))}</b></div>` : ''}
        <div class="kv"><span>Belum ditagih (${fmtDate(i.open.start)} – ${fmtDate(i.open.end)})</span><b>${rp(i.open.total)}</b></div>
        ${i.unpaid.length > 1 ? '<div class="hint">Pembayaran dialokasikan ke tagihan terlama lebih dulu.</div>' : ''}
      </div>`,
    values: { KartuID: k.ID, Nominal: out || '', Tanggal: today() },
    fields: [
      { name: 'KartuID', label: 'Kartu', type: 'select', options: cards.map(c => ({ v: c.ID, l: `${c.Nama} •${c.Digit4}` })), span: 2 },
      { name: 'Nominal', label: 'Nominal dibayarkan', type: 'money', required: true, span: 2, hint: `Maks. ${rp(maxPay)}`,
        quick: out ? [{ l: `Tagihan penuh ${rpShort(out)}`, v: out }, { l: `Minimum ${rpShort(minDue)}`, v: minDue }, { l: 'Nominal lain', v: null }] : null, quickOn: true,
        validate: val => val > maxPay + 0.5 ? `Maksimal ${rp(maxPay)} (tagihan + transaksi belum ditagih).` : '' },
      { name: 'DibayarDari', label: 'Dibayar dari', type: 'select', options: sourceOptions(false), required: true },
      { name: 'Tanggal', label: 'Tanggal bayar', type: 'date', required: true },
      { name: 'Catatan', label: 'Catatan / no. referensi', span: 2, placeholder: 'Opsional' },
      { name: 'Bukti', label: 'Bukti bayar', type: 'file' }
    ],
    info: 'Otomatis mencatat transaksi <b>Pembayaran Kartu</b>, memotong saldo rekening terpilih, dan memulihkan limit kartu.',
    submitLabel: 'Konfirmasi Pembayaran',
    onRender: () => { $('#f_KartuID').onchange = e => { closeModal(); openCardPay(e.target.value); }; },
    onSubmit: (v, files) => {
      const card = kartu(v.KartuID), info = kartuInfo(card);
      const trx = { ID: uid('TRX'), Tanggal: v.Tanggal, Jenis: 'Pembayaran Kartu', Kategori: SYS_CAT.ID,
        Keterangan: `Bayar tagihan ${card.Nama}${info.unpaid[0] ? ' ' + fmtYm(info.unpaid[0].Periode) : ''}`, Nominal: v.Nominal, SumberDana: v.DibayarDari,
        Referensi: card.ID, Catatan: v.Catatan, Bukti: '', Dibuat: new Date().toISOString(), Diubah: '' };
      const ops = [up('Transaksi', trx)];
      let rest = num(v.Nominal);
      info.unpaid.forEach(b => {
        if (rest <= 0) return;
        const pay = Math.min(rest, billSisa(b)), dib = num(b.Dibayar) + pay;
        rest -= pay;
        ops.push(up('Tagihan_Kartu', Object.assign({}, b, { Dibayar: dib, TglBayar: v.Tanggal, DibayarDari: v.DibayarDari, Status: dib >= num(b.Total) - 0.5 ? 'Lunas' : 'Sebagian' })));
      });
      commit(ops, 'Pembayaran kartu tercatat — limit dipulihkan');
      uploadBuktiThenPatch(files.Bukti, [{ sheet: 'Transaksi', id: trx.ID }]);
    }
  });
}

function openBillInput(cardId, billId) {
  const k = kartu(cardId); if (!k) return;
  const b = billId ? findBy('Tagihan_Kartu', billId) : null;
  const per = b ? b.Periode : thisYm();
  openForm({
    title: b ? 'Koreksi Tagihan Kartu' : 'Input Tagihan Manual', sub: `${k.Nama} •••• ${k.Digit4}`, icon: 'bi-receipt',
    values: b ? b : { Periode: per, JatuhTempo: billDueDate(k, per) },
    fields: [
      { name: 'Periode', label: 'Periode (bulan cetak)', type: 'month', required: true },
      { name: 'JatuhTempo', label: 'Jatuh tempo', type: 'date', required: true },
      { name: 'Total', label: 'Total tagihan', type: 'money', required: true },
      { name: 'Minimum', label: 'Tagihan minimum', type: 'money', hint: 'Kosongkan = 10%' }
    ],
    info: `Tagihan dibuat <b>otomatis</b> dari transaksi kartu setiap tgl ${k.TglCetak} (jatuh tempo tgl ${k.TglJatuhTempo}). Ubah di sini hanya bila lembar tagihan bank berbeda (bunga, biaya, transaksi sebelum memakai aplikasi) — angka manual tidak akan ditimpa.`,
    extraFoot: b && b.Sumber !== 'Otomatis' ? `<button type="button" class="btn btn-ghost" style="margin-right:auto" onclick="commit([up('Tagihan_Kartu', Object.assign({}, findBy('Tagihan_Kartu','${b.ID}'), {Sumber:'Otomatis'}))],'Tagihan kembali dihitung otomatis'); closeModal()"><i class="bi bi-arrow-repeat"></i> Hitung otomatis lagi</button>` : '',
    onRender: () => { $('#f_Periode').onchange = e => { $('#f_JatuhTempo').value = billDueDate(k, e.target.value); }; },
    onSubmit: v => {
      const dup = S.data.Tagihan_Kartu.find(x => x.KartuID === k.ID && x.Periode === v.Periode && (!b || x.ID !== b.ID));
      if (dup) return 'Tagihan periode ini sudah ada. Ubah tagihan yang ada.';
      const dibayar = b ? num(b.Dibayar) : 0;
      const rec = { ID: b ? b.ID : `TGK-${k.ID}-${v.Periode}`, KartuID: k.ID, Periode: v.Periode, Total: v.Total,
        Minimum: v.Minimum || Math.round(v.Total * 0.1), JatuhTempo: v.JatuhTempo,
        Status: dibayar >= v.Total ? 'Lunas' : dibayar > 0 ? 'Sebagian' : 'Belum', TglBayar: b ? b.TglBayar : '', Dibayar: dibayar, DibayarDari: b ? b.DibayarDari : '', Sumber: 'Manual' };
      commit([up('Tagihan_Kartu', rec)], 'Tagihan kartu tersimpan');
    }
  });
}

function openCicilanForm(id, cardId) {
  const c = id ? findBy('Cicilan', id) : null;
  const cards = S.data.Kartu_Kredit.filter(isActive);
  if (!cards.length) { toast('Tambahkan kartu kredit terlebih dahulu.', 'warning'); return; }
  openForm({
    title: c ? 'Ubah Cicilan' : 'Tambah Cicilan Baru', icon: 'bi-bag-check',
    values: c || { KartuID: cardId || cards[0].ID, Tenor: 12, BulanMulai: thisYm() },
    fields: [
      { name: 'KartuID', label: 'Kartu kredit', type: 'select', required: true, span: 2, options: cards.map(k => ({ v: k.ID, l: `${k.Nama} •${k.Digit4}` })) },
      { name: 'Barang', label: 'Nama barang', required: true, span: 2, placeholder: 'Contoh: Laptop', maxlength: 80 },
      { name: 'HargaTotal', label: 'Harga total', type: 'money', required: true },
      { name: 'Tenor', label: 'Tenor (bulan)', type: 'number', required: true, min: 1, max: 60 },
      { name: 'PerBulan', label: 'Cicilan per bulan', type: 'money', required: true, hint: 'Otomatis' },
      { name: 'BulanMulai', label: 'Bulan mulai', type: 'month', required: true },
      { name: 'Catatan', label: 'Catatan', span: 2, placeholder: 'Opsional, mis. 0% bunga' }
    ],
    info: 'Sisa bulan dan sisa pokok dihitung otomatis setiap tanggal cetak tagihan kartu.',
    extraFoot: c ? `<button type="button" class="btn btn-ghost" style="margin-right:auto;color:var(--danger-ink)" onclick="deleteRow('Cicilan','${c.ID}','cicilan ${jsq(c.Barang)}')"><i class="bi bi-trash"></i> Hapus</button>` : '',
    onRender: () => {
      const calc = () => { const h = parseMoney($('#f_HargaTotal').value), t = num($('#f_Tenor').value); if (h && t) $('#f_PerBulan').value = fmtMoneyInput(Math.round(h / t)); };
      $('#f_HargaTotal').addEventListener('input', calc); $('#f_Tenor').addEventListener('input', calc);
    },
    onSubmit: v => {
      const rec = Object.assign({}, c || {}, v, { ID: c ? c.ID : uid('CCL'), Status: 'Berjalan' });
      commit([up('Cicilan', rec)], c ? 'Cicilan diperbarui' : 'Cicilan ditambahkan');
    }
  });
}

/* ───────────── TANDAI LUNAS (langganan, tagihan rumah, pajak) ───────────── */
function payReminder(key) {
  const r = getReminders().find(x => x.key === key);
  if (!r) return;
  if (r.type === 'kartu') { const b = findBy('Tagihan_Kartu', r.id); openCardPay(b && b.KartuID); return; }
  if (r.type === 'input-kartu') { openBillInput(r.id); return; }
  openMarkPaid(r.type, r.id, r.sub2);
}

function openMarkPaid(type, id, jenisPajak) {
  let item, title, est, info, next, src, sheet, est2 = null;
  sheet = { langganan: 'Langganan', rutin: 'Tagihan_Rutin', pajak: 'Kendaraan' }[type];
  if (!sheet || !findBy(sheet, id)) { toast('Data tidak ditemukan.', 'error'); return; }
  if (type === 'langganan') {
    sheet = 'Langganan'; item = findBy(sheet, id); est = num(item.Nominal);
    next = addMonths(item.TglTagih || today(), item.Siklus === 'Tahunan' ? 12 : 1);
    title = `${item.Nama} — ${fmtYm(ym(item.TglTagih))}`; src = item.DibayarPakai;
    info = `Perpanjangan berikutnya otomatis maju ke <b>${fmtDate(next, true)}</b> dan pengeluaran ${item.Siklus === 'Tahunan' ? 'tahunan' : 'bulanan'} tercatat di Transaksi.`;
  } else if (type === 'rutin') {
    sheet = 'Tagihan_Rutin'; item = findBy(sheet, id); est2 = estimasiRutin(item); est = est2.val;
    next = addMonths(item.JatuhTempo || today(), item.Siklus === 'Tahunan' ? 12 : 1);
    title = `${item.Nama} — ${fmtYm(ym(item.JatuhTempo))}`; src = item.DibayarPakai;
    info = `Jatuh tempo berikutnya otomatis maju ke <b>${fmtDate(next, true)}</b>. Pengeluaran tercatat di Transaksi.`;
  } else {
    sheet = 'Kendaraan'; item = findBy(sheet, id);
    const five = jenisPajak === '5Th';
    est = num(five ? item.Nominal5Th : item.NominalTahunan);
    const cur = five ? item.JatuhTempo5Th : item.JatuhTempoTahunan;
    next = addMonths(cur || today(), five ? 60 : 12);
    title = `${five ? 'STNK 5 Tahunan' : 'Pajak Tahunan'} — ${item.Nama}`; src = '';
    info = five
      ? `Jatuh tempo STNK maju <b>+5 tahun</b> ke ${fmtDate(next, true)}. Bila pajak tahunan jatuh tempo di bulan yang sama, ikut maju +1 tahun.`
      : `Jatuh tempo pajak tahunan maju <b>+1 tahun</b> ke ${fmtDate(next, true)}.`;
  }
  if (!item) return;
  const quick = est ? [{ l: `Sesuai estimasi: ${rp(est)}`, v: est }, { l: 'Kustom', v: null }] : null;

  openForm({
    title: 'Tandai Lunas', sub: title, icon: 'bi-check2-circle',
    values: { Nominal: est, Tanggal: today(), DibayarPakai: src },
    fields: [
      { name: 'Nominal', label: 'Nominal aktual yang dibayarkan', type: 'money', required: true, span: 2, quick, quickOn: true,
        hint: est2 && est2.n ? `Rata-rata ${est2.n} bln: ${rpShort(est2.min)}–${rpShort(est2.max)}` : '' },
      { name: 'Tanggal', label: 'Tanggal pembayaran', type: 'date', required: true },
      { name: 'DibayarPakai', label: 'Dibayar pakai', type: 'select', required: true, options: sourceOptions(true) },
      { name: 'Bukti', label: 'Upload bukti bayar / struk', type: 'file' }
    ],
    info, submitLabel: 'Konfirmasi & Tandai Lunas',
    onSubmit: (v, files) => {
      const katName = type === 'langganan' ? 'Hiburan & Langganan' : type === 'rutin' ? 'Tagihan Rumah' : 'Pajak & Kendaraan';
      const trx = { ID: uid('TRX'), Tanggal: v.Tanggal, Jenis: 'Pengeluaran', Kategori: catByName(katName),
        Keterangan: title, Nominal: v.Nominal, SumberDana: v.DibayarPakai, Referensi: item.ID, Catatan: 'Dicatat dari Tandai Lunas',
        Bukti: '', Dibuat: new Date().toISOString(), Diubah: '' };
      const ops = [up('Transaksi', trx)];
      const patch = [{ sheet: 'Transaksi', id: trx.ID }];
      if (type === 'langganan') {
        ops.push(up('Langganan', Object.assign({}, item, { TglTagih: next })));
      } else if (type === 'rutin') {
        const rid = uid('RTG');
        ops.push(up('Riwayat_Tagihan', { ID: rid, TagihanID: item.ID, Periode: ym(item.JatuhTempo), TglBayar: v.Tanggal, Nominal: v.Nominal, DibayarPakai: v.DibayarPakai, Bukti: '' }));
        ops.push(up('Tagihan_Rutin', Object.assign({}, item, { JatuhTempo: next })));
        patch.push({ sheet: 'Riwayat_Tagihan', id: rid });
      } else {
        const five = jenisPajak === '5Th';
        const rid = uid('RPJ');
        const upd = Object.assign({}, item);
        if (five) {
          upd.JatuhTempo5Th = next;
          if (Math.abs(daysUntil(item.JatuhTempoTahunan) - daysUntil(item.JatuhTempo5Th)) <= 31) upd.JatuhTempoTahunan = addMonths(item.JatuhTempoTahunan, 12);
        } else upd.JatuhTempoTahunan = next;
        ops.push(up('Riwayat_Pajak', { ID: rid, KendaraanID: item.ID, Jenis: five ? '5 Tahunan' : 'Tahunan', TglBayar: v.Tanggal, Nominal: v.Nominal, DibayarPakai: v.DibayarPakai, Bukti: '' }));
        ops.push(up('Kendaraan', upd));
        patch.push({ sheet: 'Riwayat_Pajak', id: rid });
      }
      commit(ops, 'Ditandai lunas — jatuh tempo berikutnya diperbarui');
      uploadBuktiThenPatch(files.Bukti, patch);
    }
  });
}

/* ───────────── CRUD MASTER DATA ───────────── */
const STATUS_OPTS = [{ v: 'Aktif', l: 'Aktif' }, { v: 'Nonaktif', l: 'Nonaktif' }];
const FORMS = {
  Akun: { title: 'Akun & Dompet', icon: 'bi-wallet2', prefix: 'AKN', fields: [
    { name: 'Nama', label: 'Nama akun', required: true, placeholder: 'Contoh: BCA', maxlength: 40 },
    { name: 'Tipe', label: 'Tipe', type: 'select', options: ['Bank', 'Tunai', 'E-wallet'].map(x => ({ v: x, l: x })) },
    { name: 'SaldoAwal', label: 'Saldo awal', type: 'money', hint: 'Saldo saat mulai mencatat' },
    { name: 'Status', label: 'Status', type: 'select', options: STATUS_OPTS }] },
  Kartu_Kredit: { title: 'Kartu Kredit', icon: 'bi-credit-card', prefix: 'KRT', fields: [
    { name: 'Nama', label: 'Nama kartu', required: true, placeholder: 'Contoh: BCA Everyday', maxlength: 40 },
    { name: 'Bank', label: 'Bank', required: true, placeholder: 'Contoh: BCA', maxlength: 30 },
    { name: 'Digit4', label: '4 digit terakhir', required: true, maxlength: 4, placeholder: '1234', validate: v => /^\d{4}$/.test(v) ? '' : 'Harus tepat 4 angka.' },
    { name: 'Limit', label: 'Limit kartu', type: 'money', required: true },
    { name: 'TglCetak', label: 'Tanggal cetak tagihan', type: 'number', min: 1, max: 31, required: true, default: 5 },
    { name: 'TglJatuhTempo', label: 'Tanggal jatuh tempo (maks. bayar)', type: 'number', min: 1, max: 31, required: true, default: 25 },
    { name: 'Pengingat', label: 'Ingatkan (hari sebelum)', type: 'number', min: 1, max: 60, default: 7 },
    { name: 'Status', label: 'Status', type: 'select', options: STATUS_OPTS },
    { name: 'Desain', label: 'Desain kartu', type: 'select', span: 2, default: 'auto', options: [
      { v: 'auto', l: 'Otomatis (dikenali dari nama kartu)' }, { v: 'mandiri-jcb', l: 'Mandiri JCB Precious' },
      { v: 'mandiri-pertamina', l: 'Mandiri Pertamina Platinum' }, { v: 'polos', l: 'Polos (hitam-oranye)' }] }],
    info: 'Demi keamanan, aplikasi hanya menyimpan 4 digit terakhir — tanpa nomor lengkap, CVV, atau masa berlaku.' },
  Kategori: { title: 'Kategori', icon: 'bi-tags', prefix: 'KAT', fields: [
    { name: 'Nama', label: 'Nama kategori', required: true, maxlength: 40 },
    { name: 'Jenis', label: 'Jenis', type: 'select', options: [{ v: 'Pengeluaran', l: 'Pengeluaran' }, { v: 'Pemasukan', l: 'Pemasukan' }] },
    { name: 'Warna', label: 'Warna', type: 'color', default: '#FF7A00' },
    { name: 'Anggaran', label: 'Anggaran per bulan', type: 'money', hint: 'Opsional' },
    { name: 'Ikon', label: 'Ikon', type: 'icon', default: 'bi-tag' },
    { name: 'Status', label: 'Status', type: 'select', options: STATUS_OPTS }] },
  Kendaraan: { title: 'Kendaraan', icon: 'bi-car-front', prefix: 'KND', fields: [
    { name: 'Nama', label: 'Nama kendaraan', required: true, placeholder: 'Contoh: Honda Vario', maxlength: 40 },
    { name: 'Jenis', label: 'Jenis', type: 'select', options: [{ v: 'Motor', l: 'Motor' }, { v: 'Mobil', l: 'Mobil' }] },
    { name: 'Nopol', label: 'Nomor polisi', required: true, placeholder: 'DT 1234 AB', maxlength: 15 },
    { name: 'Pengingat', label: 'Ingatkan (hari sebelum)', type: 'number', min: 1, max: 90, default: 14 },
    { name: 'JatuhTempoTahunan', label: 'Jatuh tempo pajak tahunan', type: 'date', required: true },
    { name: 'NominalTahunan', label: 'Perkiraan pajak tahunan', type: 'money' },
    { name: 'JatuhTempo5Th', label: 'Jatuh tempo STNK 5 tahunan', type: 'date' },
    { name: 'Nominal5Th', label: 'Perkiraan biaya 5 tahunan', type: 'money' },
    { name: 'DibayarPakai', label: 'Dibayar pakai', type: 'select', optionsFn: () => [{ v: '', l: 'Pilih saat bayar (manual)' }].concat(sourceOptions(true)), hint: 'Kartu kredit = auto-debit' },
    { name: 'Status', label: 'Status', type: 'select', options: STATUS_OPTS }] },
  Langganan: { title: 'Langganan', icon: 'bi-play-btn', prefix: 'LGN', fields: [
    { name: 'Nama', label: 'Nama layanan', required: true, placeholder: 'Contoh: Netflix', maxlength: 40 },
    { name: 'Keterangan', label: 'Keterangan', placeholder: 'Contoh: Streaming', maxlength: 60 },
    { name: 'Nominal', label: 'Biaya', type: 'money', required: true },
    { name: 'Siklus', label: 'Siklus', type: 'select', options: [{ v: 'Bulanan', l: 'Bulanan' }, { v: 'Tahunan', l: 'Tahunan' }] },
    { name: 'TglTagih', label: 'Perpanjangan berikutnya', type: 'date', required: true },
    { name: 'DibayarPakai', label: 'Dibayar pakai', type: 'select', optionsFn: () => sourceOptions(true) },
    { name: 'Pengingat', label: 'Ingatkan (hari sebelum)', type: 'number', min: 1, max: 60, default: 7 },
    { name: 'Status', label: 'Status', type: 'select', options: [{ v: 'Aktif', l: 'Aktif' }, { v: 'Berhenti', l: 'Berhenti' }] }] },
  Tagihan_Rutin: { title: 'Tagihan Rumah', icon: 'bi-house-door', prefix: 'TGR', fields: [
    { name: 'Nama', label: 'Nama tagihan', required: true, placeholder: 'Contoh: Listrik PLN', maxlength: 40 },
    { name: 'Jenis', label: 'Jenis', type: 'select', options: ['PBB', 'PDAM', 'PLN', 'Gas', 'Lainnya'].map(x => ({ v: x, l: x })) },
    { name: 'NoPelanggan', label: 'No. pelanggan / NOP', maxlength: 40 },
    { name: 'Siklus', label: 'Siklus', type: 'select', options: [{ v: 'Bulanan', l: 'Bulanan' }, { v: 'Tahunan', l: 'Tahunan (mis. PBB)' }] },
    { name: 'JatuhTempo', label: 'Jatuh tempo berikutnya', type: 'date', required: true },
    { name: 'Perkiraan', label: 'Perkiraan nominal', type: 'money', hint: 'Dipakai sampai ada riwayat' },
    { name: 'DibayarPakai', label: 'Dibayar pakai', type: 'select', optionsFn: () => sourceOptions(true), hint: 'Kartu kredit = auto-debit' },
    { name: 'Prabayar', label: 'Listrik prabayar (token)?', type: 'select', options: [{ v: 'Tidak', l: 'Tidak' }, { v: 'Ya', l: 'Ya — pengingat isi token' }] },
    { name: 'Pengingat', label: 'Ingatkan (hari sebelum)', type: 'number', min: 1, max: 60, default: 7 },
    { name: 'Status', label: 'Status', type: 'select', options: STATUS_OPTS }] }
};

function openCrud(sheet, id) {
  const cfg = FORMS[sheet];
  const rec = id ? findBy(sheet, id) : null;
  const fields = cfg.fields.map(f => f.optionsFn ? Object.assign({}, f, { options: f.optionsFn() }) : f);
  openForm({
    title: (rec ? 'Ubah ' : 'Tambah ') + cfg.title, sub: rec ? rec.ID : '', icon: cfg.icon, fields,
    values: rec || {}, info: cfg.info,
    extraFoot: rec ? `<button type="button" class="btn btn-ghost" style="margin-right:auto;color:var(--danger-ink)" onclick="deleteRow('${sheet}','${rec.ID}','${jsq(rec.Nama || '')}')"><i class="bi bi-trash"></i> Hapus</button>` : '',
    onSubmit: v => {
      const out = Object.assign({}, rec || {}, v, { ID: rec ? rec.ID : uid(cfg.prefix) });
      if (!out.Status) out.Status = 'Aktif';
      commit([up(sheet, out)], `${cfg.title} ${rec ? 'diperbarui' : 'ditambahkan'}`);
    }
  });
}

function usageCount(sheet, id) {
  const T = S.data.Transaksi;
  if (sheet === 'Akun') return T.filter(t => t.SumberDana === id).length;
  if (sheet === 'Kartu_Kredit') return T.filter(t => t.SumberDana === id || t.Referensi === id).length + S.data.Cicilan.filter(c => c.KartuID === id).length;
  if (sheet === 'Kategori') return T.filter(t => t.Kategori === id).length;
  return 0;
}

async function deleteRow(sheet, id, label) {
  const used = usageCount(sheet, id);
  if (used) {
    const ok = await confirmDialog({ title: 'Data sedang dipakai', msg: `<b>${esc(label)}</b> dipakai di ${used} catatan. Menghapusnya akan membuat riwayat kehilangan rujukan. Nonaktifkan saja agar riwayat tetap utuh?`, ok: 'Nonaktifkan' });
    if (ok) commit([up(sheet, Object.assign({}, findBy(sheet, id), { Status: 'Nonaktif' }))], 'Dinonaktifkan');
    return;
  }
  const ok = await confirmDialog({ title: 'Hapus data ini?', msg: `<b>${esc(label)}</b> akan dihapus permanen dari database.`, ok: 'Hapus', danger: true });
  if (!ok) return;
  const ops = [del(sheet, id)];
  if (sheet === 'Kartu_Kredit') S.data.Tagihan_Kartu.filter(b => b.KartuID === id).forEach(b => ops.push(del('Tagihan_Kartu', b.ID)));
  if (sheet === 'Tagihan_Rutin') S.data.Riwayat_Tagihan.filter(r => r.TagihanID === id).forEach(r => ops.push(del('Riwayat_Tagihan', r.ID)));
  if (sheet === 'Kendaraan') S.data.Riwayat_Pajak.filter(r => r.KendaraanID === id).forEach(r => ops.push(del('Riwayat_Pajak', r.ID)));
  if (sheet === 'Kartu_Kredit' && S.page === 'kartuDetail') navigateTo('kartu');
  commit(ops, 'Data dihapus');
}

function saveSetting(k, v) {
  commit([up('Pengaturan', { Kunci: k, Nilai: String(v) })]);
}

/* ───────────── GRAFIK ───────────── */
function destroyChart(key) { if (S.charts[key]) { S.charts[key].destroy(); S.charts[key] = null; } }
function chartBase() {
  Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
  Chart.defaults.color = cssVar('--text-2');
}
function lastMonths(n) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(ymAdd(thisYm(), -i)); return out; }

function drawBar(key, canvasId, months) {
  destroyChart(key);
  const el = document.getElementById(canvasId); if (!el || !window.Chart) return;
  chartBase();
  const inc = months.map(m => monthTotals(m).inc), exp = months.map(m => monthTotals(m).exp);
  const expColor = document.documentElement.getAttribute('data-theme') === 'dark' ? '#8C8C94' : '#3A3A3A';
  S.charts[key] = new Chart(el, {
    type: 'bar',
    data: { labels: months.map(m => BULAN[Number(m.slice(5)) - 1]),
      datasets: [
        { label: 'Pemasukan', data: inc, backgroundColor: '#FF7A00', borderRadius: 8, maxBarThickness: 26 },
        { label: 'Pengeluaran', data: exp, backgroundColor: expColor, borderRadius: 8, maxBarThickness: 26 }
      ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false },
        tooltip: { backgroundColor: '#121212', padding: 12, cornerRadius: 12, titleFont: { weight: '700' },
          callbacks: { label: c => ` ${c.dataset.label}: ${rp(c.parsed.y)}`, footer: items => `Selisih: ${rp(items[0].parsed.y - (items[1] ? items[1].parsed.y : 0))}` } } },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: { beginAtZero: true, border: { display: false }, grid: { color: cssVar('--border') }, ticks: { callback: v => rpShort(v).replace('Rp ', '') } }
      }
    }
  });
}

function drawDonut(key, canvasId, rows) {
  destroyChart(key);
  const el = document.getElementById(canvasId); if (!el || !window.Chart) return;
  chartBase();
  S.charts[key] = new Chart(el, {
    type: 'doughnut',
    data: { labels: rows.map(r => r.nama), datasets: [{ data: rows.map(r => r.total), backgroundColor: rows.map(r => r.warna), borderWidth: 3, borderColor: cssVar('--surface'), hoverOffset: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '72%', animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: '#121212', padding: 10, cornerRadius: 10, callbacks: { label: c => ` ${c.label}: ${rp(c.parsed)}` } } } }
  });
}

function catRows(m, limit) {
  const map = expenseByCat(m);
  let rows = Object.keys(map).map(id => { const c = catInfo(id); return { id, nama: c.Nama, warna: c.Warna || '#A1A1AA', ikon: c.Ikon, total: map[id].total, n: map[id].n }; })
    .sort((a, b) => b.total - a.total);
  if (limit && rows.length > limit) {
    const rest = rows.slice(limit - 1);
    rows = rows.slice(0, limit - 1).concat([{ id: 'other', nama: 'Lainnya', warna: '#C9C9CF', total: rest.reduce((s, r) => s + r.total, 0), n: rest.reduce((s, r) => s + r.n, 0) }]);
  }
  const sum = rows.reduce((s, r) => s + r.total, 0);
  rows.forEach(r => { r.pct = sum ? Math.round(r.total / sum * 1000) / 10 : 0; });
  return { rows, sum };
}

function legendHtml(rows) {
  return `<div class="legend">${rows.map(r => `<div class="legend-row"><i class="sw" style="background:${esc(r.warna)}"></i><span class="nm">${esc(r.nama)}</span><span class="vl">${rp(r.total)}</span><span class="pc">${r.pct}%</span></div>`).join('')}</div>`;
}

/* ───────────── HALAMAN: DASHBOARD ───────────── */
function renderDashboard() {
  const m = thisYm(), prev = ymAdd(m, -1);
  const t = monthTotals(m), tp = monthTotals(prev);
  const saldo = totalSaldo();
  const rem = getReminders();
  const dueTotal = rem.filter(r => r.amount != null && r.days <= 7).reduce((s, r) => s + r.amount, 0);
  const trend = tp.inc ? Math.round((t.inc - tp.inc) / tp.inc * 1000) / 10 : null;
  const expRatio = t.inc ? Math.round(t.exp / t.inc * 100) : 0;
  const savingRate = t.inc ? Math.round(t.net / t.inc * 1000) / 10 : 0;
  const cards = S.data.Kartu_Kredit.filter(isActive);
  const cicilan = S.data.Cicilan.map(c => Object.assign({ c }, cicilanInfo(c))).filter(x => !x.lunas);
  const sisaPokok = cicilan.reduce((s, x) => s + x.sisaPokok, 0);
  const langg = S.data.Langganan.filter(isActive);
  const langBulan = langg.reduce((s, l) => s + (l.Siklus === 'Tahunan' ? num(l.Nominal) / 12 : num(l.Nominal)), 0);
  const cat = catRows(m, 5);
  const months = lastMonths(6);
  const avgInc = months.reduce((s, x) => s + monthTotals(x).inc, 0) / 6, avgExp = months.reduce((s, x) => s + monthTotals(x).exp, 0) / 6;
  const nama = setting('namaPemilik', 'Pemilik');
  const insight = buildInsight(t, tp, cat, rem);

  $('#page-dashboard').innerHTML = `
    <div class="page-head">
      <div>
        <span class="eyebrow"><i class="bi bi-stars"></i> Halo, ${esc(nama)}</span>
        <h1>Dashboard Keuangan</h1>
        <p>Ringkasan posisi keuangan, tagihan, dan pengingat aktif — ${fmtYm(m, true)}.</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-secondary" onclick="openDrawer()"><i class="bi bi-bell"></i> Pengingat (${rem.length})</button>
        <button class="btn btn-dark" onclick="navigateTo('laporan')"><i class="bi bi-bar-chart-line"></i> Laporan</button>
      </div>
    </div>

    <div class="grid g-4 pair-sm">
      <div class="card card-dark">
        <div class="stat-top"><span class="stat-label">Total saldo terkonsolidasi</span><i class="bi bi-bank" style="color:var(--primary)"></i></div>
        <div class="stat-value">${money(saldo)}</div>
        <div class="chips">${S.data.Akun.filter(isActive).map(a => `<span class="chip-acc">${esc(a.Nama)}: ${rpShort(saldoAkun(a))}</span>`).join('') || '<span class="chip-acc">Belum ada akun</span>'}</div>
      </div>
      <div class="card">
        <div class="stat-top"><span class="stat-label">Pemasukan bulan ini</span><span class="ic-sq sm ic-ok"><i class="bi bi-arrow-down-left"></i></span></div>
        <div class="stat-value">${money(t.inc)}</div>
        <div class="stat-foot">${trend != null ? `<span class="pill ${trend >= 0 ? 'pill-ok' : 'pill-bad'}"><i class="bi bi-graph-${trend >= 0 ? 'up' : 'down'}-arrow"></i> ${trend > 0 ? '+' : ''}${trend}%</span><span>dari bulan lalu</span>` : `<span>${t.nIn} transaksi masuk</span>`}</div>
      </div>
      <div class="card">
        <div class="stat-top"><span class="stat-label">Pengeluaran bulan ini</span><span class="ic-sq sm ic-bad"><i class="bi bi-arrow-up-right"></i></span></div>
        <div class="stat-value">${money(t.exp)}</div>
        <div class="stat-foot"><span>${expRatio}% dari pemasukan</span><div class="bar dark" style="width:80px"><span style="width:${Math.min(100, expRatio)}%"></span></div></div>
      </div>
      <div class="card span-m">
        <div class="stat-top"><span class="stat-label">Selisih (net cash flow)</span><span class="ic-sq sm"><i class="bi bi-piggy-bank"></i></span></div>
        <div class="stat-value accent">${t.net >= 0 ? '+' : ''}${money(t.net)}</div>
        <div class="stat-foot"><span class="pill ${t.net >= 0 ? 'pill-ok' : 'pill-bad'} pill-dot">${t.net >= 0 ? 'Surplus' : 'Defisit'}</span><span>Rasio tabungan ${savingRate}%</span></div>
      </div>
    </div>

    <div class="grid g-2-1">
      <div class="card">
        <div class="card-head">
          <div><h3>Tren Arus Kas (6 Bulan)</h3><p>Pemasukan vs pengeluaran riil</p></div>
          <div class="legend-inline"><span><i style="background:#FF7A00"></i>Pemasukan</span><span><i style="background:var(--ink-2)"></i>Pengeluaran</span></div>
        </div>
        <div class="chart-box"><canvas id="dashBar" aria-label="Grafik pemasukan dan pengeluaran 6 bulan" role="img"></canvas></div>
        <div class="grid g-3" style="margin:18px 0 0;background:var(--surface-2);border-radius:14px;padding:14px 16px;gap:12px">
          <div><div class="hint">Rata-rata pemasukan</div><b class="num">${rp(avgInc)}</b></div>
          <div><div class="hint">Rata-rata pengeluaran</div><b class="num">${rp(avgExp)}</b></div>
          <div><div class="hint">Tingkat tabungan (bulan ini)</div><b style="color:var(--success-ink)">${savingRate}%</b></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head">
          <div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-bell"></i></span><div><h3>Pengingat Terdekat</h3><p>Jatuh tempo dalam jarak pengingat</p></div></div>
          ${rem.length ? `<span class="pill pill-warn pill-dot">${rem.length}</span>` : ''}
        </div>
        ${rem.length ? `<div class="r-list">${rem.slice(0, 4).map(r => reminderRow(r, true)).join('')}</div>
          ${dueTotal ? `<div class="callout" style="margin-top:14px"><i class="bi bi-exclamation-circle"></i><div style="flex:1">Total jatuh tempo ≤ 7 hari: <b>${rp(dueTotal)}</b></div></div>` : ''}
          <button class="btn-link" style="margin-top:10px" onclick="openDrawer()">Lihat semua pengingat <i class="bi bi-arrow-right"></i></button>`
          : emptyState('bi-emoji-smile', 'Semua aman', 'Tidak ada tagihan yang mendekati jatuh tempo.')}
      </div>
    </div>

    <div class="grid g-2-1">
      <div class="card">
        <div class="card-head"><div><h3>Ringkasan Kartu Kredit</h3><p>${cards.length} kartu aktif</p></div><button class="btn-link" onclick="navigateTo('kartu')">Kelola kartu <i class="bi bi-chevron-right"></i></button></div>
        ${cards.length ? `<div class="grid g-2 stack-sm" style="margin:0">${cards.map(k => {
          const i = kartuInfo(k), b = i.bill;
          return `<div class="subbox">
            <div class="kv" style="padding:0"><b style="font-size:15px;text-align:left">${esc(k.Nama)}<br><small class="muted" style="font-weight:500">•••• ${esc(k.Digit4)}</small></b>
              ${b ? (b.Status === 'Lunas' ? '<span class="pill pill-ok">Lunas</span>' : `<span class="pill pill-warn">${b.Status === 'Sebagian' ? 'Sebagian' : 'Belum Lunas'}</span>`) : '<span class="pill pill-gray">Belum ada tagihan</span>'}</div>
            <div class="kv"><span>Pemakaian ${i.pct}%</span><b>${rpShort(i.pakai)} / ${rpShort(i.limit)}</b></div>
            <div class="bar ${i.pct > 80 ? 'bad' : ''}"><span style="width:${i.pct}%"></span></div>
            <hr class="divider">
            <div class="kv"><span>Tagihan ${b ? fmtYm(b.Periode) : ''}</span><b>${b ? rp(b.Total) : '—'}</b></div>
            ${b && b.Status !== 'Lunas' ? `<div class="kv"><span>Jatuh tempo ${fmtDate(b.JatuhTempo)}</span><button class="btn btn-dark btn-xs" onclick="openCardPay('${k.ID}')">Bayar</button></div>` : ''}
          </div>`; }).join('')}</div>`
          : emptyState('bi-credit-card', 'Belum ada kartu', 'Tambahkan kartu kredit untuk memantau tagihan & cicilan.', `<button class="btn btn-primary" onclick="openCrud('Kartu_Kredit')"><i class="bi bi-plus-lg"></i> Tambah Kartu</button>`)}
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Kategori Belanja</h3><p>${fmtYm(m, true)}</p></div></div>
        ${cat.rows.length ? `<div class="donut-wrap"><canvas id="dashDonut" aria-label="Diagram pengeluaran per kategori" role="img"></canvas>
          <div class="donut-center"><div><small>TOTAL</small><b>${rpShort(cat.sum).replace('Rp ', '')}</b></div></div></div>${legendHtml(cat.rows)}`
          : emptyState('bi-pie-chart', 'Belum ada pengeluaran', 'Catat pengeluaran untuk melihat distribusinya.')}
      </div>
    </div>

    <div class="grid g-2 stack-sm">
      <div class="card">
        <div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ink"><i class="bi bi-hourglass-split"></i></span><div><h3>Sisa Cicilan Berjalan</h3><p>${cicilan.length} komitmen aktif</p></div></div></div>
        <div class="kv"><span>Total sisa pokok</span><b class="big">${rp(sisaPokok)}</b></div>
        <div style="margin:10px 0 14px">${cicilan.slice(0, 3).map(x => `<div class="kv"><span><i class="bi bi-bag"></i> ${esc(x.c.Barang)}</span><b>${x.paid}/${x.tenor} bln • ${rpShort(x.sisaPokok)}</b></div>`).join('') || '<p class="muted" style="margin:0">Tidak ada cicilan berjalan.</p>'}</div>
        <button class="btn btn-secondary w-100" onclick="navigateTo('kartu')">Lihat daftar cicilan <i class="bi bi-arrow-right"></i></button>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-arrow-repeat"></i></span><div><h3>Langganan Digital Aktif</h3><p>${langg.length} layanan</p></div></div></div>
        <div class="kv"><span>Beban rutin per bulan</span><b class="big">${rp(langBulan)}</b></div>
        <div class="chips" style="margin:12px 0 16px">${langg.slice(0, 6).map(l => `<span class="pill pill-gray">${esc(l.Nama)} (${rpShort(l.Nominal)})</span>`).join('') || '<span class="muted">Belum ada langganan.</span>'}</div>
        <button class="btn btn-secondary w-100" onclick="S.tagihanTab='langganan'; navigateTo('tagihan')">Kelola langganan <i class="bi bi-arrow-right"></i></button>
      </div>
    </div>
    ${insight ? `<div class="insight"><i class="bi bi-lightbulb"></i><div>${insight}</div></div>` : ''}`;

  drawBar('dashBar', 'dashBar', months);
  if (cat.rows.length) drawDonut('dashDonut', 'dashDonut', cat.rows);
}

function buildInsight(t, tp, cat, rem) {
  const parts = [];
  if (t.inc) parts.push(t.net >= 0 ? `Arus kas bulan ini <b>surplus ${rp(t.net)}</b>.` : `Pengeluaran bulan ini <b>melebihi pemasukan ${rp(-t.net)}</b>.`);
  if (cat.rows[0]) parts.push(`Pengeluaran terbesar ada di <b>${esc(cat.rows[0].nama)}</b> (${cat.rows[0].pct}%).`);
  if (tp.exp && t.exp) {
    const d = Math.round((t.exp - tp.exp) / tp.exp * 100);
    parts.push(d > 0 ? `Pengeluaran naik ${d}% dibanding bulan lalu.` : `Pengeluaran turun ${-d}% dibanding bulan lalu.`);
  }
  const late = rem.filter(r => r.days < 0).length;
  if (late) parts.push(`<b style="color:var(--danger-ink)">${late} tagihan terlambat</b> — segera dibayar.`);
  return parts.join(' ');
}

/* ───────────── HALAMAN: TRANSAKSI ───────────── */
function renderTransaksi() {
  const f = S.trx;
  const allCats = S.data.Kategori.concat([SYS_CAT]);
  $('#page-transaksi').innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow">Buku kas &amp; ledger</span><h1>Daftar Transaksi</h1><p>Rekap pemasukan, pengeluaran, dan pembayaran kartu.</p></div>
      <div class="head-actions">
        <button class="btn btn-secondary" onclick="exportTrx('xlsx')"><i class="bi bi-file-earmark-spreadsheet"></i> Unduh Excel</button>
        <button class="btn btn-secondary" onclick="exportTrx('pdf')"><i class="bi bi-file-earmark-pdf"></i> Unduh PDF</button>
        <button class="btn btn-primary hide-sm" onclick="openTrxForm()"><i class="bi bi-plus-lg"></i> Catat Transaksi</button>
      </div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <div class="filters">
        <div class="input-ic f-search"><i class="bi bi-search"></i><input class="input" id="fq" placeholder="Cari keterangan, ID transaksi…" value="${esc(f.q)}" aria-label="Cari transaksi"></div>
        <input class="input" type="date" id="ffrom" value="${f.from}" aria-label="Dari tanggal">
        <input class="input" type="date" id="fto" value="${f.to}" aria-label="Sampai tanggal">
        <select class="input" id="fjenis" aria-label="Jenis"><option value="">Semua jenis</option>${['Pemasukan', 'Pengeluaran', 'Pembayaran Kartu'].map(j => `<option ${f.jenis === j ? 'selected' : ''}>${j}</option>`).join('')}</select>
        <select class="input" id="fkat" aria-label="Kategori"><option value="">Semua kategori</option>${allCats.map(c => `<option value="${c.ID}" ${f.kat === c.ID ? 'selected' : ''}>${esc(c.Nama)}</option>`).join('')}</select>
        <select class="input" id="fsrc" aria-label="Sumber dana"><option value="">Semua sumber</option>${S.data.Akun.concat(S.data.Kartu_Kredit).map(a => `<option value="${a.ID}" ${f.src === a.ID ? 'selected' : ''}>${esc(sourceName(a.ID))}</option>`).join('')}</select>
        <button class="btn btn-secondary" onclick="resetTrxFilter()" aria-label="Reset filter"><i class="bi bi-arrow-counterclockwise"></i></button>
      </div>
      <div class="choice-chips" style="margin-top:12px">
        <button onclick="quickTrxFilter('month')">Bulan ini</button>
        <button onclick="quickTrxFilter('lastmonth')">Bulan lalu</button>
        <button onclick="quickTrxFilter('out')">Hanya pengeluaran</button>
        <button onclick="quickTrxFilter('in')">Hanya pemasukan</button>
      </div>
    </div>
    <div id="trxResults"></div>`;

  const onF = debounce(() => {
    Object.assign(S.trx, { q: $('#fq').value.trim(), from: $('#ffrom').value, to: $('#fto').value, jenis: $('#fjenis').value, kat: $('#fkat').value, src: $('#fsrc').value, page: 1 });
    renderTrxResults();
  }, 180);
  ['#fq', '#ffrom', '#fto', '#fjenis', '#fkat', '#fsrc'].forEach(s => { $(s).addEventListener('input', onF); $(s).addEventListener('change', onF); });
  renderTrxResults();
}

function resetTrxFilter() { S.trx = { q: '', from: '', to: '', jenis: '', kat: '', src: '', page: 1, sort: 'Tanggal', dir: -1 }; renderTransaksi(); }
function quickTrxFilter(k) {
  const m = thisYm();
  if (k === 'month') Object.assign(S.trx, { from: m + '-01', to: dateInYm(m, 31) });
  if (k === 'lastmonth') { const p = ymAdd(m, -1); Object.assign(S.trx, { from: p + '-01', to: dateInYm(p, 31) }); }
  if (k === 'out') S.trx.jenis = 'Pengeluaran';
  if (k === 'in') S.trx.jenis = 'Pemasukan';
  S.trx.page = 1;
  renderTransaksi();
}

function filteredTrx() {
  const f = S.trx, q = f.q.toLowerCase();
  const list = S.data.Transaksi.filter(t =>
    (!q || (t.Keterangan + ' ' + t.ID + ' ' + t.Catatan).toLowerCase().includes(q)) &&
    (!f.from || t.Tanggal >= f.from) && (!f.to || t.Tanggal <= f.to) &&
    (!f.jenis || t.Jenis === f.jenis) && (!f.kat || t.Kategori === f.kat) &&
    (!f.src || t.SumberDana === f.src || t.Referensi === f.src));
  const k = f.sort, d = f.dir;
  return list.sort((a, b) => {
    const va = k === 'Nominal' ? num(a.Nominal) : String(a[k] || ''), vb = k === 'Nominal' ? num(b.Nominal) : String(b[k] || '');
    if (va < vb) return -d; if (va > vb) return d;
    return String(b.Dibuat).localeCompare(String(a.Dibuat));
  });
}
function sortTrx(k) { S.trx.dir = S.trx.sort === k ? -S.trx.dir : -1; S.trx.sort = k; renderTrxResults(); }

function renderTrxResults() {
  const list = filteredTrx();
  let inc = 0, exp = 0, nIn = 0, nOut = 0;
  list.forEach(t => { if (t.Jenis === 'Pemasukan') { inc += num(t.Nominal); nIn++; } else if (t.Jenis === 'Pengeluaran') { exp += num(t.Nominal); nOut++; } });
  const per = 20, pages = Math.max(1, Math.ceil(list.length / per));
  S.trx.page = Math.min(S.trx.page, pages);
  const rows = list.slice((S.trx.page - 1) * per, S.trx.page * per);
  const sortIc = k => S.trx.sort === k ? `<i class="bi bi-caret-${S.trx.dir > 0 ? 'up' : 'down'}-fill"></i>` : '<i class="bi bi-chevron-expand" style="opacity:.4"></i>';
  const jenisPill = j => j === 'Pemasukan' ? '<span class="pill pill-ok">Pemasukan</span>' : j === 'Pembayaran Kartu' ? '<span class="pill pill-orange">Bayar Kartu</span>' : '<span class="pill pill-gray">Pengeluaran</span>';

  $('#trxResults').innerHTML = `
    <div class="grid g-3 stack-sm">
      <div class="card"><div class="stat-top"><span class="stat-label">Pemasukan terfilter</span><span class="ic-sq sm ic-ok"><i class="bi bi-arrow-down-left"></i></span></div><div class="stat-value">${money(inc)}</div><div class="hint">${nIn} transaksi masuk</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Pengeluaran terfilter</span><span class="ic-sq sm ic-bad"><i class="bi bi-arrow-up-right"></i></span></div><div class="stat-value">${money(exp)}</div><div class="hint">${nOut} transaksi keluar</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Selisih bersih</span><span class="ic-sq sm"><i class="bi bi-piggy-bank"></i></span></div><div class="stat-value accent">${inc - exp >= 0 ? '+' : ''}${money(inc - exp)}</div><div class="hint"><span class="pill ${inc - exp >= 0 ? 'pill-ok' : 'pill-bad'}">${inc - exp >= 0 ? 'Surplus' : 'Defisit'}</span></div></div>
    </div>
    <div class="card flush">
      ${list.length ? `<div class="table-wrap"><table class="tbl responsive">
        <thead><tr>
          <th class="sortable" onclick="sortTrx('Tanggal')">Tanggal ${sortIc('Tanggal')}</th>
          <th class="sortable" onclick="sortTrx('Keterangan')">Keterangan ${sortIc('Keterangan')}</th>
          <th>Kategori</th><th>Sumber dana</th><th>Jenis</th>
          <th class="sortable r" onclick="sortTrx('Nominal')">Nominal ${sortIc('Nominal')}</th><th class="r">Aksi</th>
        </tr></thead>
        <tbody>${rows.map(t => {
          const c = catInfo(t.Kategori), inn = t.Jenis === 'Pemasukan';
          return `<tr>
            <td class="nowrap hide-m">${fmtDate(t.Tanggal)}</td>
            <td><div class="cell-main"><span class="ic-sq sm" style="background:${esc(c.Warna)}1f;color:${esc(c.Warna)}"><i class="bi ${esc(c.Ikon)}"></i></span>
              <div style="min-width:0"><b>${esc(t.Keterangan)}</b><small>${esc(c.Nama)} • ${fmtDate(t.Tanggal)}${t.Bukti ? ` • <a href="javascript:void(0)" onclick="openPreview('${jsq(t.Bukti)}')"><i class="bi bi-paperclip"></i> bukti</a>` : ''}</small></div></div></td>
            <td class="hide-m"><span class="pill pill-orange pill-dot" style="background:${esc(c.Warna)}1a;color:var(--text)">${esc(c.Nama)}</span></td>
            <td class="hide-m"><span class="pill pill-gray"><i class="bi ${kartu(t.SumberDana) ? 'bi-credit-card' : 'bi-bank'}"></i> ${esc(sourceName(t.SumberDana))}</span></td>
            <td class="hide-m">${jenisPill(t.Jenis)}</td>
            <td class="r nowrap"><span class="${inn ? 'amt-in' : 'amt-out'}">${inn ? '+' : '−'}${rp(t.Nominal)}</span></td>
            <td class="r hide-m"><div class="row-actions">
              <button class="btn-icon" onclick="openTrxForm('${t.ID}')" aria-label="Ubah"><i class="bi bi-pencil"></i></button>
              <button class="btn-icon danger" onclick="deleteTrx('${t.ID}')" aria-label="Hapus"><i class="bi bi-trash"></i></button></div></td>
          </tr>`; }).join('')}</tbody></table></div>
        <div class="tbl-foot"><span>Menampilkan ${(S.trx.page - 1) * per + 1}–${Math.min(list.length, S.trx.page * per)} dari ${list.length} transaksi</span>${pager(S.trx.page, pages, 'gotoTrxPage')}</div>`
        : emptyState('bi-receipt', 'Tidak ada transaksi', S.data.Transaksi.length ? 'Coba ubah filter pencarian.' : 'Mulai catat pemasukan dan pengeluaran pertama Anda.', `<button class="btn btn-primary" onclick="openTrxForm()"><i class="bi bi-plus-lg"></i> Catat Transaksi</button>`)}
    </div>`;
  // Di ponsel, ketuk baris untuk mengubah
  if (window.innerWidth < 768) $$('#trxResults tbody tr').forEach((tr, i) => { tr.style.cursor = 'pointer'; tr.onclick = () => openTrxForm(rows[i].ID); });
}
function gotoTrxPage(p) { S.trx.page = p; renderTrxResults(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function pager(cur, pages, fn) {
  if (pages <= 1) return '';
  const nums = [];
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - cur) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<div class="pager"><button ${cur === 1 ? 'disabled' : ''} onclick="${fn}(${cur - 1})" aria-label="Sebelumnya"><i class="bi bi-chevron-left"></i></button>
    ${nums.map(n => n === '…' ? '<span>…</span>' : `<button class="${n === cur ? 'on' : ''}" onclick="${fn}(${n})">${n}</button>`).join('')}
    <button ${cur === pages ? 'disabled' : ''} onclick="${fn}(${cur + 1})" aria-label="Berikutnya"><i class="bi bi-chevron-right"></i></button></div>`;
}

/* ───────────── HALAMAN: KARTU KREDIT ───────────── */
/** Desain latar kartu: dipilih manual, atau dikenali dari nama/bank kartu. */
function cardSkin(k) {
  const d = String(k.Desain || 'auto');
  if (d === 'polos') return '';
  if (d !== 'auto') return d;
  const t = `${k.Nama} ${k.Bank}`.toLowerCase();
  if (t.includes('pertamina')) return 'mandiri-pertamina';
  if (t.includes('jcb') || t.includes('precious')) return 'mandiri-jcb';
  return '';
}
function cardHolder() { return String(setting('namaPemilik', 'Pemilik')).toUpperCase().slice(0, 26); }
function ccThumb(k, cls) {
  const s = cardSkin(k);
  return s ? `<span class="cc-thumb cc-skin-${s} ${cls || ''}" role="img" aria-label="${esc(k.Nama)}"></span>`
    : `<span class="ic-sq sm ic-ink ${cls || ''}"><i class="bi bi-credit-card"></i></span>`;
}
function ccVisual(k, i) {
  const s = cardSkin(k);
  if (s) return `<div class="cc-art cc-skin-${s}" role="img" aria-label="Kartu ${esc(k.Nama)} berakhiran ${esc(k.Digit4)}">
    <div class="cc-art-num">••••&nbsp;&nbsp;••••&nbsp;&nbsp;••••&nbsp;&nbsp;${esc(k.Digit4)}</div>
    <div class="cc-art-limit"><small>LIMIT</small>${rp(i.limit)}</div>
    <div class="cc-art-name">${esc(cardHolder())}</div>
  </div>`;
  return `<div class="cc">
    <div class="cc-top"><div><div class="cc-bank">${esc(k.Bank)}</div><div class="cc-name">${esc(k.Nama)}</div></div><i class="bi bi-wifi" style="transform:rotate(90deg);font-size:20px;opacity:.7"></i></div>
    <div class="cc-chip"></div>
    <div class="cc-bottom"><div class="cc-num">•••• ${esc(k.Digit4)}</div><div class="cc-limit">LIMIT<b>${rp(i.limit)}</b></div></div>
  </div>`;
}
function billStatusPill(b) {
  if (!b) return '<span class="pill pill-gray">Belum ada tagihan</span>';
  if (b.Status === 'Lunas') return '<span class="pill pill-ok pill-dot">Lunas</span>';
  if (b.Status === 'Sebagian') return '<span class="pill pill-warn pill-dot">Dibayar sebagian</span>';
  return '<span class="pill pill-warn pill-dot">Belum lunas</span>';
}

function renderKartu() {
  const cards = S.data.Kartu_Kredit.filter(isActive);
  const infos = cards.map(k => ({ k, i: kartuInfo(k) }));
  const totLimit = infos.reduce((s, x) => s + x.i.limit, 0), totPakai = infos.reduce((s, x) => s + x.i.pakai, 0);
  const unpaid = infos.reduce((s, x) => s + x.i.outstanding, 0), openTot = infos.reduce((s, x) => s + x.i.open.total, 0);
  const cic = S.data.Cicilan.map(c => Object.assign({ c }, cicilanInfo(c)));
  const beban = cic.filter(x => !x.lunas).reduce((s, x) => s + num(x.c.PerBulan), 0);

  $('#page-kartu').innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow"><i class="bi bi-credit-card"></i> Portofolio kredit</span><h1>Manajemen Kartu Kredit</h1><p>Semua pengeluaran yang dibayar pakai kartu otomatis masuk ke tagihan siklusnya (cetak tgl ${cards[0] ? cards[0].TglCetak : 5}) dan mengurangi limit.</p></div>
      <div class="head-actions">
        <button class="btn btn-secondary" onclick="openCrud('Kartu_Kredit')"><i class="bi bi-plus-lg"></i> Tambah Kartu</button>
        <button class="btn btn-primary" onclick="openCicilanForm()"><i class="bi bi-bag-plus"></i> Tambah Cicilan</button>
      </div>
    </div>
    <div class="grid g-4 pair-sm">
      <div class="card"><span class="stat-label">Total limit gabungan</span><div class="stat-value">${money(totLimit)}</div><div class="hint">${cards.length} kartu aktif</div></div>
      <div class="card"><span class="stat-label">Perkiraan pemakaian</span><div class="stat-value accent">${money(totPakai)}</div><div class="hint">${totLimit ? Math.round(totPakai / totLimit * 100) : 0}% dari limit • ideal &lt; 30%</div></div>
      <div class="card"><span class="stat-label">Tagihan belum dibayar</span><div class="stat-value">${money(unpaid)}</div><div class="hint">${rp(openTot)} belum ditagih (siklus berjalan)</div></div>
      <div class="card"><span class="stat-label">Beban cicilan bulanan</span><div class="stat-value">${money(beban)}</div><div class="hint">${cic.filter(x => !x.lunas).length} cicilan berjalan</div></div>
    </div>
    ${cards.length ? `<div class="grid g-2">${infos.map(({ k, i }) => {
      const b = i.bill;
      return `<div class="card">
        ${ccVisual(k, i)}
        <div class="subbox" style="margin-top:16px">
          <div class="kv" style="padding-top:0"><span>Pemakaian <b style="color:var(--text)">${rp(i.pakai)}</b></span><span class="pill ${i.pct > 80 ? 'pill-bad' : i.pct > 30 ? 'pill-warn' : 'pill-ok'}">${i.pct}%</span></div>
          <div class="bar ${i.pct > 80 ? 'bad' : ''}"><span style="width:${i.pct}%"></span></div>
          <div class="kv" style="padding-bottom:0"><span>Sisa limit</span><b>${rp(i.sisa)}</b></div>
        </div>
        <div class="bill-box">
          <div class="kv" style="padding-top:0"><b style="text-align:left"><i class="bi bi-calendar3"></i> Tagihan ${b ? fmtYm(b.Periode) : 'periode berjalan'}</b>${billStatusPill(b)}</div>
          ${b ? `<div class="kv"><span>Total tagihan</span><b class="big">${rp(b.Total)}</b></div>
            <div class="kv"><span>Tagihan minimum</span><b>${rp(b.Minimum)}</b></div>
            ${num(b.Dibayar) ? `<div class="kv"><span>Sudah dibayar</span><b style="color:var(--success-ink)">${rp(b.Dibayar)}</b></div>` : ''}
            <hr class="divider"><div class="kv"><span>Jatuh tempo</span><b>${fmtDate(b.JatuhTempo)} ${b.Status !== 'Lunas' ? duePill(daysUntil(b.JatuhTempo)) : ''}</b></div>`
            : `<p class="hint" style="margin:6px 0 0">Tagihan pertama tercetak otomatis tgl ${k.TglCetak}.</p>`}
        </div>
        <div class="bill-box" style="background:var(--primary-soft)">
          <div class="kv" style="padding-top:0"><b style="text-align:left"><i class="bi bi-hourglass-split"></i> Siklus berjalan</b><span class="pill pill-orange">tercetak ${fmtDate(i.open.end)}</span></div>
          <div class="kv"><span>${fmtDate(i.open.start)} – ${fmtDate(i.open.end)}</span></div>
          <div class="kv"><span>Transaksi belum ditagih (${i.open.tx.length})</span><b>${rp(i.open.total)}</b></div>
          <div class="kv"><span>Cicilan bulan ini (${i.open.cicilan.length})</span><b>${rp(i.open.cicilanTotal)}</b></div>
          <hr class="divider">
          <div class="kv"><span><b style="color:var(--text)">Perkiraan tagihan ${fmtDate(i.open.end)}</b></span><b class="big">${rp(i.open.estimasi)}</b></div>
          ${i.outstanding ? `<div class="kv"><span>+ Tagihan sebelumnya belum lunas</span><b>${rp(i.outstanding)}</b></div>
          <div class="kv"><span><b style="color:var(--text)">Total kewajiban kartu</b></span><b class="big" style="color:var(--primary-ink)">${rp(i.open.estimasi + i.outstanding)}</b></div>` : ''}
          <div class="hint">Jatuh tempo ${fmtDate(billDueDate(k, i.open.P))}</div>
        </div>
        <div class="actions-row">
          ${i.outstanding ? `<button class="btn btn-primary btn-sm" onclick="openCardPay('${k.ID}')"><i class="bi bi-wallet2"></i> Bayar Tagihan</button>` : ''}
          <button class="btn-link" style="margin-left:auto" onclick="openKartuDetail('${k.ID}')">Detail, transaksi &amp; cicilan <i class="bi bi-arrow-right"></i></button>
        </div>
      </div>`; }).join('')}</div>`
      : `<div class="card">${emptyState('bi-credit-card-2-front', 'Belum ada kartu kredit', 'Tambahkan kartu untuk memantau tagihan, limit, dan sisa cicilan.', `<button class="btn btn-primary" onclick="openCrud('Kartu_Kredit')"><i class="bi bi-plus-lg"></i> Tambah Kartu</button>`)}</div>`}
    ${cicilanTable(cic, 'Daftar Cicilan (Semua Kartu)')}`;
}

function cicilanTable(cic, title) {
  const aktif = cic.filter(x => !x.lunas);
  return `<div class="card flush" style="margin-top:20px">
    <div class="card-head">
      <div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-list-check"></i></span><div><h3>${esc(title)}</h3><p>Sisa bulan & pokok dihitung otomatis dari bulan berjalan</p></div></div>
      <div style="text-align:right"><div class="hint">Total kewajiban bulanan</div><b class="num" style="font-size:18px;color:var(--primary-ink)">${rp(aktif.reduce((s, x) => s + num(x.c.PerBulan), 0))}</b></div>
    </div>
    ${cic.length ? `<div class="table-wrap" style="margin-top:16px"><table class="tbl responsive">
      <thead><tr><th>Barang &amp; kartu</th><th class="r">Harga total</th><th class="r">Cicilan / bln</th><th>Progres</th><th class="r">Sisa pokok</th><th>Status</th><th class="r">Aksi</th></tr></thead>
      <tbody>${cic.sort((a, b) => a.lunas - b.lunas).map(x => {
        const k = kartu(x.c.KartuID);
        return `<tr class="${x.lunas ? 'inactive' : ''}">
          <td><div class="cell-main"><span class="ic-sq sm"><i class="bi bi-bag"></i></span><div><b>${esc(x.c.Barang)}</b><small>${k ? esc(k.Nama) + ' •' + esc(k.Digit4) : '—'}${x.c.Catatan ? ' • ' + esc(x.c.Catatan) : ''}</small></div></div></td>
          <td class="r hide-m">${rp(x.c.HargaTotal)}</td>
          <td class="r"><b>${rp(x.c.PerBulan)}</b></td>
          <td class="m-full" style="min-width:160px"><div class="kv" style="padding:0 0 4px;font-size:12px"><span>Bulan ke-${x.paid}/${x.tenor}</span><span>Sisa ${x.sisaBulan} bln</span></div><div class="bar ${x.lunas ? 'ok' : ''}"><span style="width:${x.pct}%"></span></div></td>
          <td class="r hide-m"><b style="color:var(--primary-ink)">${rp(x.sisaPokok)}</b></td>
          <td class="hide-m">${x.lunas ? '<span class="pill pill-ok">Lunas</span>' : '<span class="pill pill-orange pill-dot">Berjalan</span>'}</td>
          <td class="r hide-m"><button class="btn-icon" onclick="openCicilanForm('${x.c.ID}')" aria-label="Ubah cicilan"><i class="bi bi-pencil"></i></button></td>
        </tr>`; }).join('')}</tbody></table></div>`
      : `<div style="padding:0 24px 24px">${emptyState('bi-bag-check', 'Belum ada cicilan', 'Catat cicilan 0% atau konversi transaksi per kartu.', `<button class="btn btn-primary" onclick="openCicilanForm()"><i class="bi bi-plus-lg"></i> Tambah Cicilan</button>`)}</div>`}
  </div>`;
}

function openKartuDetail(id) { S.kartuDetail = { id, tab: 'tagihan' }; navigateTo('kartuDetail'); }

function renderKartuDetail() {
  const k = kartu(S.kartuDetail.id);
  if (!k) { navigateTo('kartu'); return; }
  const i = kartuInfo(k), b = i.bill, tab = S.kartuDetail.tab;
  const bills = S.data.Tagihan_Kartu.filter(x => x.KartuID === k.ID).sort((a, c) => c.Periode.localeCompare(a.Periode));
  const pays = S.data.Transaksi.filter(t => t.Jenis === 'Pembayaran Kartu' && t.Referensi === k.ID).sort((a, c) => c.Tanggal.localeCompare(a.Tanggal));
  const nextCetak = i.open.end;
  let body = '';
  if (tab === 'tagihan') {
    const txList = (list, empty) => list.length ? `<div class="r-list">${list.map(t => { const c = catInfo(t.Kategori);
      return `<div class="r-item"><span class="ic-sq sm" style="background:${esc(c.Warna)}1f;color:${esc(c.Warna)}"><i class="bi ${esc(c.Ikon)}"></i></span>
        <div class="r-main"><div class="r-title"><span class="t">${esc(t.Keterangan)}</span></div><div class="r-sub">${fmtDate(t.Tanggal)} • ${esc(c.Nama)}</div></div>
        <div class="r-amt">${rp(t.Nominal)}</div><button class="btn-icon" onclick="openTrxForm('${t.ID}')" aria-label="Ubah"><i class="bi bi-pencil"></i></button></div>`; }).join('')}</div>`
      : `<p class="muted" style="margin:0">${empty}</p>`;
    body = `<div class="card" style="margin-bottom:20px">
        <div class="card-head"><div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-hourglass-split"></i></span><div><h3>Siklus berjalan — perkiraan tagihan</h3><p>${fmtDate(i.open.start, true)} – ${fmtDate(i.open.end, true)} • tercetak ${fmtDate(i.open.end)}, jatuh tempo ${fmtDate(billDueDate(k, i.open.P))}</p></div></div><div style="text-align:right"><b class="num" style="font-size:20px;color:var(--primary-ink)">${rp(i.open.estimasi)}</b><div class="hint">transaksi ${rp(i.open.total)} + cicilan ${rp(i.open.cicilanTotal)}</div></div></div>
        ${i.open.cicilan.length ? `<div class="r-list" style="margin-bottom:10px">${i.open.cicilan.map(x => `<div class="r-item"><span class="ic-sq sm ic-ink"><i class="bi bi-bag"></i></span><div class="r-main"><div class="r-title"><span class="t">Cicilan ${esc(x.c.Barang)} (${x.ke}/${num(x.c.Tenor)})</span></div><div class="r-sub">Ditagih otomatis ${fmtDate(i.open.end)}</div></div><div class="r-amt">${rp(x.nominal)}</div></div>`).join('')}</div>` : ''}
        ${txList(i.open.tx, 'Belum ada transaksi kartu di siklus ini.')}
      </div>` + (b ? `<div class="card">
      <div class="callout ${b.Status === 'Lunas' ? 'gray' : ''}" style="margin-bottom:16px;align-items:center"><i class="bi bi-calendar-check"></i><div style="flex:1"><b>Tagihan tercetak: ${fmtYm(b.Periode, true)}</b> <span class="pill ${b.Sumber === 'Otomatis' ? 'pill-orange' : 'pill-gray'}">${b.Sumber === 'Otomatis' ? 'Otomatis' : 'Manual'}</span><br><small class="muted">Siklus ${fmtDate(cycleRange(k, b.Periode).start)} – ${fmtDate(cycleRange(k, b.Periode).end)} • jatuh tempo ${fmtDate(b.JatuhTempo, true)}</small></div>${billStatusPill(b)}</div>
      <div class="grid g-4 pair-sm" style="margin-bottom:16px">
        <div class="subbox"><div class="stat-label">Total tagihan</div><div class="stat-value">${money(b.Total)}</div></div>
        <div class="subbox"><div class="stat-label">Pembayaran minimum</div><div class="stat-value">${money(b.Minimum)}</div></div>
        <div class="subbox"><div class="stat-label">Sudah dibayar</div><div class="stat-value" style="color:var(--success-ink)">${money(b.Dibayar)}</div></div>
        <div class="subbox" style="background:var(--ink);color:#fff"><div class="stat-label" style="color:rgba(255,255,255,.7)">Sisa harus dibayar</div><div class="stat-value" style="color:var(--primary)">${money(i.outstanding)}</div></div>
      </div>
      <div class="actions-row" style="margin:0 0 16px">
        ${i.outstanding ? `<button class="btn btn-primary" onclick="openCardPay('${k.ID}')"><i class="bi bi-wallet2"></i> Bayar Tagihan Sekarang</button>` : ''}
        <button class="btn btn-secondary" onclick="openBillInput('${k.ID}','${b.ID}')"><i class="bi bi-pencil"></i> Koreksi sesuai lembar bank</button>
        ${i.unpaid.length ? `<button class="btn btn-ghost" onclick="S.kartuDetail.tab='riwayat'; renderKartuDetail()"><i class="bi bi-check2-all"></i> Tagihan lama sudah dibayar?</button>` : ''}
      </div>
      <h4 style="margin:0 0 10px">Rincian transaksi tagihan ini</h4>
      ${txList(cycleTx(k, b.Periode), 'Tagihan ini diinput manual / berasal dari sebelum memakai aplikasi.')}
    </div>` : `<div class="card">${emptyState('bi-receipt', 'Belum ada tagihan tercetak', `Tagihan pertama dibuat otomatis tgl ${k.TglCetak} dari transaksi di siklus berjalan.`, `<button class="btn btn-secondary" onclick="openBillInput('${k.ID}')"><i class="bi bi-plus-lg"></i> Input tagihan lama (manual)</button>`)}</div>`);
  } else if (tab === 'cicilan') {
    body = cicilanTable(i.cicilan, 'Cicilan di kartu ini');
  } else {
    body = `${i.unpaid.length > 1 ? `<div class="callout" style="margin-bottom:14px"><i class="bi bi-info-circle"></i><div>Ada ${i.unpaid.length} tagihan belum lunas. Jika tagihan lama sudah Anda bayar sebelum memakai aplikasi, klik <b>Sudah dibayar</b> agar tidak muncul sebagai terlambat dan limit kembali sesuai.</div>${i.unpaid.some(x => daysUntil(x.JatuhTempo) < 0) ? `<button class="btn btn-secondary btn-sm" onclick="markOverduePaidOutside('${k.ID}')">Tandai semua yang lewat jatuh tempo</button>` : ''}</div>` : ''}<div class="table-wrap"><table class="tbl responsive"><thead><tr><th>Periode</th><th class="r">Total</th><th class="r">Dibayar</th><th>Tanggal bayar</th><th>Status</th><th class="r">Aksi</th></tr></thead>
      <tbody>${bills.map(x => `<tr><td><b>${fmtYm(x.Periode, true)}</b></td><td class="r">${rp(x.Total)}</td><td class="r hide-m">${rp(x.Dibayar)}</td><td class="hide-m">${x.TglBayar ? fmtDate(x.TglBayar) : '—'}</td><td>${billStatusPill(x)}</td>
        <td class="r hide-m">${x.Status !== 'Lunas' ? `<button class="btn btn-secondary btn-xs" onclick="markBillPaidOutside('${x.ID}')" title="Tandai lunas tanpa mencatat pembayaran baru">Sudah dibayar</button>` : ''}<button class="btn-icon" onclick="openBillInput('${k.ID}','${x.ID}')" aria-label="Ubah"><i class="bi bi-pencil"></i></button><button class="btn-icon danger" onclick="deleteRow('Tagihan_Kartu','${x.ID}','tagihan ${fmtYm(x.Periode)}')" aria-label="Hapus"><i class="bi bi-trash"></i></button></td></tr>`).join('') || `<tr><td colspan="6" class="muted">Belum ada riwayat tagihan.</td></tr>`}</tbody></table></div>
      ${pays.length ? `<h4 style="margin:20px 0 10px">Riwayat pembayaran</h4><div class="r-list">${pays.map(p => `<div class="r-item"><span class="ic-sq sm ic-ok"><i class="bi bi-check2"></i></span><div class="r-main"><div class="r-title">${esc(p.Keterangan)}</div><div class="r-sub">${fmtDate(p.Tanggal)} • dari ${esc(sourceName(p.SumberDana))}</div></div><div class="r-amt">${rp(p.Nominal)}</div></div>`).join('')}</div>` : ''}`;
  }

  $('#page-kartuDetail').innerHTML = `
    <button class="btn-link" onclick="navigateTo('kartu')" style="margin-bottom:12px"><i class="bi bi-arrow-left"></i> Kembali ke daftar kartu</button>
    <div class="card" style="margin-bottom:20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      ${cardSkin(k) ? ccThumb(k, 'lg') : '<span class="ic-sq" style="width:56px;height:56px;font-size:24px"><i class="bi bi-bank"></i></span>'}
      <div style="flex:1;min-width:200px"><h1 style="font-size:24px">${esc(k.Nama)} <span class="muted" style="font-size:16px;font-weight:600">(•••• ${esc(k.Digit4)})</span> <span class="pill pill-ok">Aktif</span></h1><p class="muted" style="margin:4px 0 0">${esc(k.Bank)}</p></div>
      <button class="btn btn-secondary" onclick="openCrud('Kartu_Kredit','${k.ID}')"><i class="bi bi-pencil"></i> Ubah Kartu</button>
    </div>
    <div class="grid g-4 pair-sm">
      <div class="card"><div class="stat-top"><span class="stat-label">Tanggal cetak</span><i class="bi bi-calendar3 muted"></i></div><div class="stat-value" style="font-size:20px">Tgl ${k.TglCetak} setiap bulan</div><div class="hint"><i class="bi bi-clock"></i> Cetak berikutnya: ${fmtDate(nextCetak)}</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Jatuh tempo</span><i class="bi bi-calendar-x muted"></i></div><div class="stat-value" style="font-size:20px">Tgl ${k.TglJatuhTempo} setiap bulan</div><div class="hint">${i.unpaid[0] ? `<i class="bi bi-bell"></i> ${duePill(daysUntil(i.unpaid[0].JatuhTempo))}` : 'Tidak ada tagihan terbuka'}</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Total limit</span><i class="bi bi-pie-chart muted"></i></div><div class="stat-value" style="font-size:20px">${rp(i.limit)}</div><div class="kv" style="padding:0 0 6px"><span>Terpakai ${rp(i.pakai)}</span><b>${i.pct}%</b></div><div class="bar"><span style="width:${i.pct}%"></span></div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Jarak pengingat</span><i class="bi bi-alarm muted"></i></div><div class="stat-value" style="font-size:20px">${remindDays(k)} hari sebelum</div><div class="hint">Notifikasi di dalam aplikasi • <a href="javascript:void(0)" onclick="openCrud('Kartu_Kredit','${k.ID}')">Ubah</a></div></div>
    </div>
    <div class="tabs">
      ${[['tagihan', 'bi-receipt', 'Tagihan & transaksi', ''], ['cicilan', 'bi-list-check', 'Daftar cicilan', i.cicilan.filter(x => !x.lunas).length], ['riwayat', 'bi-clock-history', 'Riwayat pembayaran', '']]
        .map(([id, ic, l, c]) => `<button class="tab ${tab === id ? 'on' : ''}" onclick="S.kartuDetail.tab='${id}'; renderKartuDetail()"><i class="bi ${ic}"></i> ${l}${c !== '' ? ` <span class="cnt">${c}</span>` : ''}</button>`).join('')}
    </div>
    <div class="${tab === 'riwayat' ? 'card' : ''}">${body}</div>`;
}

/* ───────────── HALAMAN: TAGIHAN & PENGINGAT ───────────── */
function renderTagihan() {
  const tab = S.tagihanTab;
  const L = S.data.Langganan, R = S.data.Tagihan_Rutin, V = S.data.Kendaraan;
  const addBtn = { langganan: ['Langganan', 'Tambah Langganan'], rumah: ['Tagihan_Rutin', 'Tambah Tagihan Rumah'], pajak: ['Kendaraan', 'Tambah Kendaraan'] }[tab];
  let body = '';
  if (tab === 'langganan') body = tabLangganan(L);
  else if (tab === 'rumah') body = tabRumah(R);
  else body = tabPajak(V);

  $('#page-tagihan').innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow"><i class="bi bi-bell"></i> Kewajiban rutin</span><h1>Tagihan &amp; Pengingat</h1><p>Kelola langganan digital, tagihan rumah tangga, dan pajak kendaraan dalam satu tempat.</p></div>
      <div class="head-actions"><button class="btn btn-primary" onclick="openCrud('${addBtn[0]}')"><i class="bi bi-plus-lg"></i> ${addBtn[1]}</button></div>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab ${tab === 'langganan' ? 'on' : ''}" onclick="S.tagihanTab='langganan'; renderTagihan()"><i class="bi bi-arrow-repeat"></i> Langganan <span class="cnt">${L.filter(isActive).length}</span></button>
      <button class="tab ${tab === 'rumah' ? 'on' : ''}" onclick="S.tagihanTab='rumah'; renderTagihan()"><i class="bi bi-house-door"></i> Tagihan Rumah <span class="cnt">${R.filter(isActive).length}</span></button>
      <button class="tab ${tab === 'pajak' ? 'on' : ''}" onclick="S.tagihanTab='pajak'; renderTagihan()"><i class="bi bi-car-front"></i> Pajak Kendaraan <span class="cnt">${V.filter(isActive).length}</span></button>
    </div>
    ${body}`;
}

function tabLangganan(L) {
  const act = L.filter(isActive);
  const perBln = act.reduce((s, l) => s + (l.Siklus === 'Tahunan' ? num(l.Nominal) / 12 : num(l.Nominal)), 0);
  const perThn = act.reduce((s, l) => s + (l.Siklus === 'Tahunan' ? num(l.Nominal) : num(l.Nominal) * 12), 0);
  const soon = act.filter(l => !isCardPaid(l) && daysUntil(l.TglTagih) <= 7).length;
  const auto = act.filter(isCardPaid).length;
  const sorted = L.slice().sort((a, b) => (isActive(b) - isActive(a)) || String(a.TglTagih).localeCompare(String(b.TglTagih)));
  return `<div class="grid g-3">
      <div class="card"><div class="stat-top"><span class="stat-label">Total pengeluaran / bulan</span><span class="ic-sq sm"><i class="bi bi-calendar3"></i></span></div><div class="stat-value">${money(perBln)}</div><div class="hint">Termasuk konversi tahunan ÷ 12</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Proyeksi / tahun</span><span class="ic-sq sm ic-ink"><i class="bi bi-graph-up"></i></span></div><div class="stat-value">${money(perThn)}</div><div class="hint">12 bulan ke depan</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Layanan aktif</span><span class="ic-sq sm ic-ok"><i class="bi bi-collection-play"></i></span></div><div class="stat-value">${act.length} aktif</div><div class="hint">${soon ? `<span style="color:var(--warning-ink)">${soon} perlu dibayar ≤ 7 hari</span>` : `${auto} auto-debit kartu • ${L.length - act.length} dihentikan`}</div></div>
    </div>
    <div class="card flush">
      <div class="card-head"><div><h3>Daftar Langganan</h3><p>${L.length} layanan terdaftar</p></div></div>
      ${auto ? `<div class="callout" style="margin:12px 24px 0"><i class="bi bi-credit-card"></i><div>Langganan yang dibayar pakai <b>kartu kredit</b> didebit otomatis pada tanggal perpanjangan: pengeluarannya tercatat ke kartu dan tanggalnya maju sendiri. Pembayarannya ikut <b>tagihan kartu</b>, jadi tidak perlu ditandai lunas satu per satu.</div></div>` : ''}
      ${L.length ? `<div class="table-wrap" style="margin-top:12px"><table class="tbl responsive">
        <thead><tr><th>Layanan</th><th class="r">Biaya &amp; siklus</th><th>Perpanjangan berikutnya</th><th>Metode bayar</th><th>Pengingat</th><th>Status</th><th class="r">Aksi</th></tr></thead>
        <tbody>${sorted.map(l => {
          const on = isActive(l), d = daysUntil(l.TglTagih);
          return `<tr class="${on ? '' : 'inactive'}">
            <td><div class="cell-main"><span class="ic-sq sm"><i class="bi bi-play-btn"></i></span><div><b ${on ? '' : 'style="text-decoration:line-through"'}>${esc(l.Nama)}</b><small>${esc(l.Keterangan || '')}</small></div></div></td>
            <td class="r"><b>${rp(l.Nominal)}</b><br><span class="pill ${l.Siklus === 'Tahunan' ? 'pill-orange' : 'pill-gray'}" style="margin-top:4px">${esc(l.Siklus)}</span></td>
            <td class="m-full">${on ? `${fmtDate(l.TglTagih)} ${isCardPaid(l) ? autoPill(d) : duePill(d)}` : '<span class="muted">Dihentikan</span>'}</td>
            <td class="hide-m"><span class="pill pill-gray"><i class="bi ${kartu(l.DibayarPakai) ? 'bi-credit-card' : 'bi-bank'}"></i> ${esc(sourceName(l.DibayarPakai))}</span></td>
            <td class="hide-m"><i class="bi bi-alarm" style="color:var(--primary)"></i> H-${remindDays(l)}</td>
            <td class="hide-m">${on ? '<span class="pill pill-ok">Aktif</span>' : '<span class="pill pill-gray">Berhenti</span>'}</td>
            <td class="r"><div class="row-actions">${on && isCardPaid(l) ? `<span class="pill pill-orange" title="Didebit otomatis ke kartu; dibayar lewat tagihan kartu"><i class="bi bi-arrow-repeat"></i> Auto-debit</span>` : on ? `<button class="btn btn-primary btn-xs" onclick="openMarkPaid('langganan','${l.ID}')">Tandai Lunas</button>` : `<button class="btn btn-secondary btn-xs" onclick="commit([up('Langganan', Object.assign({}, findBy('Langganan','${l.ID}'), {Status:'Aktif'}))],'Langganan diaktifkan')">Reaktifkan</button>`}
              <button class="btn-icon" onclick="openCrud('Langganan','${l.ID}')" aria-label="Ubah"><i class="bi bi-pencil"></i></button></div></td>
          </tr>`; }).join('')}</tbody></table></div>`
        : `<div style="padding:0 24px 24px">${emptyState('bi-collection-play', 'Belum ada langganan', 'Tambahkan Microsoft 365, Netflix, dan layanan lain agar tidak terlewat.', `<button class="btn btn-primary" onclick="openCrud('Langganan')"><i class="bi bi-plus-lg"></i> Tambah Langganan</button>`)}</div>`}
    </div>`;
}

function tabRumah(R) {
  const act = R.filter(isActive);
  const icons = { PBB: 'bi-buildings', PDAM: 'bi-droplet', PLN: 'bi-lightning-charge', Gas: 'bi-fire', Lainnya: 'bi-house-door' };
  const icCls = { PBB: 'ic-ink', PDAM: 'ic-info', PLN: 'ic-warn', Gas: '', Lainnya: 'ic-ink' };
  const hist = S.data.Riwayat_Tagihan.slice().sort((a, b) => b.TglBayar.localeCompare(a.TglBayar)).slice(0, 12);
  const totEst = act.filter(t => t.Siklus !== 'Tahunan').reduce((s, t) => s + estimasiRutin(t).val, 0);
  return `<div class="callout gray" style="margin-bottom:16px;align-items:center"><i class="bi bi-calculator"></i><div style="flex:1">Total estimasi tagihan rumah bulanan: <b>${rp(totEst)}</b></div></div>
    ${act.length ? `<div class="grid g-4">${act.map(t => {
      const e = estimasiRutin(t), d = daysUntil(t.JatuhTempo), pre = t.Prabayar === 'Ya', auto = isAutoRutin(t);
      const lastAuto = auto ? S.data.Riwayat_Tagihan.filter(r => r.TagihanID === t.ID && String(r.ID).startsWith('RTG-AUTO-')).sort((a, b) => b.TglBayar.localeCompare(a.TglBayar))[0] : null;
      return `<div class="card bill-card" data-kind="${esc(t.Jenis)}">
        <div class="stat-top"><span class="ic-sq ${icCls[t.Jenis] || ''}"><i class="bi ${icons[t.Jenis] || icons.Lainnya}"></i></span>${auto ? autoPill(d) : pre ? '<span class="pill pill-orange">Prabayar</span>' : duePill(d)}</div>
        <div><b style="font-size:16px">${esc(t.Nama)}</b><div class="hint">${t.Jenis === 'PBB' ? 'NOP' : 'ID'}: ${esc(t.NoPelanggan || '—')}</div></div>
        <div class="subbox"><div class="hint">${pre ? 'Rata-rata isi token' : 'Perkiraan tagihan'}${e.n ? ` • avg ${e.n} bln` : ''}</div>
          <div class="amount">${rp(e.val)}<small class="muted" style="font-size:12px;font-weight:600"> /${t.Siklus === 'Tahunan' ? 'thn' : 'bln'}</small></div>
          <div class="hint"><i class="bi bi-calendar-event"></i> ${auto ? 'Didebit' : pre ? 'Pengingat isi' : 'Jatuh tempo'} ${fmtDate(t.JatuhTempo)}</div></div>
        ${auto ? `<div class="hint"><span class="pill pill-orange"><i class="bi bi-credit-card"></i> Auto-debit</span> ${esc(sourceName(t.DibayarPakai))}${lastAuto ? `<br>Terakhir: ${fmtYm(lastAuto.Periode)} • ${rp(lastAuto.Nominal)}` : ''}</div>` : ''}
        <div class="cardfoot">
          <button class="btn btn-secondary btn-sm" onclick="openCrud('Tagihan_Rutin','${t.ID}')"><i class="bi bi-pencil"></i> Ubah</button>
          ${auto ? (lastAuto ? `<button class="btn btn-primary btn-sm" onclick="openRutinAdjust('${lastAuto.ID}')">Sesuaikan nominal</button>` : '')
            : `<button class="btn btn-primary btn-sm" onclick="openMarkPaid('rutin','${t.ID}')">${pre ? 'Selesai Isi' : 'Tandai Lunas'}</button>`}
        </div>
      </div>`; }).join('')}</div>`
      : `<div class="card">${emptyState('bi-house-door', 'Belum ada tagihan rumah', 'Tambahkan PBB, PDAM, Listrik PLN, dan Gas untuk mulai mendapat pengingat.', `<button class="btn btn-primary" onclick="openCrud('Tagihan_Rutin')"><i class="bi bi-plus-lg"></i> Tambah Tagihan</button>`)}</div>`}
    ${R.length ? `<div class="card flush" style="margin-top:4px">
      <div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ink"><i class="bi bi-clock-history"></i></span><div><h3>Riwayat Pembayaran Tagihan Rumah</h3><p>12 pembayaran terakhir</p></div></div></div>
      ${hist.length ? `<div class="table-wrap" style="margin-top:12px"><table class="tbl responsive"><thead><tr><th>Tagihan</th><th>Periode</th><th>Tanggal bayar</th><th class="r">Nominal aktual</th><th>Dibayar pakai</th><th>Bukti</th></tr></thead>
        <tbody>${hist.map(h => { const t = findBy('Tagihan_Rutin', h.TagihanID) || { Nama: '(dihapus)' };
          return `<tr><td><b>${esc(t.Nama)}</b></td><td class="hide-m">${fmtYm(h.Periode)}</td><td>${fmtDate(h.TglBayar)}</td><td class="r"><b>${rp(h.Nominal)}</b></td><td class="hide-m">${esc(sourceName(h.DibayarPakai))}</td>
            <td class="hide-m">${h.Bukti ? `<a href="javascript:void(0)" onclick="openPreview('${jsq(h.Bukti)}')"><i class="bi bi-receipt"></i> Lihat struk</a>` : String(h.ID).startsWith('RTG-AUTO-') ? `<a href="javascript:void(0)" onclick="openRutinAdjust('${h.ID}')"><i class="bi bi-sliders"></i> Auto-debit • sesuaikan</a>` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>`
        : '<p class="muted" style="padding:0 24px 20px;margin:0">Riwayat muncul setelah Anda menandai tagihan lunas.</p>'}
    </div>` : ''}`;
}

function tabPajak(V) {
  const act = V.filter(isActive);
  const dues = [];
  act.forEach(v => { dues.push({ v, d: daysUntil(v.JatuhTempoTahunan), date: v.JatuhTempoTahunan }); });
  dues.sort((a, b) => a.d - b.d);
  const tot = act.reduce((s, v) => s + num(v.NominalTahunan), 0);
  const hist = S.data.Riwayat_Pajak.slice().sort((a, b) => b.TglBayar.localeCompare(a.TglBayar));
  const block = (v, five) => {
    const date = five ? v.JatuhTempo5Th : v.JatuhTempoTahunan, d = daysUntil(date), urgent = d <= remindDays(v);
    if (five && !date) return '';
    const auto = isAutoPajak(v, five);
    const last = auto ? S.data.Riwayat_Pajak.filter(r => r.KendaraanID === v.ID && r.Jenis === (five ? '5 Tahunan' : 'Tahunan') && String(r.ID).startsWith('RPJ-AUTO-')).sort((a, b) => b.TglBayar.localeCompare(a.TglBayar))[0] : null;
    return `<div class="subbox ${urgent && !auto ? 'urgent' : ''}">
      <div class="kv" style="padding-top:0"><b style="text-align:left">${five ? 'STNK &amp; Plat 5 Tahunan' : 'Pajak Tahunan (PKB)'}</b>${auto ? autoPill(d) : duePill(d)}</div>
      <div class="kv"><span><i class="bi bi-calendar3"></i> ${auto ? 'Didebit' : 'Jatuh tempo'} ${fmtDate(date)}</span><b>${num(five ? v.Nominal5Th : v.NominalTahunan) ? rp(five ? v.Nominal5Th : v.NominalTahunan) : '<span class="muted">belum diisi</span>'}</b></div>
      ${auto ? `<div class="hint" style="margin-top:4px"><span class="pill pill-orange"><i class="bi bi-credit-card"></i> Auto-debit</span> ${esc(sourceName(v.DibayarPakai))}${last ? ` • terakhir ${fmtDate(last.TglBayar)} ${rp(last.Nominal)}` : ''}</div>
        ${last ? `<button class="btn btn-secondary btn-sm w-100" style="margin-top:8px" onclick="openPajakAdjust('${last.ID}')"><i class="bi bi-sliders"></i> Sesuaikan nominal terakhir</button>` : ''}`
      : `<button class="btn ${urgent ? 'btn-primary' : 'btn-secondary'} btn-sm w-100" style="margin-top:8px" onclick="openMarkPaid('pajak','${v.ID}','${five ? '5Th' : 'Tahunan'}')"><i class="bi bi-check2-circle"></i> Tandai Lunas</button>`}
    </div>`;
  };
  return `<div class="grid g-3">
      <div class="card"><div class="stat-top"><span class="stat-label">Total unit aktif</span><span class="ic-sq sm ic-ink"><i class="bi bi-car-front"></i></span></div><div class="stat-value">${act.length} kendaraan</div><div class="hint">${act.filter(v => v.Jenis === 'Motor').length} motor • ${act.filter(v => v.Jenis === 'Mobil').length} mobil</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Jatuh tempo terdekat</span><span class="ic-sq sm ic-warn"><i class="bi bi-hourglass"></i></span></div><div class="stat-value">${dues[0] ? `${Math.max(dues[0].d, 0)} hari lagi` : '—'}</div><div class="hint">${dues[0] ? `${fmtDate(dues[0].date)} (${esc(dues[0].v.Nama)})` : 'Belum ada kendaraan'}</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Estimasi PKB per tahun</span><span class="ic-sq sm"><i class="bi bi-cash-coin"></i></span></div><div class="stat-value">${money(tot)}</div><div class="hint">Akumulasi semua unit</div></div>
    </div>
    ${act.length ? `<div class="grid g-2">${act.map(v => `<div class="card">
      <div class="card-head" style="margin-bottom:14px"><div class="card-title-ic"><span class="ic-sq"><i class="bi ${v.Jenis === 'Mobil' ? 'bi-car-front' : 'bi-scooter'}"></i></span><div><h3>${esc(v.Nama)}</h3><p>${esc(v.Jenis)}</p></div></div><span class="plate">${esc(v.Nopol)}</span></div>
      <div style="display:flex;flex-direction:column;gap:10px">${block(v, false)}${block(v, true)}</div>
      <div class="actions-row"><button class="btn btn-secondary btn-sm" onclick="openCrud('Kendaraan','${v.ID}')"><i class="bi bi-pencil"></i> Ubah data</button></div>
    </div>`).join('')}</div>`
      : `<div class="card">${emptyState('bi-car-front', 'Belum ada kendaraan', 'Tambahkan motor atau mobil agar pajak tahunan & STNK 5 tahunan diingatkan.', `<button class="btn btn-primary" onclick="openCrud('Kendaraan')"><i class="bi bi-plus-lg"></i> Tambah Kendaraan</button>`)}</div>`}
    ${hist.length ? `<div class="card flush">
      <div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ink"><i class="bi bi-clock-history"></i></span><div><h3>Riwayat Pembayaran Pajak</h3><p>${hist.length} pembayaran tercatat</p></div></div></div>
      <div class="table-wrap" style="margin-top:12px"><table class="tbl responsive"><thead><tr><th>Kendaraan</th><th>Jenis pajak</th><th>Tanggal bayar</th><th class="r">Nominal</th><th>Dibayar pakai</th><th>Bukti</th></tr></thead>
        <tbody>${hist.map(h => { const v = findBy('Kendaraan', h.KendaraanID) || { Nama: '(dihapus)', Nopol: '' };
          return `<tr><td><b>${esc(v.Nama)}</b><br><small class="muted">${esc(v.Nopol)}</small></td><td class="hide-m">${esc(h.Jenis)}</td><td>${fmtDate(h.TglBayar)}</td><td class="r"><b>${rp(h.Nominal)}</b></td><td class="hide-m">${esc(sourceName(h.DibayarPakai))}</td>
            <td class="hide-m">${h.Bukti ? `<a href="javascript:void(0)" onclick="openPreview('${jsq(h.Bukti)}')"><i class="bi bi-file-earmark-text"></i> Lihat bukti</a>` : String(h.ID).startsWith('RPJ-AUTO-') ? `<a href="javascript:void(0)" onclick="openPajakAdjust('${h.ID}')"><i class="bi bi-sliders"></i> Auto-debit • sesuaikan</a>` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table></div>
    </div>` : ''}`;
}

/* ───────────── HALAMAN: LAPORAN ───────────── */
function renderLaporan() {
  const n = S.laporanRange, months = lastMonths(n), m = thisYm(), prev = ymAdd(m, -1);
  const tots = months.map(x => monthTotals(x));
  const avgInc = tots.reduce((s, t) => s + t.inc, 0) / n, avgExp = tots.reduce((s, t) => s + t.exp, 0) / n;
  const sumInc = tots.reduce((s, t) => s + t.inc, 0), sumExp = tots.reduce((s, t) => s + t.exp, 0);
  const rate = sumInc ? Math.round((sumInc - sumExp) / sumInc * 1000) / 10 : 0;
  const cat = catRows(m, 6);
  const nowMap = expenseByCat(m), prevMap = expenseByCat(prev);
  const budgetRows = cats('Pengeluaran').map(c => {
    const real = nowMap[c.ID] ? nowMap[c.ID].total : 0, cnt = nowMap[c.ID] ? nowMap[c.ID].n : 0;
    const pv = prevMap[c.ID] ? prevMap[c.ID].total : 0;
    const trend = pv ? Math.round((real - pv) / pv * 1000) / 10 : (real ? null : 0);
    return { c, real, cnt, ang: num(c.Anggaran), pct: num(c.Anggaran) ? Math.round(real / num(c.Anggaran) * 1000) / 10 : null, trend };
  }).filter(r => r.real || r.ang).sort((a, b) => b.real - a.real);
  S._laporan = { months, tots, budgetRows };

  $('#page-laporan').innerHTML = `
    <div class="page-head">
      <div><span class="eyebrow"><i class="bi bi-bar-chart-line"></i> Laporan &amp; analisis</span><h1>Laporan Keuangan</h1><p>Analisis arus kas, proporsi pengeluaran, dan tren kategori bulanan.</p></div>
      <div class="head-actions">
        <div class="seg"><button class="${n === 6 ? 'on' : ''}" onclick="S.laporanRange=6; renderLaporan()">6 Bulan</button><button class="${n === 12 ? 'on' : ''}" onclick="S.laporanRange=12; renderLaporan()">12 Bulan</button></div>
        <span class="pill pill-gray" style="min-height:38px;padding:0 14px"><i class="bi bi-calendar3"></i> ${fmtYm(months[0])} – ${fmtYm(m)}</span>
        <button class="btn btn-secondary" onclick="exportLaporan('xlsx')"><i class="bi bi-file-earmark-spreadsheet"></i> Unduh Excel</button>
        <button class="btn btn-dark" onclick="exportLaporan('pdf')"><i class="bi bi-download"></i> Unduh PDF</button>
      </div>
    </div>
    <div class="grid g-3">
      <div class="card"><div class="stat-top"><span class="stat-label">Rata-rata pemasukan / bulan</span><span class="ic-sq sm ic-ok"><i class="bi bi-graph-up-arrow"></i></span></div><div class="stat-value">${money(avgInc)}</div><div class="hint">Total ${rp(sumInc)}</div></div>
      <div class="card"><div class="stat-top"><span class="stat-label">Rata-rata pengeluaran / bulan</span><span class="ic-sq sm ic-ink"><i class="bi bi-wallet2"></i></span></div><div class="stat-value">${money(avgExp)}</div><div class="hint">${sumInc ? Math.round(sumExp / sumInc * 1000) / 10 : 0}% dari pemasukan</div></div>
      <div class="card card-dark"><div class="stat-top"><span class="stat-label">Tabungan bersih &amp; rasio</span><i class="bi bi-shield-check" style="color:var(--primary)"></i></div><div class="stat-value accent">${money((sumInc - sumExp) / n)}<small style="font-size:13px;color:rgba(255,255,255,.6)"> /bln</small></div><span class="pill" style="background:var(--primary);color:#fff">${rate >= 0 ? 'Net positif' : 'Net negatif'} (${rate}%)</span></div>
    </div>
    <div class="grid g-2-1">
      <div class="card">
        <div class="card-head"><div><h3>Pemasukan vs Pengeluaran per Bulan</h3><p>${n} bulan terakhir</p></div><div class="legend-inline"><span><i style="background:#FF7A00"></i>Pemasukan</span><span><i style="background:var(--ink-2)"></i>Pengeluaran</span></div></div>
        <div class="chart-box" style="height:320px"><canvas id="lapBar" role="img" aria-label="Grafik bulanan"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Proporsi Pengeluaran</h3><p>Per kategori — ${fmtYm(m, true)}</p></div></div>
        ${cat.rows.length ? `<div class="donut-wrap"><canvas id="lapDonut" role="img" aria-label="Diagram kategori"></canvas><div class="donut-center"><div><small>TOTAL BELANJA</small><b>${rpShort(cat.sum)}</b></div></div></div>${legendHtml(cat.rows)}`
          : emptyState('bi-pie-chart', 'Belum ada data', 'Belum ada pengeluaran bulan ini.')}
      </div>
    </div>
    <div class="card flush">
      <div class="card-head"><div><h3>Rekap Anggaran &amp; Realisasi</h3><p>Bulan ${fmtYm(m, true)} dibanding bulan sebelumnya • atur anggaran di Pengaturan → Kategori</p></div></div>
      ${budgetRows.length ? `<div class="table-wrap" style="margin-top:12px"><table class="tbl responsive">
        <thead><tr><th>Kategori</th><th class="r">Transaksi</th><th class="r">Anggaran</th><th class="r">Realisasi</th><th>Terpakai</th><th class="r">Tren vs bln lalu</th></tr></thead>
        <tbody>${budgetRows.map(r => `<tr>
          <td><div class="cell-main"><span class="ic-sq sm" style="background:${esc(r.c.Warna)}1f;color:${esc(r.c.Warna)}"><i class="bi ${esc(r.c.Ikon)}"></i></span><b>${esc(r.c.Nama)}</b></div></td>
          <td class="r hide-m">${r.cnt} trx</td><td class="r hide-m">${r.ang ? rp(r.ang) : '<span class="muted">—</span>'}</td><td class="r"><b>${rp(r.real)}</b></td>
          <td class="m-full" style="min-width:150px">${r.pct != null ? `<div class="kv" style="padding:0 0 4px;font-size:12px"><span></span><b>${r.pct}%</b></div><div class="bar ${r.pct > 100 ? 'bad' : ''}"><span style="width:${Math.min(100, r.pct)}%"></span></div>` : '<span class="hint">Tanpa anggaran</span>'}</td>
          <td class="r hide-m">${r.trend == null ? '<span class="pill pill-gray">Baru</span>' : r.trend > 0 ? `<span class="pill pill-bad"><i class="bi bi-caret-up-fill"></i> ${r.trend}%</span>` : r.trend < 0 ? `<span class="pill pill-ok"><i class="bi bi-caret-down-fill"></i> ${-r.trend}%</span>` : '<span class="pill pill-gray">Stabil</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
        : `<div style="padding:0 24px 24px">${emptyState('bi-clipboard-data', 'Belum ada data', 'Laporan terisi otomatis dari transaksi Anda.')}</div>`}
    </div>`;
  drawBar('lapBar', 'lapBar', months);
  if (cat.rows.length) drawDonut('lapDonut', 'lapDonut', cat.rows);
}

/* ───────────── TIMESHEET & GAJI (daily rate) ─────────────
   Gaji = jumlah hari kerja × upah harian. Masuk sebagai pemasukan pada tanggal
   gajian (default 25). Jika jatuh di Sabtu/Minggu/tanggal merah → mundur ke hari
   kerja sebelumnya. Semua data disimpan di tab Pengaturan (tanpa ubah backend):
   gaji* = konfigurasi, ts_YYYY-MM = timesheet per bulan, tanggalMerahTambahan = libur tambahan. */
const LIBUR_NASIONAL = {
  // SKB 3 Menteri 2026
  '2026-01-01': 'Tahun Baru 2026 Masehi', '2026-01-16': "Isra Mi'raj Nabi Muhammad SAW", '2026-02-17': 'Tahun Baru Imlek 2577',
  '2026-03-19': 'Hari Suci Nyepi', '2026-03-21': 'Idul Fitri 1447 H', '2026-03-22': 'Idul Fitri 1447 H', '2026-04-03': 'Wafat Yesus Kristus',
  '2026-04-05': 'Paskah', '2026-05-01': 'Hari Buruh Internasional', '2026-05-14': 'Kenaikan Yesus Kristus', '2026-05-27': 'Idul Adha 1447 H',
  '2026-05-31': 'Hari Raya Waisak', '2026-06-01': 'Hari Lahir Pancasila', '2026-06-16': 'Tahun Baru Islam 1448 H', '2026-08-17': 'Proklamasi Kemerdekaan',
  '2026-08-25': 'Maulid Nabi Muhammad SAW', '2026-12-25': 'Hari Natal',
  // SKB 3 Menteri 2027
  '2027-01-01': 'Tahun Baru 2027 Masehi', '2027-01-05': 'Isra Mikraj Nabi Muhammad SAW', '2027-02-06': 'Tahun Baru Imlek 2578',
  '2027-03-08': 'Hari Suci Nyepi', '2027-03-10': 'Idulfitri 1448 H', '2027-03-11': 'Idulfitri 1448 H', '2027-03-26': 'Wafat Yesus Kristus',
  '2027-03-28': 'Paskah', '2027-05-01': 'Hari Buruh Internasional', '2027-05-06': 'Kenaikan Yesus Kristus', '2027-05-17': 'Iduladha 1448 H',
  '2027-05-20': 'Hari Raya Waisak', '2027-06-01': 'Hari Lahir Pancasila', '2027-06-06': 'Tahun Baru Islam 1449 H', '2027-08-15': 'Maulid Nabi Muhammad SAW',
  '2027-08-17': 'Proklamasi Kemerdekaan', '2027-12-25': 'Hari Natal', '2027-12-26': 'Isra Mikraj Nabi Muhammad SAW'
};
const CUTI_BERSAMA = {
  '2026-02-16': 'Cuti bersama Imlek', '2026-03-18': 'Cuti bersama Nyepi', '2026-03-20': 'Cuti bersama Idul Fitri', '2026-03-23': 'Cuti bersama Idul Fitri',
  '2026-03-24': 'Cuti bersama Idul Fitri', '2026-05-15': 'Cuti bersama Kenaikan Yesus Kristus', '2026-05-28': 'Cuti bersama Idul Adha', '2026-12-24': 'Cuti bersama Natal',
  '2027-02-05': 'Cuti bersama Imlek', '2027-03-09': 'Cuti bersama Idulfitri', '2027-03-12': 'Cuti bersama Idulfitri', '2027-03-15': 'Cuti bersama Idulfitri',
  '2027-03-25': 'Cuti bersama Wafat Yesus Kristus', '2027-05-18': 'Cuti bersama Iduladha', '2027-05-19': 'Cuti bersama Waisak', '2027-12-24': 'Cuti bersama Natal'
};
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function jsonSetting(k, def) { try { const v = JSON.parse(setting(k, '')); return v == null ? def : v; } catch (e) { return def; } }
function gajiCfg() {
  return {
    harian: num(setting('gajiHarian', 0)), akun: setting('gajiAkun', ''), tgl: Math.min(28, Math.max(1, num(setting('gajiTanggal', 25)) || 25)),
    pola: setting('gajiPola', '5'), cutoff: num(setting('gajiCutoff', 0)), mulai: setting('gajiMulai', ''), cuti: setting('gajiCutiBersama', '0') === '1'
  };
}
function liburTambahan() { return jsonSetting('tanggalMerahTambahan', []).filter(x => x && x.t); }
/** Nama tanggal merah (libur nasional, tambahan, dan cuti bersama bila diaktifkan) atau '' */
function namaLibur(ds, cfg) {
  if (LIBUR_NASIONAL[ds]) return LIBUR_NASIONAL[ds];
  const t = liburTambahan().find(x => x.t === ds); if (t) return t.n || 'Libur';
  if ((cfg || gajiCfg()).cuti && CUTI_BERSAMA[ds]) return CUTI_BERSAMA[ds];
  return '';
}
function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
/** Hari kerja menurut pola: 5 = Senin–Jumat, 6 = Senin–Sabtu; tanggal merah selalu libur */
function isPolaKerja(d, cfg) { const w = d.getDay(); return w !== 0 && (cfg.pola === '6' || w !== 6) && !namaLibur(dstr(d), cfg); }
/** Tanggal gajian bulan P: tanggal cfg.tgl, mundur bila Sabtu/Minggu/tanggal merah */
function tglGajian(P, cfg) {
  cfg = cfg || gajiCfg();
  const d = toDate(dateInYm(P, cfg.tgl));
  for (let i = 0; i < 15 && (isWeekend(d) || namaLibur(dstr(d), cfg)); i++) d.setDate(d.getDate() - 1);
  return dstr(d);
}
function alasanMundur(P, cfg) {
  const asli = dateInYm(P, cfg.tgl), d = toDate(asli);
  if (tglGajian(P, cfg) === asli) return '';
  return isWeekend(d) ? `${cfg.tgl} ${BULAN[d.getMonth()]} jatuh di hari ${HARI[d.getDay()]}` : `${cfg.tgl} ${BULAN[d.getMonth()]}: ${namaLibur(asli, cfg)}`;
}
/** Rentang tanggal periode timesheet bulan P */
function periodeTs(P, cfg) {
  if (!cfg.cutoff) return { dari: `${P}-01`, sampai: dateInYm(P, 31) };
  const prev = ymAdd(P, -1), e = toDate(dateInYm(prev, cfg.cutoff)); e.setDate(e.getDate() + 1);
  return { dari: dstr(e), sampai: dateInYm(P, cfg.cutoff) };
}
function tanggalPeriode(P, cfg) {
  const { dari, sampai } = periodeTs(P, cfg), out = [];
  for (let d = toDate(dari); dstr(d) <= sampai; d.setDate(d.getDate() + 1)) out.push(dstr(d));
  return out;
}
function defaultHariKerja(P, cfg) { return tanggalPeriode(P, cfg).filter(s => isPolaKerja(toDate(s), cfg)); }
/** Timesheet bulan P: tersimpan (ts_P) atau default dari pola kerja */
function timesheet(P, cfg) {
  cfg = cfg || gajiCfg();
  const sv = jsonSetting('ts_' + P, null);
  const days = sv && Array.isArray(sv.d) ? sv.d : defaultHariKerja(P, cfg);
  const upah = sv && num(sv.u) > 0 ? num(sv.u) : cfg.harian;
  return { P, days, hari: days.length, upah, total: Math.round(days.length * upah), tersimpan: !!sv, tgl: tglGajian(P, cfg) };
}
function gajiTrxId(P) { return `TRX-GJ-${P}`; }
function katGaji() { const c = cats('Pemasukan'); const g = c.find(k => k.Nama === 'Gaji') || c[0]; return g ? g.ID : ''; }
function gajiTrxRec(ts, cfg, ex) {
  return { ID: gajiTrxId(ts.P), Tanggal: ts.tgl, Jenis: 'Pemasukan', Kategori: ex ? ex.Kategori : katGaji(), Keterangan: `Gaji ${fmtYm(ts.P, true)}`,
    Nominal: ts.total, SumberDana: ex ? ex.SumberDana : cfg.akun, Referensi: 'TIMESHEET',
    Catatan: `Timesheet: ${ts.hari} hari × ${rp(ts.upah)}`, Bukti: ex ? ex.Bukti : '', Dibuat: ex ? ex.Dibuat : new Date().toISOString(), Diubah: ex ? new Date().toISOString() : '' };
}
/** Dipanggil dari autoPost(): catat gaji yang tanggal gajiannya sudah tiba */
function gajiOps(notes) {
  const cfg = gajiCfg(), ops = [];
  if (!cfg.akun || !cfg.mulai || !akun(cfg.akun)) return ops;
  for (let P = cfg.mulai, n = 0; P <= thisYm() && n < 36; P = ymAdd(P, 1), n++) {
    const ts = timesheet(P, cfg);
    if (daysUntil(ts.tgl) > 0 || ts.total <= 0 || findBy('Transaksi', gajiTrxId(P))) continue;
    ops.push(up('Transaksi', gajiTrxRec(ts, cfg))); notes.push(`Gaji ${fmtYm(P, true)} masuk: ${rp(ts.total)}`);
  }
  return ops;
}

// ── UI ──
function gajiSetYm(P) { S.gajiYm = P; S.tsDraft = null; renderPengaturan(); }
function tsDraft() {
  const P = S.gajiYm || thisYm();
  if (!S.tsDraft || S.tsDraft.P !== P) { const ts = timesheet(P); S.tsDraft = { P, days: new Set(ts.days), upah: ts.upah, dirty: false }; }
  return S.tsDraft;
}
function tsToggle(ds) { const d = tsDraft(); d.days.has(ds) ? d.days.delete(ds) : d.days.add(ds); d.dirty = true; renderPengaturan(); }
function tsIsi(mode) {
  const d = tsDraft(), cfg = gajiCfg();
  d.days = new Set(mode === 'kosong' ? [] : defaultHariKerja(d.P, cfg)); d.dirty = true; renderPengaturan();
}
function tsUpah(v) { const d = tsDraft(); d.upah = parseMoney(v); d.dirty = true; const el = $('#tsTotal'); if (el) el.innerHTML = money(d.days.size * d.upah); }
function saveTimesheet() {
  const d = tsDraft(), cfg = gajiCfg();
  const days = Array.from(d.days).sort();
  const rec = { d: days }; if (d.upah && d.upah !== cfg.harian) rec.u = d.upah;
  const ops = [up('Pengaturan', { Kunci: 'ts_' + d.P, Nilai: JSON.stringify(rec) })];
  applyOps(ops.slice()); // agar timesheet() membaca nilai baru
  const ex = findBy('Transaksi', gajiTrxId(d.P));
  if (ex) { const ts = timesheet(d.P, cfg); if (ts.total > 0) ops.push(up('Transaksi', gajiTrxRec(ts, cfg, ex))); else ops.push(del('Transaksi', ex.ID)); }
  S.tsDraft = null;
  commit(ops, ex ? 'Timesheet disimpan • pemasukan gaji diperbarui' : 'Timesheet disimpan');
}
function saveGajiCfg() {
  const v = id => $('#' + id).value;
  const harian = parseMoney(v('gjHarian')), akunId = v('gjAkun');
  if (!harian) { toast('Isi upah harian terlebih dahulu', 'error'); return; }
  if (!akunId) { toast('Pilih akun penerima gaji', 'error'); return; }
  const kv = { gajiHarian: harian, gajiAkun: akunId, gajiTanggal: Math.min(28, Math.max(1, num(v('gjTgl')) || 25)), gajiPola: v('gjPola'),
    gajiCutoff: v('gjCutoff'), gajiMulai: v('gjMulai') || thisYm(), gajiCutiBersama: $('#gjCuti').checked ? '1' : '0' };
  S.tsDraft = null;
  commit(Object.keys(kv).map(k => up('Pengaturan', { Kunci: k, Nilai: String(kv[k]) })), 'Pengaturan gaji disimpan');
}
function addLibur() {
  const t = $('#lbTgl').value, n = $('#lbNama').value.trim();
  if (!t) { toast('Pilih tanggal libur', 'error'); return; }
  const list = liburTambahan().filter(x => x.t !== t); list.push({ t, n: n || 'Libur' }); list.sort((a, b) => a.t.localeCompare(b.t));
  S.tsDraft = null; commit([up('Pengaturan', { Kunci: 'tanggalMerahTambahan', Nilai: JSON.stringify(list) })], 'Tanggal merah ditambahkan');
}
function delLibur(t) {
  S.tsDraft = null;
  commit([up('Pengaturan', { Kunci: 'tanggalMerahTambahan', Nilai: JSON.stringify(liburTambahan().filter(x => x.t !== t)) })], 'Tanggal merah dihapus');
}

function renderGajiTab() {
  const cfg = gajiCfg(), P = S.gajiYm || thisYm(), dr = tsDraft();
  const siap = cfg.harian > 0 && cfg.akun && akun(cfg.akun);
  const tgl = tglGajian(P, cfg), alasan = alasanMundur(P, cfg), sudah = findBy('Transaksi', gajiTrxId(P));
  const total = dr.days.size * dr.upah, dUntil = daysUntil(tgl);
  const status = sudah ? `<span class="pill pill-ok pill-dot">Sudah masuk ${rp(sudah.Nominal)}</span>`
    : !siap ? '<span class="pill pill-gray">Lengkapi pengaturan</span>'
    : P < (cfg.mulai || thisYm()) ? '<span class="pill pill-gray">Sebelum mulai dicatat</span>'
    : dUntil > 0 ? `<span class="pill pill-warn">${dUntil} hari lagi</span>` : '<span class="pill pill-gray">Menunggu</span>';

  // Kalender timesheet
  const per = periodeTs(P, cfg), dates = tanggalPeriode(P, cfg);
  const lead = (toDate(per.dari).getDay() + 6) % 7; // Senin = kolom pertama
  const cells = Array(lead).fill('<span class="ts-day empty"></span>').concat(dates.map(ds => {
    const d = toDate(ds), on = dr.days.has(ds), lib = namaLibur(ds, cfg), wk = isWeekend(d);
    const cls = ['ts-day', on ? 'on' : '', lib ? 'merah' : wk ? 'wk' : '', ds === today() ? 'now' : '', ds === tgl ? 'payday' : ''].join(' ');
    const title = `${HARI[d.getDay()]}, ${fmtDate(ds, true)}${lib ? ' • ' + lib : ''}${on ? ' • masuk kerja' : ' • tidak masuk'}`;
    return `<button class="${cls}" onclick="tsToggle('${ds}')" title="${esc(title)}" aria-pressed="${on}" aria-label="${esc(title)}"><b>${d.getDate()}</b>${d.getDate() === 1 && cfg.cutoff ? `<small>${BULAN[d.getMonth()]}</small>` : ''}</button>`;
  })).join('');

  // Riwayat 12 bulan
  const mulai = cfg.mulai || thisYm(), rows = [];
  for (let i = 0, M = ymAdd(thisYm(), 1); i < 24 && M >= mulai; i++, M = ymAdd(M, -1)) rows.push(M);
  const riwayat = rows.map(M => {
    const ts = timesheet(M, cfg), t = findBy('Transaksi', gajiTrxId(M));
    const st = t ? '<span class="pill pill-ok">Masuk</span>' : M < mulai ? '<span class="pill pill-gray">—</span>' : daysUntil(ts.tgl) > 0 ? '<span class="pill pill-warn">Terjadwal</span>' : '<span class="pill pill-gray">Menunggu</span>';
    return `<tr class="${M === P ? 'sel' : ''}" style="cursor:pointer" onclick="gajiSetYm('${M}')"><td class="nw"><b>${fmtYm(M)}</b>${ts.tersimpan ? '' : '<small class="muted hide-m"> • default</small>'}</td>
      <td class="r">${ts.hari}</td><td class="r hide-m nw">${rp(ts.upah)}</td><td class="r nw"><b>${rp(t ? t.Nominal : ts.total)}</b></td><td class="hide-m nw">${HARI[toDate(ts.tgl).getDay()].slice(0, 3)}, ${fmtDate(ts.tgl)}</td><td>${st}</td></tr>`;
  }).join('');

  // Tanggal merah tahun yang dilihat
  const th = P.slice(0, 4);
  const libs = Object.keys(LIBUR_NASIONAL).filter(k => k.startsWith(th)).map(k => ({ t: k, n: LIBUR_NASIONAL[k], j: 'Nasional' }))
    .concat(cfg.cuti ? Object.keys(CUTI_BERSAMA).filter(k => k.startsWith(th)).map(k => ({ t: k, n: CUTI_BERSAMA[k], j: 'Cuti bersama' })) : [])
    .concat(liburTambahan().filter(x => x.t.startsWith(th)).map(x => ({ t: x.t, n: x.n, j: 'Tambahan' })))
    .sort((a, b) => a.t.localeCompare(b.t));

  const opt = (v, l, cur) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${l}</option>`;
  return `
  ${siap ? '' : `<div class="callout" style="margin-bottom:16px"><i class="bi bi-info-circle"></i><div><b>Mulai di sini:</b> isi upah harian dan akun penerima gaji, lalu simpan. Gaji akan otomatis tercatat sebagai pemasukan pada tanggal gajian.</div></div>`}
  <div class="grid g-2" style="margin-bottom:20px">
    <div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-cash-coin"></i></span><div><h3>Pengaturan Gaji</h3><p>Gaji = hari kerja × upah harian</p></div></div></div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="field"><label class="lbl" for="gjHarian">Upah harian (daily rate)</label><div class="money-input"><input class="input" id="gjHarian" inputmode="numeric" autocomplete="off" placeholder="0" value="${fmtMoneyInput(cfg.harian)}" oninput="this.value=fmtMoneyInput(this.value)"></div></div>
        <div class="grid g-2 pair-sm" style="margin:0;gap:12px">
          <div class="field"><label class="lbl" for="gjPola">Hari kerja</label><select class="input" id="gjPola">${opt('5', 'Senin–Jumat', cfg.pola)}${opt('6', 'Senin–Sabtu', cfg.pola)}</select></div>
          <div class="field"><label class="lbl" for="gjTgl">Tanggal gajian</label><input class="input" id="gjTgl" type="number" min="1" max="28" value="${cfg.tgl}"></div>
        </div>
        <div class="field"><label class="lbl" for="gjCutoff">Periode timesheet</label><select class="input" id="gjCutoff">${opt(0, 'Bulan kalender (tgl 1 – akhir bulan)', cfg.cutoff)}${[20, 25].map(c => opt(c, `Tgl ${c + 1} bulan lalu – tgl ${c} bulan ini`, cfg.cutoff)).join('')}</select></div>
        <div class="field"><label class="lbl" for="gjAkun">Gaji masuk ke akun</label><select class="input" id="gjAkun"><option value="">Pilih akun…</option>${sourceOptions(false).map(o => opt(o.v, esc(o.l), cfg.akun)).join('')}</select></div>
        <div class="field"><label class="lbl" for="gjMulai">Mulai dicatat otomatis</label><input class="input" id="gjMulai" type="month" value="${cfg.mulai || thisYm()}"></div>
        <label class="check-row"><input type="checkbox" id="gjCuti" ${cfg.cuti ? 'checked' : ''}> Cuti bersama dihitung tanggal merah</label>
        <button class="btn btn-primary" onclick="saveGajiCfg()"><i class="bi bi-check2"></i> Simpan pengaturan</button>
      </div></div>
    <div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ok"><i class="bi bi-calendar2-check"></i></span><div><h3>Gaji ${fmtYm(P, true)}</h3><p>Periode ${fmtDate(per.dari)} – ${fmtDate(per.sampai)}</p></div></div>${status}</div>
      <div class="gaji-sum"><span>${dr.days.size} hari</span><i class="bi bi-x"></i><span>${rp(dr.upah)}</span></div>
      <div class="kv"><span>Total gaji</span><b class="big" id="tsTotal">${money(total)}</b></div>
      <div class="kv"><span>Masuk ke</span><b>${cfg.akun ? esc(sourceName(cfg.akun)) : '—'}</b></div>
      <div class="kv"><span>Tanggal gaji masuk</span><b>${HARI[toDate(tgl).getDay()]}, ${fmtDate(tgl, true)}</b></div>
      ${alasan ? `<div class="callout gray" style="margin-top:10px"><i class="bi bi-arrow-left-circle"></i><div>${esc(alasan)}, jadi gaji dimajukan ke hari kerja sebelumnya.</div></div>` : ''}
      ${dr.dirty ? '<div class="callout" style="margin-top:10px"><i class="bi bi-pencil"></i><div>Timesheet berubah — klik <b>Simpan timesheet</b>.</div></div>' : ''}
    </div>
  </div>

  <div class="card" style="margin-bottom:20px">
    <div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ink"><i class="bi bi-calendar3"></i></span><div><h3>Timesheet</h3><p>Ketuk tanggal untuk menandai masuk / tidak masuk kerja</p></div></div>
      <div class="ts-nav"><button class="btn-icon" onclick="gajiSetYm('${ymAdd(P, -1)}')" aria-label="Bulan sebelumnya"><i class="bi bi-chevron-left"></i></button><b>${fmtYm(P, true)}</b><button class="btn-icon" onclick="gajiSetYm('${ymAdd(P, 1)}')" aria-label="Bulan berikutnya"><i class="bi bi-chevron-right"></i></button></div></div>
    <div class="ts-grid">${['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(h => `<span class="ts-h">${h}</span>`).join('')}${cells}</div>
    <div class="ts-legend"><span><i class="lg on"></i>Masuk kerja</span><span><i class="lg"></i>Tidak masuk</span><span><i class="lg merah"></i>Tanggal merah</span><span><i class="lg payday"></i>Gaji masuk</span></div>
    <div class="ts-foot">
      <div class="field" style="flex:1;min-width:180px"><label class="lbl" for="tsUpah">Upah harian bulan ini</label><div class="money-input"><input class="input" id="tsUpah" inputmode="numeric" autocomplete="off" value="${fmtMoneyInput(dr.upah)}" oninput="this.value=fmtMoneyInput(this.value); tsUpah(this.value)"></div></div>
      <div class="actions-row" style="margin:0">
        <button class="btn btn-ghost btn-sm" onclick="tsIsi('kosong')"><i class="bi bi-eraser"></i> Kosongkan</button>
        <button class="btn btn-secondary btn-sm" onclick="tsIsi('default')"><i class="bi bi-magic"></i> Isi hari kerja</button>
        <button class="btn btn-primary btn-sm" onclick="saveTimesheet()"><i class="bi bi-check2"></i> Simpan timesheet</button>
      </div>
    </div>
  </div>

  <div class="grid g-1" style="margin:0">
    <div class="card flush"><div class="card-head"><div><h3>Riwayat Gaji</h3><p>Klik baris untuk membuka timesheet bulan itu</p></div></div>
      <div class="table-wrap" style="margin-top:12px"><table class="tbl tbl-gaji"><thead><tr><th>Bulan</th><th class="r">Hari</th><th class="r hide-m">Upah/hari</th><th class="r">Total</th><th class="hide-m">Tgl masuk</th><th>Status</th></tr></thead><tbody>${riwayat || '<tr><td colspan="6" class="muted">Belum ada data</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm" style="background:var(--danger-soft);color:var(--danger)"><i class="bi bi-calendar-x"></i></span><div><h3>Tanggal Merah ${th}</h3><p>Libur nasional SKB 3 Menteri + tambahan Anda</p></div></div></div>
      <div class="libur-list">${libs.length ? libs.map(x => `<div class="libur-item"><b>${fmtDate(x.t)}</b><span>${esc(x.n)}<small>${x.j}</small></span>${x.j === 'Tambahan' ? `<button class="btn-icon danger" onclick="delLibur('${x.t}')" aria-label="Hapus"><i class="bi bi-x-lg"></i></button>` : ''}</div>`).join('') : '<p class="muted">Belum ada data libur untuk tahun ini — tambahkan di bawah.</p>'}</div>
      <div class="grid g-2 pair-sm" style="margin:14px 0 10px;gap:10px"><input class="input" type="date" id="lbTgl" aria-label="Tanggal"><input class="input" id="lbNama" maxlength="40" placeholder="Keterangan" aria-label="Keterangan"></div>
      <button class="btn btn-secondary btn-sm" onclick="addLibur()"><i class="bi bi-plus-lg"></i> Tambah tanggal merah</button>
    </div>
  </div>`;
}

/* ───────────── HALAMAN: PENGATURAN ───────────── */
function setSettingsTab(t) { S.settingsTab = t; if (S.page === 'pengaturan') renderPengaturan(); }

function renderPengaturan() {
  const tab = S.settingsTab;
  const menu = [
    ['akun', 'bi-wallet2', 'Akun & Dompet', S.data.Akun.length], ['kartu', 'bi-credit-card', 'Kartu Kredit', S.data.Kartu_Kredit.length],
    ['kategori', 'bi-tags', 'Kategori Transaksi', S.data.Kategori.length], ['kendaraan', 'bi-car-front', 'Kendaraan', S.data.Kendaraan.length],
    ['gaji', 'bi-calendar-check', 'Timesheet & Gaji', ''],
    ['pengingat', 'bi-alarm', 'Pengingat & Profil', ''], ['tampilan', 'bi-circle-half', 'Tampilan', ''], ['penyimpanan', 'bi-cloud-check', 'Penyimpanan & Cadangan', ''], ['keamanan', 'bi-shield-lock', 'Keamanan & Login', '']
  ];
  let content = '';
  const listCard = (title, sub, sheet, rows, cols) => `<div class="card flush">
    <div class="card-head"><div><h3>${title}</h3><p>${sub}</p></div><button class="btn btn-primary btn-sm" onclick="openCrud('${sheet}')"><i class="bi bi-plus-lg"></i> Tambah</button></div>
    ${rows.length ? `<div class="table-wrap" style="margin-top:12px"><table class="tbl responsive"><thead><tr>${cols.map(c => `<th class="${c.r ? 'r' : ''}">${c.h}</th>`).join('')}<th class="r">Aksi</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${isActive(r) ? '' : 'inactive'}">${cols.map(c => `<td class="${c.r ? 'r' : ''} ${c.m || ''}">${c.f(r)}</td>`).join('')}
        <td class="r"><div class="row-actions"><button class="btn-icon" onclick="openCrud('${sheet}','${r.ID}')" aria-label="Ubah"><i class="bi bi-pencil"></i></button><button class="btn-icon danger" onclick="deleteRow('${sheet}','${r.ID}','${jsq(r.Nama)}')" aria-label="Hapus"><i class="bi bi-trash"></i></button></div></td></tr>`).join('')}</tbody></table></div>`
      : `<div style="padding:0 24px 24px">${emptyState('bi-inbox', 'Belum ada data', 'Klik Tambah untuk mulai.')}</div>`}</div>`;
  const statusPill = r => isActive(r) ? '<span class="pill pill-ok pill-dot">Aktif</span>' : '<span class="pill pill-gray">Nonaktif</span>';

  if (tab === 'akun') content = listCard('Akun & Dompet', 'Rekening bank, tunai, dan e-wallet sebagai sumber dana', 'Akun', S.data.Akun, [
    { h: 'Nama', f: r => `<div class="cell-main"><span class="ic-sq sm"><i class="bi ${r.Tipe === 'Tunai' ? 'bi-cash' : r.Tipe === 'E-wallet' ? 'bi-phone' : 'bi-bank'}"></i></span><div><b>${esc(r.Nama)}</b><small>${esc(r.Tipe)}</small></div></div>` },
    { h: 'Saldo awal', r: 1, m: 'hide-m', f: r => rp(r.SaldoAwal) }, { h: 'Saldo kini', r: 1, f: r => `<b>${rp(saldoAkun(r))}</b>` }, { h: 'Status', m: 'hide-m', f: statusPill }]);
  else if (tab === 'kartu') content = listCard('Kartu Kredit', 'Tanggal cetak, jatuh tempo, dan jarak pengingat per kartu', 'Kartu_Kredit', S.data.Kartu_Kredit, [
    { h: 'Kartu', f: r => `<div class="cell-main">${ccThumb(r)}<div><b>${esc(r.Nama)}</b><small>${esc(r.Bank)} •••• ${esc(r.Digit4)}</small></div></div>` },
    { h: 'Limit', r: 1, m: 'hide-m', f: r => rp(r.Limit) }, { h: 'Cetak / tempo', f: r => `Tgl ${r.TglCetak} / ${r.TglJatuhTempo}` }, { h: 'Pengingat', m: 'hide-m', f: r => `H-${remindDays(r)}` }, { h: 'Status', m: 'hide-m', f: statusPill }]);
  else if (tab === 'kategori') content = listCard('Kategori Transaksi', 'Ikon, warna, dan anggaran bulanan per kategori', 'Kategori', S.data.Kategori.slice().sort((a, b) => a.Jenis.localeCompare(b.Jenis)), [
    { h: 'Ikon & nama', f: r => `<div class="cell-main"><span class="ic-sq sm" style="background:${esc(r.Warna)}1f;color:${esc(r.Warna)}"><i class="bi ${esc(r.Ikon)}"></i></span><b>${esc(r.Nama)}</b></div>` },
    { h: 'Jenis', f: r => `<span class="pill ${r.Jenis === 'Pemasukan' ? 'pill-ok' : 'pill-gray'}">${esc(r.Jenis)}</span>` },
    { h: 'Warna', m: 'hide-m', f: r => `<span class="swatch" style="background:${esc(r.Warna)}"></span><code>${esc(r.Warna)}</code>` },
    { h: 'Anggaran / bln', r: 1, m: 'hide-m', f: r => num(r.Anggaran) ? rp(r.Anggaran) : '<span class="muted">—</span>' }, { h: 'Status', m: 'hide-m', f: statusPill }]);
  else if (tab === 'kendaraan') content = listCard('Kendaraan', 'Data untuk pengingat pajak tahunan & STNK 5 tahunan', 'Kendaraan', S.data.Kendaraan, [
    { h: 'Kendaraan', f: r => `<div class="cell-main"><span class="ic-sq sm ic-ink"><i class="bi ${r.Jenis === 'Mobil' ? 'bi-car-front' : 'bi-scooter'}"></i></span><div><b>${esc(r.Nama)}</b><small>${esc(r.Nopol)}</small></div></div>` },
    { h: 'Pajak tahunan', m: 'hide-m', f: r => fmtDate(r.JatuhTempoTahunan) }, { h: 'STNK 5 thn', m: 'hide-m', f: r => fmtDate(r.JatuhTempo5Th) }, { h: 'Status', m: 'hide-m', f: statusPill }]);
  else if (tab === 'gaji') content = renderGajiTab();
  else if (tab === 'pengingat') {
    const d = num(setting('pengingatDefault', 7));
    content = `<div class="grid g-2" style="margin:0">
      <div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-alarm"></i></span><div><h3>Jarak Pengingat Default</h3><p>Berlaku untuk item tanpa pengaturan sendiri</p></div></div></div>
        <div class="callout" style="margin-bottom:16px"><i class="bi bi-info-circle"></i><div><b>Catatan:</b> pengingat dihitung saat aplikasi dibuka (tanpa email &amp; tanpa trigger latar belakang).</div></div>
        <div class="stepper"><button onclick="saveSetting('pengingatDefault', Math.max(1, ${d} - 1))" aria-label="Kurangi">−</button><b>${d}</b><button onclick="saveSetting('pengingatDefault', Math.min(60, ${d} + 1))" aria-label="Tambah">+</button></div>
        <p class="hint">hari sebelum jatuh tempo</p>
        <div class="choice-chips">${[3, 7, 14].map(x => `<button class="${d === x ? 'on' : ''}" onclick="saveSetting('pengingatDefault', ${x})">${x} hari${x === 7 ? ' (default)' : ''}</button>`).join('')}</div>
      </div>
      <div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ink"><i class="bi bi-person"></i></span><div><h3>Profil</h3><p>Nama yang tampil di aplikasi</p></div></div></div>
        <div class="field"><label class="lbl" for="setNama">Nama panggilan</label><input class="input" id="setNama" maxlength="30" value="${esc(setting('namaPemilik', 'Pemilik'))}"></div>
        <button class="btn btn-primary" style="margin-top:14px" onclick="saveSetting('namaPemilik', $('#setNama').value.trim() || 'Pemilik'); toast('Profil disimpan','success')"><i class="bi bi-check2"></i> Simpan</button>
      </div></div>`;
  } else if (tab === 'tampilan') {
    const th = document.documentElement.getAttribute('data-theme');
    content = `<div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-palette"></i></span><div><h3>Mode Tampilan</h3><p>Disimpan di perangkat ini</p></div></div></div>
      <div class="theme-opts">
        <button class="theme-opt ${th === 'light' ? 'on' : ''}" onclick="setTheme('light')"><i class="bi bi-sun"></i><b>Mode Terang</b><small class="muted">${th === 'light' ? 'Aktif digunakan' : 'Latar putih bersih'}</small></button>
        <button class="theme-opt ${th === 'dark' ? 'on' : ''}" onclick="setTheme('dark')"><i class="bi bi-moon-stars"></i><b>Mode Gelap</b><small class="muted">${th === 'dark' ? 'Aktif digunakan' : 'Nyaman di malam hari'}</small></button>
      </div><p class="hint" style="margin-top:12px"><i class="bi bi-info-circle"></i> Bisa juga diganti cepat lewat ikon bulan/matahari di bilah atas.</p></div>`;
  } else if (tab === 'keamanan') {
    const ses = Sesi.get();
    content = `<div class="grid g-2" style="margin:0">
      <div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm"><i class="bi bi-key"></i></span><div><h3>Ganti Password</h3><p>Minimal 8 karakter, huruf + angka</p></div></div></div>
        <form id="pwForm" novalidate style="display:flex;flex-direction:column;gap:12px">
          <div class="field"><label class="lbl" for="pwLama">Password lama</label><input class="input" type="password" id="pwLama" autocomplete="current-password"></div>
          <div class="field"><label class="lbl" for="pwBaru">Password baru</label><input class="input" type="password" id="pwBaru" autocomplete="new-password"></div>
          <div class="field"><label class="lbl" for="pwUlang">Ulangi password baru</label><input class="input" type="password" id="pwUlang" autocomplete="new-password"></div>
          <button class="btn btn-primary" type="submit"><i class="bi bi-check2"></i> Simpan password</button>
          <p class="hint" style="margin:0">Setelah diganti, semua perangkat lain otomatis dikeluarkan.</p>
        </form></div>
      <div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ink"><i class="bi bi-phone"></i></span><div><h3>Sesi Perangkat</h3><p>Perangkat ini</p></div></div></div>
        <div class="kv"><span>Sesi berlaku sampai</span><b>${ses ? new Date(ses.exp).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</b></div>
        <div class="actions-row">
          <button class="btn btn-secondary" onclick="logoutDevice()"><i class="bi bi-box-arrow-right"></i> Keluar dari perangkat ini</button>
          <button class="btn btn-ghost" style="color:var(--danger-ink)" onclick="logoutAllDevices()"><i class="bi bi-phone-vibrate"></i> Keluar dari semua perangkat</button>
        </div>
        <div class="callout gray" style="margin-top:14px"><i class="bi bi-info-circle"></i><div>Lupa password? Buka editor Apps Script, jalankan <b>resetPassword</b>, lalu pakai kode aktivasi baru dari log eksekusi.</div></div>
      </div></div>`;
  } else {
    const info = S.storageInfo;
    content = `<div class="card"><div class="card-head"><div class="card-title-ic"><span class="ic-sq sm ic-ok"><i class="bi bi-google"></i></span><div><h3>Penyimpanan Google Drive &amp; Sheets</h3><p>Data tersimpan di Google Workspace pribadi Anda</p></div></div></div>
      <div class="grid g-2" style="margin-bottom:16px">
        <div class="subbox"><div class="stat-label">Spreadsheet database</div><b>${info ? esc(info.spreadsheetName) : 'Memuat…'}</b><div class="hint">12 tab • akses hanya pemilik</div>${info ? `<a class="btn-link" href="${esc(info.spreadsheetUrl)}" target="_blank" rel="noopener">Buka Sheets <i class="bi bi-box-arrow-up-right"></i></a>` : ''}</div>
        <div class="subbox"><div class="stat-label">Folder bukti bayar</div><b>${info ? esc(info.folderName) : 'Memuat…'}</b><div class="hint">Google Drive</div>${info ? `<a class="btn-link" href="${esc(info.folderUrl)}" target="_blank" rel="noopener">Buka folder <i class="bi bi-box-arrow-up-right"></i></a>` : ''}</div>
      </div>
      <div class="callout gray"><i class="bi bi-shield-lock"></i><div style="flex:1"><b>Privasi:</b> tanpa email, tanpa koneksi bank. Cadangan bisa diunduh kapan saja.</div><button class="btn btn-secondary btn-sm" onclick="exportBackup()"><i class="bi bi-download"></i> Unduh cadangan .xlsx</button></div>
      <div class="kv" style="margin-top:14px"><span>Antrean sinkron</span><b>${S.queue.length ? S.queue.length + ' menunggu' : 'Semua tersinkron'}</b></div>
      <button class="btn btn-secondary btn-sm" style="margin-top:8px" onclick="loadFromServer()"><i class="bi bi-arrow-clockwise"></i> Muat ulang data dari server</button></div>`;
    if (!info) api('getStorageInfo').then(r => { if (r.success) { S.storageInfo = r.data; if (S.page === 'pengaturan' && S.settingsTab === 'penyimpanan') renderPengaturan(); } }).catch(() => {});
  }

  setTimeout(() => { const f = document.getElementById('pwForm'); if (f) f.onsubmit = submitChangePassword; }, 0);
  $('#page-pengaturan').innerHTML = `
    <div class="page-head"><div><span class="eyebrow"><i class="bi bi-gear"></i> Preferensi &amp; master data</span><h1>Pengaturan</h1><p>Kelola akun, kartu, kategori, kendaraan, timesheet gaji, jadwal pengingat, dan penyimpanan.</p></div></div>
    <div class="grid g-1-2">
      <div class="card" style="padding:0"><div class="set-menu"><span class="eyebrow">Pengaturan umum</span>
        ${menu.map(([id, ic, l, c]) => `<button class="set-item ${tab === id ? 'on' : ''}" onclick="setSettingsTab('${id}')"><i class="bi ${ic}"></i> ${l}${c !== '' ? `<span class="cnt">${c}</span>` : ''}</button>`).join('')}
      </div></div>
      <div>${content}</div>
    </div>`;
}

/* ───────────── EKSPOR (pustaka dimuat saat dibutuhkan saja) ───────────── */
const _scripts = {};
function loadScript(src) {
  if (!_scripts[src]) _scripts[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Gagal memuat ' + src)); document.head.appendChild(s); });
  return _scripts[src];
}
const LIB = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
};
async function exportXlsx(sheets, filename) {
  toast('Menyiapkan Excel…', 'info');
  await loadScript(LIB.xlsx);
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31)));
  XLSX.writeFile(wb, filename);
}
async function exportPdf(title, subtitle, head, body, filename) {
  toast('Menyiapkan PDF…', 'info');
  await loadScript(LIB.jspdf); await loadScript(LIB.autotable);
  const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(title, 40, 50);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(107); doc.text(subtitle, 40, 68);
  doc.autoTable({ head: [head], body, startY: 86, styles: { fontSize: 9, cellPadding: 6 }, headStyles: { fillColor: [18, 18, 18], textColor: 255 }, alternateRowStyles: { fillColor: [246, 246, 247] } });
  doc.save(filename);
}
function trxRows(list) {
  return list.map(t => ({ ID: t.ID, Tanggal: t.Tanggal, Jenis: t.Jenis, Kategori: catInfo(t.Kategori).Nama, Keterangan: t.Keterangan, 'Sumber Dana': sourceName(t.SumberDana), Nominal: num(t.Nominal), Catatan: t.Catatan }));
}
async function exportTrx(kind) {
  try {
    const list = filteredTrx();
    if (!list.length) { toast('Tidak ada data untuk diunduh.', 'warning'); return; }
    const fn = `Transaksi_${today()}`;
    if (kind === 'xlsx') await exportXlsx([{ name: 'Transaksi', rows: trxRows(list) }], fn + '.xlsx');
    else await exportPdf('Daftar Transaksi', `Keuangan Digital • dicetak ${fmtDate(today(), true)} • ${list.length} transaksi`,
      ['Tanggal', 'Keterangan', 'Kategori', 'Sumber', 'Jenis', 'Nominal'], list.map(t => [fmtDate(t.Tanggal), t.Keterangan, catInfo(t.Kategori).Nama, sourceName(t.SumberDana), t.Jenis, rp(t.Nominal)]), fn + '.pdf');
  } catch (e) { toast(e.message, 'error'); }
}
async function exportLaporan(kind) {
  try {
    const L = S._laporan; if (!L) return;
    const monthly = L.months.map((m, i) => ({ Bulan: fmtYm(m, true), Pemasukan: L.tots[i].inc, Pengeluaran: L.tots[i].exp, Selisih: L.tots[i].net }));
    const cat = L.budgetRows.map(r => ({ Kategori: r.c.Nama, Transaksi: r.cnt, Anggaran: r.ang, Realisasi: r.real, 'Terpakai (%)': r.pct == null ? '' : r.pct }));
    const fn = `Laporan_${thisYm()}`;
    if (kind === 'xlsx') await exportXlsx([{ name: 'Bulanan', rows: monthly }, { name: 'Kategori ' + thisYm(), rows: cat }], fn + '.xlsx');
    else await exportPdf('Laporan Keuangan', `${fmtYm(L.months[0], true)} – ${fmtYm(thisYm(), true)} • dicetak ${fmtDate(today(), true)}`,
      ['Bulan', 'Pemasukan', 'Pengeluaran', 'Selisih'], monthly.map(r => [r.Bulan, rp(r.Pemasukan), rp(r.Pengeluaran), rp(r.Selisih)]), fn + '.pdf');
  } catch (e) { toast(e.message, 'error'); }
}
async function exportBackup() {
  try { await exportXlsx(SHEETS.map(s => ({ name: s, rows: S.data[s].length ? S.data[s] : [{}] })), `Cadangan_KeuanganDigital_${today()}.xlsx`); }
  catch (e) { toast(e.message, 'error'); }
}

/* ───────────── LOGIN, AKTIVASI & KELUAR ───────────── */
function authMsg(text, info) {
  const m = $('#authMsg');
  m.hidden = !text; m.textContent = text || ''; m.className = 'auth-msg' + (info ? ' info' : '');
}
function pwField(id, label, auto) {
  return `<div class="field"><label class="lbl" for="${id}">${label}</label><div class="pw-wrap">
    <input class="input" type="password" id="${id}" autocomplete="${auto}" required>
    <button type="button" aria-label="Tampilkan password" onclick="const i=document.getElementById('${id}'); i.type = i.type === 'password' ? 'text' : 'password'"><i class="bi bi-eye"></i></button></div></div>`;
}
async function showAuth(mode, msg) {
  document.body.style.overflow = 'hidden';
  closeAllOverlays();
  const scr = $('#authScreen'), form = $('#authForm');
  scr.hidden = false;
  authMsg(msg || '', !!msg && mode !== 'locked');
  if (mode === 'config') {
    $('#authSub').textContent = 'Konfigurasi belum lengkap';
    form.innerHTML = `<div class="auth-msg info">Isi <b>GAS_URL</b> di berkas <code>js/config.js</code> dengan URL Web App Apps Script (berakhiran <code>/exec</code>), lalu unggah ulang ke GitHub.</div>`;
    return;
  }
  if (mode === 'check') {
    $('#authSub').textContent = 'Menghubungkan ke server…';
    form.innerHTML = '<div class="sk" style="height:44px"></div><div class="sk" style="height:44px"></div>';
    try {
      const r = await gasCall('status', {}, 20000);
      if (!r.success) throw new Error(r.message);
      if (!r.data.siap) return showAuth('config-db');
      if (r.data.terkunciMenit) return showAuth('login', `Terlalu banyak percobaan. Coba lagi ${r.data.terkunciMenit} menit lagi.`);
      return showAuth(r.data.punyaPassword ? 'login' : 'activate', msg);
    } catch (e) {
      $('#authSub').textContent = 'Server tidak dapat dihubungi';
      form.innerHTML = `<div class="auth-msg">${esc(e.message)}</div><button type="button" class="btn btn-primary" onclick="showAuth('check')"><i class="bi bi-arrow-clockwise"></i> Coba lagi</button>`;
      return;
    }
  }
  if (mode === 'config-db') {
    $('#authSub').textContent = 'Database belum disiapkan';
    form.innerHTML = `<div class="auth-msg info">Jalankan fungsi <b>setupAppEnvironment</b> di editor Apps Script, lalu muat ulang halaman ini.</div><button type="button" class="btn btn-primary" onclick="showAuth('check')">Muat ulang</button>`;
    return;
  }
  const activate = mode === 'activate';
  $('#authSub').textContent = activate ? 'Aktivasi pertama: buat password Anda' : 'Masuk untuk melanjutkan';
  form.innerHTML = `
    ${activate ? `<div class="field"><label class="lbl" for="authCode">Kode aktivasi <small>dari log setupKeamanan</small></label><input class="input" id="authCode" autocomplete="off" autocapitalize="characters" spellcheck="false" required style="letter-spacing:.15em;font-weight:700"></div>` : ''}
    ${pwField('authPw', activate ? 'Password baru' : 'Password', activate ? 'new-password' : 'current-password')}
    ${activate ? pwField('authPw2', 'Ulangi password', 'new-password') + '<p class="hint" style="margin:-4px 0 0">Minimal 8 karakter, berisi huruf dan angka.</p>' : ''}
    <label class="check"><input type="checkbox" id="authIngat" checked> Ingat perangkat ini (30 hari)</label>
    <button class="btn btn-primary" type="submit" id="authBtn"><i class="bi bi-${activate ? 'shield-check' : 'box-arrow-in-right'}"></i> ${activate ? 'Aktifkan & Masuk' : 'Masuk'}</button>`;
  setTimeout(() => { const f = $(activate ? '#authCode' : '#authPw'); if (f) f.focus(); }, 50);
  form.onsubmit = async e => {
    e.preventDefault();
    const pw = $('#authPw').value, btn = $('#authBtn');
    if (activate) {
      if (!$('#authCode').value.trim()) return authMsg('Isi kode aktivasi.');
      if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return authMsg('Password minimal 8 karakter, berisi huruf dan angka.');
      if (pw !== $('#authPw2').value) return authMsg('Ulangi password tidak sama.');
    } else if (!pw) return authMsg('Isi password.');
    btn.disabled = true; btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Memeriksa…';
    try {
      const data = activate ? { code: $('#authCode').value.trim(), password: pw, ingat: $('#authIngat').checked } : { password: pw, ingat: $('#authIngat').checked };
      const r = await gasCall(activate ? 'activate' : 'login', data, 30000);
      if (!r.success) {
        if (r.code === 'NO_PASSWORD') return showAuth('activate');
        authMsg(r.message); btn.disabled = false; btn.innerHTML = activate ? 'Aktifkan & Masuk' : 'Masuk';
        return;
      }
      Sesi.set(r.data);
      onLoggedIn(r.message);
    } catch (err) {
      authMsg(err.message); btn.disabled = false; btn.innerHTML = activate ? 'Aktifkan & Masuk' : 'Masuk';
    }
  };
}
function onLoggedIn(msg) {
  $('#authScreen').hidden = true;
  $('#authForm').innerHTML = '';
  document.body.style.overflow = '';
  if (msg) toast(msg, 'success');
  S.retry = 0;
  loadFromServer(S.ready);
  flushQueue();
}
window.onAuthRequired = (msg) => { if ($('#authScreen').hidden) showAuth('check', msg || 'Sesi berakhir. Silakan masuk lagi.'); };

function clearLocalData() {
  try { [LS.snap, LS.queue].forEach(k => localStorage.removeItem(k)); } catch (e) { /* abaikan */ }
  S.data = emptyData(); S.queue = []; S.ready = false; S.storageInfo = null;
  $$('.page').forEach(p => { if (p.id !== 'page-dashboard') p.innerHTML = ''; });
}
async function logoutDevice() {
  if (S.queue.length) {
    const ok = await confirmDialog({ title: 'Ada perubahan belum tersimpan', msg: `${S.queue.length} perubahan belum terkirim ke server dan akan hilang jika keluar sekarang.`, ok: 'Tetap keluar', danger: true });
    if (!ok) return;
  }
  Sesi.clear();
  clearLocalData();
  showAuth('login', 'Anda sudah keluar. Data di perangkat ini dihapus.');
}
async function logoutAllDevices() {
  const ok = await confirmDialog({ title: 'Keluar dari semua perangkat?', msg: 'Semua perangkat (termasuk yang ini) harus memasukkan password lagi.', ok: 'Keluar dari semua', danger: true });
  if (!ok) return;
  try {
    const r = await gasCall('logoutAll', {});
    if (!r.success) throw new Error(r.message);
    Sesi.clear(); clearLocalData();
    showAuth('login', r.message);
  } catch (e) { if (!e.auth) toast(e.message, 'error'); }
}
async function submitChangePassword(e) {
  e.preventDefault();
  const lama = $('#pwLama').value, baru = $('#pwBaru').value, ulang = $('#pwUlang').value;
  if (!lama || !baru) return toast('Isi password lama dan baru.', 'error');
  if (baru.length < 8 || !/[A-Za-z]/.test(baru) || !/\d/.test(baru)) return toast('Password baru minimal 8 karakter, berisi huruf dan angka.', 'error');
  if (baru !== ulang) return toast('Ulangi password tidak sama.', 'error');
  try {
    const r = await gasCall('changePassword', { lama, baru, ingat: true });
    if (!r.success) return toast(r.message, 'error');
    Sesi.set(r.data);
    ['#pwLama', '#pwBaru', '#pwUlang'].forEach(id => { $(id).value = ''; });
    toast(r.message, 'success');
    renderPengaturan();
  } catch (err) { if (!err.auth) toast(err.message, 'error'); }
}

/* ───────────── BOOT ───────────── */
function bindGlobal() {
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => { closeAllOverlays(); navigateTo(b.dataset.nav); }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAllOverlays(); });
  window.addEventListener('online', flushQueue);
  window.addEventListener('resize', debounce(() => { if (S.page === 'transaksi') renderTrxResults(); }, 300));
  // Muat ulang data saat kembali ke tab setelah lama (mis. ganti hari)
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 10 * 60 * 1000 && !S.queue.length) loadFromServer(true);
  });
}

function boot() {
  if (lsGet(LS.sb)) document.body.classList.add('sb-collapsed');
  bindGlobal();
  navigateTo('dashboard');
  S.queue = lsGet(LS.queue) || [];
  if (!gasUrl()) { showAuth('config'); return; }
  if (!Sesi.get()) { showAuth('check'); return; }   // belum masuk: data tidak ditampilkan
  const snap = lsGet(LS.snap);
  if (snap) { // 1) tampilkan data terakhir dari perangkat secara instan
    const d = emptyData();
    SHEETS.forEach(s => { d[s] = Array.isArray(snap[s]) ? snap[s] : []; });
    S.data = d;
    S.ready = true;
    renderAll();
  }
  loadFromServer(!!snap); // 2) segarkan dari server di latar belakang
  flushQueue();
}

document.addEventListener('DOMContentLoaded', boot);
