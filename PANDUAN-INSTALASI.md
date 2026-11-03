# Keuangan Digital v2 — Panduan Migrasi ke GitHub Pages + GAS API

Arsitektur baru:

```
GitHub Pages (frontend)                Google Apps Script (backend)
https://USERNAME.github.io/REPO/  ──►  Web App /exec  ──►  Google Sheets + Drive
index.html • css/ • js/ • img/         Kode.gs (REST API JSON, login password)
```

- Data **tetap** di spreadsheet *DB Keuangan Digital* yang sudah ada. Tidak ada data yang dipindah.
- Backend sekarang di-deploy dengan akses **"Siapa saja"** agar bisa dipanggil dari GitHub Pages. Karena itu semua data dilindungi **login password**.
- Password tidak pernah disimpan, hanya hash-nya di *Script Properties*. Sesi login berlaku 12 jam, atau 30 hari bila "Ingat perangkat ini" dicentang.
- Salah password 5 kali berturut-turut membuat login terkunci 15 menit.

---

## BAGIAN A — Backend (Apps Script)

Pakai **proyek Apps Script yang sama** dengan yang sekarang. Script Properties (ID spreadsheet & folder) tetap terbawa, jadi data langsung tersambung.

1. Buka proyek Apps Script *Keuangan Digital*.
2. Buka berkas **Kode**, hapus semua isinya, lalu tempel isi **Kode.gs** versi 2.0. Simpan (Ctrl+S).
3. Hapus berkas **Index**, **Stylesheet**, **JavaScript**, dan **CardArt** (klik ⋮ di samping nama berkas → Hapus). Tampilan sekarang ada di GitHub.
4. Pilih fungsi **setupAppEnvironment** → ▶ **Jalankan**. Fungsi ini aman diulang: data tidak ditimpa.
5. Buka **Log eksekusi** dan catat **KODE AKTIVASI** (10 huruf/angka). Kode ini dipakai **sekali** untuk membuat password di aplikasi.
6. Ubah akses deployment:
   - **Terapkan → Kelola deployment** → pilih deployment yang ada → ikon ✏️ **Edit**
   - **Versi:** Versi baru
   - **Jalankan sebagai:** Saya
   - **Yang memiliki akses:** **Siapa saja**
   - Klik **Terapkan**, lalu salin **URL aplikasi web** (berakhiran `/exec`).
   - Kalau pilihan akses tidak bisa diubah, buat **Deployment baru** → Aplikasi web dengan pengaturan di atas.
7. Tes: buka URL `/exec` di browser. Yang muncul seharusnya teks JSON seperti `{"success":true,...,"message":"API aktif"}`. Ini normal; URL `/exec` sekarang hanya API, bukan tampilan aplikasi.

> ⚠️ Jangan bagikan spreadsheet database ke orang lain, dan jangan menambah editor di proyek Apps Script. Editor proyek bisa melihat Script Properties.

---

## BAGIAN B — Isi URL backend di frontend

1. Ekstrak **keuangan-digital.zip**. Hasilnya folder `keuangan-digital` yang langsung berisi `index.html`, `css`, `js`, dan `img`.
2. Buka `js\config.js` dengan Notepad, lalu ganti `https://script.google.com/macros/s/GANTI_DENGAN_ID_DEPLOYMENT/exec` dengan URL `/exec` dari langkah A6. Simpan.

URL `/exec` bukan rahasia dan memang akan terlihat publik di GitHub. Yang menjaga data adalah password Anda.

---

## BAGIAN C — Unggah ke GitHub Pages

**Folder kerja untuk semua perintah git = folder `keuangan-digital` hasil ekstrak.** Yang dipakai adalah folder yang di dalamnya langsung ada `index.html`, bukan folder induknya.

### C1. Pasang Git (sekali saja)
- Windows: unduh dari https://git-scm.com/download/win, lalu pasang dengan pengaturan bawaan.
- Cek di PowerShell: `git --version`

### C2. Identitas Git (sekali saja)
```
git config --global user.name "Nama Anda"
git config --global user.email "email-akun-github@contoh.com"
```

### C3. Buat repository di GitHub
github.com → **+** → **New repository** → beri nama, misalnya `keuangan-digital` → pilih **Public** → **jangan** centang README/.gitignore/license → **Create repository**.

### C4. Masuk ke folder & cek isinya
Buka folder `keuangan-digital` di File Explorer, klik address bar, ketik `powershell`, lalu Enter.
```
dir
```
Pastikan terlihat `index.html`, `css`, `js`, dan `img`. Kalau yang terlihat justru folder `keuangan-digital` lagi, masuk dulu dengan `cd keuangan-digital`.

### C5. Kirim ke GitHub (satu per satu)
```
git init
git add .
git commit -m "Keuangan Digital v2"
git branch -M main
git remote add origin https://github.com/USERNAME/keuangan-digital.git
git push -u origin main
```
- Saat `git push` meminta password, tempel **Personal Access Token**, bukan password akun GitHub. Buat token di https://github.com/settings/tokens → *Generate new token (classic)* → centang **repo**.
- Saat token ditempel, layar memang tidak menampilkan apa-apa. Itu normal; langsung tekan Enter.

### C6. Aktifkan GitHub Pages
Repo → **Settings** → **Pages** → Source: **Deploy from a branch** → Branch: **main** / **(root)** → **Save**. Centang **Enforce HTTPS**.
Tunggu 1–2 menit hingga muncul: *Your site is live at https://USERNAME.github.io/keuangan-digital/*

### C7. Update di kemudian hari
```
git add .
git commit -m "Perubahan"
git push
```
Jika tampilan belum berubah, tekan Ctrl+Shift+R.

---

## BAGIAN D — Pertama kali membuka aplikasi

1. Buka `https://USERNAME.github.io/keuangan-digital/`
2. Isi **Kode aktivasi** dari langkah A5, lalu buat **password**: minimal 8 karakter, berisi huruf dan angka.
3. Selesai. Data lama langsung tampil.
4. Di HP: buka alamat yang sama → menu browser → **Tambahkan ke layar utama**.

## Lupa password / keamanan
| Kebutuhan | Caranya |
|---|---|
| Ganti password | Aplikasi → Pengaturan → **Keamanan & Login** (perangkat lain otomatis keluar) |
| Keluar dari semua perangkat | Pengaturan → Keamanan & Login → **Keluar dari semua perangkat** |
| Lupa password | Apps Script → jalankan **resetPassword** → pakai kode aktivasi baru dari log |
| Curiga token bocor | Apps Script → jalankan **rotasiSecretSesi** (semua perangkat wajib masuk ulang) |

Semua rahasia (hash password, salt, secret sesi, kode aktivasi) hanya tersimpan di **Script Properties**. Lokasinya di Apps Script → ⚙️ Setelan Proyek. Rahasia ini tidak pernah ada di GitHub, Sheets, atau log.

## Masalah umum
| Gejala | Solusi |
|---|---|
| "Konfigurasi belum lengkap" | `GAS_URL` di `js/config.js` belum diisi → isi, lalu `git add .`, `git commit`, `git push` |
| "Respons server tidak valid" | Akses deployment belum **Siapa saja**, atau belum dibuat Versi baru |
| "Tidak dapat terhubung ke server" | Periksa koneksi internet, atau pastikan URL `/exec` benar |
| Halaman 404 di GitHub Pages | `index.html` tidak berada di root repo; pastikan perintah git dijalankan di folder yang berisi `index.html` |
| Tampilan tanpa warna/gaya | Folder `css/` dan `js/` tidak ikut terunggah; selalu unggah lewat `git push`, bukan "Upload files" |
