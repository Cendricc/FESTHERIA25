# Sistem Pemesanan Tiket Event (QR Code + Verifikasi Pembayaran Manual)

Alur: **Dashboard → Isi Data Pemesan → Transfer Manual/QRIS + Upload Bukti → Bukti Terkirim → Cek Status & Unduh Tiket (Email + Booking ID)**, plus dashboard panitia untuk rekap data, verifikasi bukti pembayaran, dan check-in.

## Struktur Folder
```
event-ticket-system/
├── server.js              # entry point Express (helmet, rate limiting, dll)
├── .env.example           # contoh konfigurasi (salin jadi .env)
├── .gitignore              # supaya .env, database, & bukti pembayaran tidak ter-upload ke git
├── db/
│   ├── schema.sql          # struktur tabel (bookings, tickets, settings)
│   └── database.js         # koneksi SQLite + migrasi otomatis
├── services/
│   ├── qrService.js        # generate kode tiket (per lembar) + QR code
│   ├── bookingExpiry.js    # logic batas waktu 15 menit
│   ├── settingsService.js  # baca/ubah pengaturan batch & buka-tutup pendaftaran
│   └── emailService.js     # kirim email pengingat pembayaran (SMTP / mode simulasi)
├── routes/
│   ├── booking.js           # POST/GET data pemesanan
│   ├── payment.js           # upload bukti, lookup status, ambil tiket (email-gated)
│   └── admin.js              # rekap data, lihat bukti, ACC, reminder, check-in, kontrol batch
├── scripts/
│   └── reset-db.js          # utilitas mengosongkan database (npm run reset-db)
├── uploads/proofs/          # penyimpanan gambar bukti pembayaran (privat, hanya admin yang bisa lihat)
└── public/
    ├── index.html            # dashboard + tombol "Pesan Sekarang"
    ├── booking.html           # form data pemesan
    ├── payment.html           # info rekening/QRIS + upload bukti
    ├── cek-tiket.html         # cek status & unduh tiket (input Email + Booking ID)
    ├── admin.html             # dashboard panitia
    ├── images/qris.jpg        # GANTI dengan gambar QRIS asli kamu di sini
    └── js/, css/
```

## Cara Menjalankan di VSCode

### 1. Prasyarat
Install **Node.js versi 22.5 ke atas** dari https://nodejs.org (pilih versi LTS terbaru).
```bash
node -v
npm -v
```

### 2-4. Buka project, install, siapkan .env
```bash
npm install
cp .env.example .env
```
Isi `.env`: `EVENT_NAME`, `EVENT_TICKET_PRICE`, `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `BANK_NAME`/`BANK_ACCOUNT_NUMBER`/`BANK_ACCOUNT_HOLDER`.

### 5. Ganti gambar QRIS
Ganti file `public/images/qris.jpg` dengan QRIS asli kamu.

### 6. Jalankan
```bash
npm run dev
```
Buka **http://localhost:3000** (pemesanan) dan **http://localhost:3000/admin.html** (panitia).

> **Penting:** halaman `admin.html` **sengaja tidak ditautkan dari mana pun** di halaman publik (dashboard pemesanan) — supaya pengunjung biasa/pembeli iseng tidak bisa menemukan link-nya begitu saja. Panitia perlu tahu dan mengetik sendiri alamatnya (`namadomainmu.com/admin.html`) — simpan alamat ini sebagai bookmark. Ini bukan pengaman utama (tetap ada login username/password di baliknya), tapi mengurangi "godaan" orang iseng coba-coba klik.

---

## ❓ Cara Deploy ke Publik (Menjawab Pertanyaanmu)

Project ini pakai **file lokal** untuk database (`db/tickets.db`) dan bukti pembayaran (`uploads/proofs/`). Ini penting karena membatasi pilihan hosting:

**JANGAN pakai hosting serverless / free-tier yang filesystem-nya sementara** (Vercel gratis, Heroku free dyno lama, dll) — data pesanan dan bukti pembayaran bisa **hilang** setiap kali server restart/deploy ulang.

**Pilih salah satu ini:**
- **VPS** (DigitalOcean, Niagahoster VPS, Contabo, dll) — paling fleksibel, kamu install Node.js sendiri, jalankan pakai `pm2` supaya otomatis restart kalau crash
- **Railway / Render** dengan **persistent volume/disk** diaktifkan (bukan paket default)

### Deploy ke Railway (Ringkasan Langkah)

1. Push project ke GitHub (`.env` **tidak akan ikut ter-push** karena sudah ada di `.gitignore` — environment variable diisi manual lewat dashboard Railway, bukan lewat file)
2. Railway → **New Project** → **Deploy from GitHub repo** → pilih repo kamu
3. Tab **Variables** → isi manual semua yang ada di `.env.example` kamu (`EVENT_NAME`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` pakai yang baru & kuat, `BANK_NAME`, dst), **tambahkan juga**:
   ```
   STORAGE_DIR=/app/storage
   ```
4. Tab **Settings → Volumes** → **New Volume** → Mount Path: `/app/storage` (**cukup SATU volume ini saja** — database dan bukti pembayaran otomatis tersimpan di dalamnya, tidak perlu volume kedua)
5. Tab **Settings → Networking** → **Generate Domain** untuk dapat alamat publik dengan HTTPS otomatis

> **Penting soal `STORAGE_DIR`:** variabel ini yang memberi tahu aplikasi supaya menyimpan database & bukti pembayaran di folder volume (`/app/storage`), **terpisah dari folder kode aplikasi**. Kalau `STORAGE_DIR` tidak di-set (misal waktu kamu coba di laptop), aplikasi otomatis pakai folder lokal seperti biasa — jadi aman, tidak mengganggu development di lokal.

**Checklist sebelum go-live:**
1. Domain sendiri + **HTTPS aktif** (otomatis dari Railway/Render, atau Let's Encrypt gratis kalau VPS)
2. **Jangan** upload file `.env` ke GitHub/internet — isi environment variable lewat dashboard hosting
3. Backup rutin file di dalam `STORAGE_DIR` (database + bukti pembayaran) — kalau server bermasalah, ini satu-satunya sumber data kamu
4. Jalankan `npm run reset-db` sebelum hari-H supaya data testing tidak tercampur data asli
5. Setelah deploy, buka link publiknya dari **beberapa device berbeda** (laptop, HP Android, iPhone) buat mastiin semua bisa akses

---

## 🔒 Keamanan yang Sudah Diterapkan

**Penting: tidak ada sistem yang bisa dijamin 100% aman.** Yang saya terapkan adalah praktik standar untuk menutup celah-celah paling umum:

| Risiko | Yang diterapkan |
|---|---|
| SQL Injection | Semua query database pakai parameter (`?`), bukan string gabungan — aman dari awal |
| **XSS (Cross-Site Scripting)** | Semua data dari pengguna (nama, email, dll) di-*escape* sebelum ditampilkan di halaman manapun, termasuk dashboard admin |
| **Path traversal via upload file** | Nama file bukti pembayaran ditentukan sendiri oleh server (bukan dari nama file asli yang diupload user) |
| File upload disamarkan | Server mengecek isi file (signature/magic bytes), bukan cuma percaya label tipe file dari browser |
| Brute-force / spam | Rate limiting di endpoint pemesanan, pencarian tiket, dan semua endpoint admin |
| Timing attack pada password admin | Perbandingan password admin pakai `crypto.timingSafeEqual`, bukan `===` biasa |
| **Kebocoran data antar pemesan** | Tiket & status pesanan hanya bisa diakses dengan kombinasi **Email + Booking ID yang cocok** — Order ID saja tidak cukup untuk melihat data orang lain |
| Bukti pembayaran diintip orang lain | File bukti pembayaran disimpan di luar folder publik, hanya bisa dibuka lewat dashboard admin yang sudah login |
| HTTP headers berbahaya | Pakai `helmet` (Content-Security-Policy, X-Frame-Options, dll) |
| CORS terbuka | Dihapus total — frontend & API satu server/origin yang sama, jadi situs lain tidak bisa memanggil API ini dari browser |

**Yang TETAP jadi tanggung jawabmu:**
- HTTPS di production (lihat bagian Deploy di atas) — tanpa ini, data bisa disadap di jaringan
- Password admin yang kuat di `.env` (jangan pakai contoh bawaan)
- Update dependency secara berkala (`npm audit`, `npm update`) untuk menutup celah yang ditemukan di kemudian hari
- Backup rutin — keamanan bukan cuma soal dibobol, tapi juga soal data tidak hilang

---

## Alur Cek Status & Unduh Tiket (Fitur Baru)

Sebelumnya, begitu pembeli upload bukti pembayaran, mereka langsung diarahkan ke halaman yang otomatis menunggu status. Sekarang **dipisah**: setelah upload bukti, pembeli hanya diberi Order ID dan diarahkan ke halaman terpisah **`cek-tiket.html`**.

Kenapa dipisah begini:
- Pembeli bisa keluar dari browser/tutup tab kapan saja tanpa takut kehilangan akses — mereka tinggal buka lagi `cek-tiket.html` dari perangkat manapun, kapan pun
- Untuk masuk ke sesi ini, wajib input **Email + Booking ID** yang cocok — ini sekaligus jadi lapisan keamanan supaya orang lain tidak bisa asal menebak Order ID untuk melihat tiket/data pemesan lain
- Kalau status masih pending, halaman otomatis cek ulang tiap beberapa detik selama dibuka — begitu admin meng-ACC, tiket otomatis muncul tanpa perlu refresh manual

## Alur Pembayaran Manual & ACC Admin

1. Pembeli isi data → sistem tampilkan nominal, nomor rekening, dan QRIS
2. Pembeli transfer manual di luar sistem, lalu **wajib upload bukti pembayaran** sebelum bisa lanjut
3. Panitia login admin → tab **Rekap & Verifikasi Pembayaran** → **Lihat Bukti** → **ACC Pembayaran** atau **Tolak**
4. Begitu di-ACC, tiket QR (satu kode unik per lembar tiket) langsung diterbitkan
5. Kalau ditolak (bukti tidak valid / tidak ada progres), pesanan ditandai **"failed"** — datanya **tetap tersimpan** (tidak dihapus) tapi dipindah ke tab terpisah, dan pembeli otomatis bisa langsung pesan ulang pakai email yang sama

**Tidak ada lagi batas waktu pembayaran otomatis.** Pesanan tetap berstatus "pending" selama apa pun sampai admin secara manual meng-ACC atau menolaknya — tidak ada penghapusan/pembatalan otomatis berbasis waktu.

## Tiket QR Per Lembar

Pesanan dengan >1 tiket menghasilkan kode QR **berbeda-beda untuk tiap lembar**, dan tiap kode di-blacklist independen begitu discan panitia.

## Fitur Cegah Email Duplikat

Email yang masih punya pesanan **aktif** (status lunas atau pending) tidak bisa dipakai daftar lagi — mencegah satu orang membuat banyak pesanan ganda sekaligus. Begitu pesanan ditandai **gagal** oleh admin, email itu otomatis bebas dipakai lagi untuk pesan ulang.

## Data Gagal/Kedaluwarsa (Terpisah dari Rekap Utama)

Dashboard admin punya tab khusus **"Data Gagal/Kedaluwarsa"** untuk pesanan yang ditolak admin:
- **Tidak muncul** di tab Rekap utama, tidak dihitung di statistik utama (Total Pemesanan, dst), dan **tidak ikut ter-export** saat klik "Export CSV" di tab Rekap
- Datanya tetap tersimpan (bukan dihapus) — berguna untuk keperluan audit/pemeliharaan server nantinya
- Ada tombol **Export CSV** sendiri, terpisah dari export utama, khusus untuk data gagal ini kalau sewaktu-waktu kamu perlu

## Fitur Kontrol Batch Pendaftaran & Harga per Batch

Dashboard admin → tab **Kontrol Pendaftaran**, semua bisa diatur langsung dari situ tanpa perlu sentuh `.env` atau restart server:

- **Buka/tutup pendaftaran** kapan saja
- **Pilih batch aktif**: Batch 1, Batch 2, Batch 3, atau **OTS (On The Spot)** — OTS diperlakukan sebagai "batch ke-4", cocok dipakai untuk pendaftaran di tempat saat hari-H acara
- **Atur harga tiap batch secara terpisah** — boleh sama atau beda-beda (misalnya Batch 1 lebih murah, OTS paling mahal). Harga yang dipakai untuk sebuah pesanan adalah harga batch yang sedang aktif **pada saat pesanan itu dibuat** — jadi kalau kamu ganti harga setelahnya, pesanan yang sudah ada **tidak ikut berubah**, cuma pesanan baru yang kena harga terbaru.

`EVENT_TICKET_PRICE` di `.env` sekarang cuma dipakai sekali sebagai nilai awal saat instalasi pertama kali (mengisi harga default ke-4 batch). Setelahnya, semua pengaturan harga sepenuhnya lewat dashboard.

## Cara Menghapus Data

Ada dua cara, tergantung kebutuhan:

**1. Lewat dashboard admin (tanpa perlu akses server/terminal — cocok kalau sudah di-deploy)**
- **Hapus satuan**: klik tombol **Hapus** di baris pesanan manapun (tab Rekap maupun tab Data Gagal/Kedaluwarsa) — permanen, langsung hilang beserta tiket & file buktinya
- **Hapus semua sekaligus**: tab **Kontrol Pendaftaran** → scroll ke bagian **"⚠️ Zona Berbahaya"** → ketik persis `HAPUS SEMUA DATA` di kolom konfirmasi → klik tombol hapus. Pengaturan batch/harga/buka-tutup **tidak** ikut terhapus, cuma data pemesanan & tiketnya.

**2. Lewat terminal (kalau masih di lokal / punya akses server)**
```bash
npm run reset-db
```
Ketik `hapus` untuk konfirmasi.

## Kalau Dashboard Admin Tiba-Tiba Kosong / Tidak Muncul Data

Sekarang sistem bisa membedakan dua kondisi berbeda:
- **"Belum ada data"** — memang belum ada pesanan yang cocok dengan filter yang dipilih
- **"Gagal memuat data"** — muncul pesan error merah dengan tombol **Coba Lagi**, biasanya karena koneksi internet putus sesaat atau server sempat tidak merespons. Data yang sebelumnya sudah termuat di layar **tidak akan hilang/ketimpa kosong** hanya karena satu kali refresh otomatis gagal — jadi kalau tiba-tiba terlihat kosong total, kemungkinan besar itu memang error jaringan sesaat, bukan data yang benar-benar hilang dari database. Klik **Coba Lagi**, atau refresh halaman.

## Pendaftar Real-Time per Batch

Tab Rekap sekarang menampilkan kartu **"Pendaftar per Batch"** yang menunjukkan jumlah pendaftar di tiap batch (1/2/3/OTS) secara real-time, termasuk rincian berapa yang sudah lunas dan berapa yang masih pending — otomatis ter-update tiap 15 detik bersamaan dengan rekap utama.

## Prodi & Tingkat (Dropdown)

Form pemesanan memakai dropdown untuk Prodi dan Tingkat (bukan lagi satu kolom teks bebas):
- **Tingkat**: 1 - 4
- **Prodi**: daftar tetap 21 program studi, didefinisikan di `services/prodiList.js`

Daftar ini jadi **satu-satunya sumber kebenaran** — dipakai baik untuk mengisi dropdown di form (lewat endpoint `GET /api/prodi-list`) maupun untuk validasi di server saat pesanan masuk. Jadi kalau kamu perlu menambah/mengubah/menghapus prodi, cukup edit array `PRODI_LIST` di file itu satu kali, otomatis konsisten di form maupun validasi.

## Fitur Sort di Rekap Admin

Tabel rekap admin bisa diurutkan berdasarkan Nama (A-Z/Z-A), Prodi (A-Z/Z-A), Tingkat, atau Waktu Pemesanan (terbaru/terlama), lewat dropdown "Urutkan Berdasarkan" di atas tabel.

**Catatan teknis (biar kamu tenang):** fitur ini murni mengatur *urutan tampilan baris* di layar — hanya menata ulang array data yang sudah diambil dari server sebelum ditampilkan, sama sekali tidak mengubah/menulis apapun ke database. Ganti-ganti urutan sort sesuka hati tidak akan pernah merusak atau mengubah data pemesanan yang sebenarnya.

## Kolom "Waktu ACC"

Tabel rekap juga menampilkan kapan tiap pesanan di-ACC oleh admin (kolom **Waktu ACC**, kosong/"-" kalau belum di-ACC). Ini juga otomatis ikut ke dalam file saat kamu klik Export CSV.

## Tema Visual "Jungle"

Seluruh halaman (pemesanan, pembayaran, cek tiket, dashboard admin) memakai palet warna dari poster Festheria'25 (`#534332`, `#394032`, `#454F2D`, `#797F3E`, `#9F7E4A`), plus sentuhan motif daun (tekstur latar halus di seluruh halaman, watermark daun di pojok kartu tiket, ikon daun di pembatas antar-bagian) supaya nuansa hutan/jungle terasa tanpa mengorbankan keterbacaan teks.

## Format Cetak Tiket (PDF/A4)

Tombol **"Cetak / Simpan sebagai PDF"** di halaman Cek Tiket sekarang menghasilkan format yang jauh lebih rapi:
- **1 halaman A4 = 1 tiket** — kalau pesanan punya 3 tiket, hasil cetak/PDF-nya otomatis jadi 3 halaman terpisah, masing-masing dengan kode QR yang berbeda
- **Nama pemesan** di pojok kiri atas tiap halaman
- **Kode QR + kode unik tiket** di tengah halaman, ukurannya pas tidak melebar
- Info tambahan (Order ID, Prodi, Tingkat, Batch) di bagian bawah
- Latar dibuat **putih** (bukan gelap seperti tampilan di layar) supaya hemat tinta kalau dicetak fisik, tapi nuansa jungle tetap kerasa lewat warna aksen hijau/emas dan ikon daun — sudah saya uji render sungguhan (screenshot + generate PDF asli) dan hasilnya pas di ukuran A4 standar

Cara pakainya sama seperti sebelumnya: klik tombol itu, lalu di dialog print browser pilih **"Save as PDF"** (atau print fisik langsung kalau printer sudah terhubung).

## Scan QR Tiket - Kalau Kamera Nyala Tapi Tidak Men-scan

Sekarang sistem otomatis mendeteksi kamera yang **benar-benar tersedia** di device kamu (bukan asal minta "kamera belakang" yang di laptop memang tidak ada). Kalau device kamu punya lebih dari 1 kamera, akan muncul dropdown pemilih kamera di atas area scan.

Kalau masih belum berhasil men-scan:
1. Pastikan diakses lewat `https://` (di server produksi) atau `localhost` (di laptop) — browser blokir kamera di alamat HTTP biasa
2. Coba pilih kamera lain dari dropdown kalau ada lebih dari satu pilihan
3. Pastikan pencahayaan cukup dan QR code tidak terlalu jauh/blur dari kamera
4. Kalau kamera tetap tidak mendeteksi apa pun, gunakan kolom **input manual** di bawah area scan sebagai alternatif — panitia tinggal ketik kode tiketnya


