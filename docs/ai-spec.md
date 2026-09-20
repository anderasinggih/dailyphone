# SPESIFIKASI AI — Daily Phone ("AI Otak / Neuron Network")

> Draft untuk dikoreksi. Semua poin bersumber dari kode.

## 1. Arsitektur
- **Stack**: Laravel (PHP 8.x) backend, Inertia + React/TypeScript frontend, komunikasi via Gemini API (`GeminiAssistantService.php`).
- **Alur chat**: `AiAssistantController@chat` → simpan pesan → ambil 10 pesan terakhir per sesi → bangun system prompt (konteks toko, aturan sesi, ringkasan, blok memori, blok ingest) → stream NDJSON ke frontend → simpan `AiAssistantRun` (telemetri).
- **Roles**: Superadmin/Admin = akses penuh semua cabang; Karyawan = hanya store yang ditugaskan.

## 2. Node = Otak (Memori)
- Tabel `ai_training_notes` (`AiTrainingNote.php`) — **setiap baris = 1 neuron/node**. Field: `content`, `title`, `related_keywords` (JSON), `kind`, `is_active`, `used_count`, `last_used_at`, `author_name/role`, `source_url/label`, `occurred_at/place` + `involved_with` (bingkai episode ketika/where/who).
- **Taxonomi 10 kind** (`AiMemoryGraphService::KINDS`): `rule`, `validation`, `condition`, `emotions`, `note`, `memory`, `preference`, `identity`, `goal`, `warning`. Khusus `rule` wajib dari Superadmin; `identity` = relasi keluarga/identitas ("Yaya adik Singgih").
- **Auto-connect saat created** (`AiTrainingNote::booted`): node baru otomatis di-link ke node paling mirip (`linkNewNote`) dan antre embedding (`EmbedTrainingNoteJob` di koneksi `deferred`). Saat delete, semua sinaps diputus (`pruneLinksFor`).

## 3. Hubungan = Sinaps
- Tabel `ai_training_note_links` (`AiTrainingNoteLink.php`): `note_id`, `linked_note_id`, `label`, `relation` (typed: `same_topic`, `rule_applies`, `validation_required`, `condition_trigger`, `risk_warning`, `serves_goal`, `persistent_hint`, `closely_related`, `related`, `fresh_memory`), `weight` (float), `reason`.
- Scoring: tokenisasi + stopwords, IDF, cosine similarity; boost untuk judul & `related_keywords` (hint). Max 5 link per node; fallback `fresh_memory` agar graf tetap tersambung.

## 4. AI Belajar (Retrieval)
`selectTrainingNotes()` (`GeminiAssistantService.php:1915`) — 3 stage:
1. **rule** — semua node kind `rule` aktif, selalu disuntik.
2. **semantic** — `AiEmbeddingService::search()` (model `text-embedding-004`, cosine, multi API-key failover, crash-safe fallback token).
3. **contextual** — seeds situasional + momentum (episode waktu/tempat/orang, node yang baru dipakai, kontinuitas topik).

Lalu **path expansion 2-hop** (`generateTrainingNotesContext`): tarik konten node tetangga lewat sinaps terkuat (ambang aktivasi → `MIN_ACTIVATION_WEIGHT`), plus mood priming. Output = blok `GLOBAL AI TRAINING MEMORY` di prompt.

## 5. AI Menyimpan (Penyimpanan Senyap)
- Satu-satunya jalan normal: blok `ai_memo` di akhir balasan → `persistTrainingMemos()` → `persistMemo()` (dedupe hash + Jaccard ≥ 0.72 via `isDuplicateContent`).
- Dilarang mengumumkan "sudah tersimpan / Node baru" dst. Teks deteksi klaim palsu: `reconcileMemoClaims()` mengoreksi — kalau model mengklaim tersimpan tanpa blok `ai_memo`, sistem merekonstruksi memo dari **fakta sungguhan** (teks user), atau menulis ulang jawaban (`correctFalseClaim`).
- Deklarasi pengguna di kalimat ("X adalah adik Y") → `declarativeFallback()` / `silentlyPersistUserFact()` otomatis mencatat walau model tak keluarkan blok.

## 6. AI Memetakan Otak
- **Live map**: `resolveNeuronNetwork()` mengembalikan node + edges yang benar masuk konteks; frontend render force-graph (`NeuralMindMap.tsx`, `NeuronFiringMap.tsx`) + difusi via Reverb ke tab lain.
- **Map penuh**: `AiMemoryGraphService::graphData()` untuk halaman Settings → AI Training Notes (`AiTrainingNotes.tsx`).
- **Rewire sendiri**: `AiBrainMaintenanceService::tidy()` (AI jadi *neural architect*: koreksi kind, usul title/keyword, tambah/hapus sinaps).

## 7. Perawatan Otak
- `consolidate()` (job mingguan, tanpa AI round-trip): dedupe node kembar (cosine embedding ≥ 0.92), promote pola validasi berulang, retire node mati (>120 hari, tak terpakai), plasticity (potensiasi sinaps yang dipakai bareng).
- `AiEvaluation` + `ai:evaluate` = eval golden dataset tiap minggu.

## 8. Ingestion Eksternal
`AiFileIngestService.php`: URL, PDF/XLSX/DOCX/ZIP/CSV/RTF, arsip repo (max 120 node per repo), lampiran chat → jadi node + blok `SISTEM INGEST (FAKTUAL)` di prompt.

## 9. Aksi & Tools
`AiActionService` → `action_proposal` (validasi wajib): `sell_stock`, `update_stock`, `add_stock`, `add_bulk_stock`, `delete_stock`, `delete_all_stocks`, `empty_trash`, `create_money_note`, `add_parameter`, `run_python_script`, `learn_repo`; semua bisa di-`undo` (ActivityLog). Code only untuk Superadmin.

## 10. Telemetri & Akurasi
`AiAssistantRun`: node di-retrieve per stage, `used_ids` (node yang dikutip), `tools_called`, `citations`, `retrieval_confidence` (abstention saat skor rendah), token usage. Cara kutip: baris `Memori node yang dikonsultasi: #12` → `extractCitedNodeIds()` → `registerUsage()` (naikkan `used_count`). Angka jumlah node hanya dari blok `NODE STATISTICS (FAKTUAL)`.

## 11. Perilaku yang Baru Ditambahkan (Bug "Node #868")
Aturan **SOURCE / PROVENANCE** di `GeminiAssistantService.php`:
- Ditanya "tau darimana / udah tersimpan?" → jawab id node asli dari blok `GLOBAL AI TRAINING MEMORY`.
- **Dilarang** bicara status tersimpan/gagal tersimpan (domain sistem).
- Tak boleh menuruti pertanyaan negatif user ("kok belum tersimpan?").
- Bila bukan dari node → akui dari percakapan/pengetahuan umum, jangan mengarang id node.

---

**File kunci**: `app/Services/GeminiAssistantService.php`, `AiMemoryGraphService.php`, `AiEmbeddingService.php`, `AiBrainMaintenanceService.php`, `AiFileIngestService.php`, `AiActionService.php`; `app/Http/Controllers/AiAssistantController.php`; model `AiTrainingNote` + `AiTrainingNoteLink`; frontend `resources/js/Pages/Settings/AiTrainingNotes.tsx` + `NeuralMindMap.tsx`.