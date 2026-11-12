# Search engine: việc còn lại (bàn giao cho session sau)

Cập nhật: 2026-11-13. Chưa commit gì; chưa áp dụng migration nào lên Supabase thật.

## 1. Đã xong

**Phase 1: database** (trong working tree, chưa commit)
- `supabase/migrations/202611130001_search_index_queue.sql`: bảng `search_index_status`, trigger xếp hàng, backfill, thêm `engine` + `query_type` vào `search_logs`, cho phép `query_string` rỗng với tìm ảnh. **Đã qua test** PGlite.
- `supabase/migrations/202611130002_vector_search.sql`: extension `vector`, `document_embeddings`, `image_embeddings` (768 chiều), hàm `public.match_documents` / `public.match_images` (quét chính xác, chỉ `service_role` gọi được). **Chưa chạy thử ở đâu cả**: PGlite không có pgvector, máy không có Docker. Hàm nằm ở schema `public` vì supabase-js chỉ gọi được schema được expose (`config.toml` không có mục `[api]`, tức mặc định `public`).
- `tests/supabase.test.mjs` mở rộng; test bỏ qua file `vector_search` và in "Skipped".

**Phase 0: thử API** (script: `scripts/embedding-probe.mjs`, chạy được lại)
```bash
bun scripts/embedding-probe.mjs frontend/.env supabase/seed-data/articles-vnexpress.json /đường/dẫn/thư-mục-ra
```
Kết quả trên 90 bài seed, 12 query có nhãn, 12 ảnh:

| | Từ khóa hiện có | Vector (có prefix) |
|---|---|---|
| Tìm thấy bài liên quan | 5/12 | 12/12 |
| MRR | 0.417 | 1.000 |
| P@3 | 0.250 | 0.722 |

- Vector tìm đúng cả khi đồng nghĩa ("nhà vườn" → cà phê, "nguyệt cầu" → Mặt Trăng), tiếng Anh ("robot humanoid"), và không dấu ("du lich Hue"). Từ khóa hiện có hụt cả bốn dạng này.
- Ảnh → bài của chính nó: đúng ở hạng 1 cho 12/12 ảnh.
- Chữ → ảnh: top 1 đúng ở hầu hết query. **Cảnh báo về chất lượng đánh giá:** query và nhãn do Claude viết sau khi đã xem tiêu đề bài, tập chỉ 12 query, nên con số MRR 1.0 lạc quan. Phase 7 phải làm lại với tập query và nhãn do người khác viết.

## 2. Sự thật đã kiểm chứng (dùng khi code)

- **Gọi API (REST):** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent`, header `x-goog-api-key`, body `{"content":{"parts":[{"text":"..."}]},"outputDimensionality":768}`, kết quả ở `embedding.values`. Ảnh: `parts:[{"inlineData":{"mimeType":"image/png","data":"<base64>"}}]`. Vector trả về nên normalize lại (script làm vậy).
- **Prefix:**
  - Bài: `title: {title} | text: {summary + đoạn văn}`.
  - Query tìm bài: `task: search result | query: {q}`.
  - **Query tìm ảnh: không dùng prefix.** Với prefix, điểm của các ảnh dồn vào khoảng 0.53 đến 0.67 và query "cà phê" trả sai top 1; không prefix thì đúng và điểm phân tách rõ hơn. Mẫu nhỏ (8 query), nên kiểm tra lại ở Phase 7.
  - Không prefix vẫn cho cùng thứ hạng ở tìm bài, chỉ khác điểm.
- **Độ trễ:** embed 1 query ~0.4 s (median 415 ms), không có cold start. Embed 1 ảnh ~2.7 s. Nên không cần warm-up, không cần Modal.
- **Điểm tương đồng:** query rác ("công thức nấu bánh xèo") có top 1 chỉ 0.56, còn top 1 của query hợp lệ từ 0.69 trở lên (có prefix). Mới có một query rác nên **chưa đủ để chọn ngưỡng**; cần ~20 query rác trước khi cắt kết quả theo điểm.
- **webp:** tài liệu nói chỉ nhận PNG/JPEG, nhưng lần thử này API **vẫn nhận webp**. Vẫn nên chuyển sang PNG theo đúng tài liệu (không dựa vào hành vi không được ghi), nhưng không phải việc chặn. Trên máy Mac, `sips -s format png` chuyển ổn; trên server dùng `sharp`.
- **Dữ liệu seed:** 90 bài; bài 74 và 79 không có ảnh; bài 17 không có `paragraphs`; `documents` không còn cột `status` (xóa ở migration 005) nên mọi bài là "đã đăng"; seed JSON có `image_alt`/`image_caption` nhưng DB không lưu chúng.
- **Khóa API:** đang ở `frontend/.env` (`GEMINI_API_KEY`, đã bị gitignore, không có tiền tố `VITE_` nên không lọt vào bundle trình duyệt). Trên Vercel phải đặt thành biến môi trường của project.

## 3. Quyết định đã chốt

Bỏ BM25; giữ tìm từ khóa hiện có làm cột trái, vector làm cột phải, không hiện điểm; tìm bằng ảnh chỉ hiện cột vector và không cần chữ; chỉ index bài đang có (không có trạng thái nháp); sửa nội dung thì index lại; log dùng lại `search_logs`; ảnh người dùng upload không được lưu.

## 4. Việc còn lại

### A. Áp dụng và kiểm chứng migration (cần người dùng đồng ý, đụng DB thật)
- [ ] Chạy hai migration lên Supabase (dashboard SQL editor hoặc `supabase db push`). Nếu `create extension vector` bị từ chối thì bật pgvector trong Dashboard → Database → Extensions rồi chạy lại.
- [ ] Kiểm chứng migration vector vì chưa từng chạy: gọi `select * from public.match_documents(array_fill(0, array[768])::extensions.vector, 3)`, kiểm tra không lỗi `search_path`, và `anon`/`authenticated` bị từ chối.
- [ ] Nếu có lỗi, sửa file `…0002…` (chưa áp dụng thì sửa trực tiếp; đã áp dụng thì viết migration mới, đừng sửa lịch sử).

### B. Hàm index bài (chỉ admin)
- [ ] Thư mục `api/` ở gốc repo (Vercel Node function). Biến môi trường server: `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Thêm vào `.env.example`.
- [ ] `vercel.json`: rewrite hiện tại `/((?!assets/|robots.txt).*)` → `/index.html`; thêm `api/` vào phần loại trừ để không nuốt route function.
- [ ] `POST /api/admin/index-document {document_id}`: xác thực JWT trong header `Authorization`, kiểm tra `profiles.role = 'admin'` bằng service role; trả 401/403 nếu không phải.
- [ ] Các bước: đọc bài + `updated_at` → embed `title + text` → (nếu có `cover_url`) tải ảnh, chuyển sang PNG/JPEG bằng `sharp` nếu cần, embed → upsert `document_embeddings`/`image_embeddings` (xóa ảnh cũ của bài nếu `cover_url` đổi) → đặt `processed = true` **chỉ khi `updated_at` chưa đổi** từ lúc đọc (compare-and-set; nếu đổi thì để `false` để vòng sau xử lý lại).
- [ ] Lỗi ở bước nào: giữ `processed = false`, ghi `last_error`. Chạy lại phải idempotent.
- [ ] Mỗi lần gọi một bài (tránh timeout); script/nút "index tất cả" lặp ở phía gọi. Retry khi 429/5xx với backoff (script probe có mẫu).
- [ ] Gọi hàm này sau khi admin lưu bài trong editor (`Content.jsx`), và có script `bun run index` cho 90 bài seed.
- [ ] `bun install` thêm `sharp`, **commit `bun.lock`** (Vercel dùng `--frozen-lockfile`).

### C. API tìm kiếm phía người dùng
- [ ] Migration mới `…0003…`: hàm `public.search_documents_vector(q vector, filters jsonb, n int)` (chỉ `service_role`) trả jsonb đã lọc category/tag/ngày giống `private.list_documents` và dựng bằng `private.document_json(d,false)`, để trả bài đầy đủ trong một lần gọi.
- [ ] `POST /api/search` nhận `{q}` (chữ) hoặc ảnh (base64, PNG/JPEG, giới hạn dung lượng ví dụ 4 MB); embed query (chữ: prefix `task: search result | query:`; ảnh tìm bài: không prefix), gọi hàm trên. Khách chưa đăng nhập vẫn được query.
- [ ] Ghi `search_logs` từ function (service role): `engine='vector'`, `query_type` `text`/`image`, `query_string` rỗng với ảnh, `user_id` lấy từ JWT nếu có, `results_count`.
- [ ] Giới hạn tần suất (mỗi lần query tốn quota Gemini): tối thiểu giới hạn theo session và một trần toàn cục mỗi ngày. Hiện chưa biết rate limit/giá của gói miễn phí: xem trang pricing trước khi demo.
- [ ] Gemini lỗi hoặc chậm thì trả lỗi nhẹ để cột vector báo "tạm không khả dụng"; cột từ khóa vẫn chạy.
- [ ] Tìm ảnh bằng chữ (`match_images`): nếu làm tab "Ảnh", dùng query **không prefix**.
- [ ] Click: `portal_api` nhánh `/search/click` chưa ghi `engine`/`query_type` (mặc định `keyword`/`text`). Sửa để nhận `engine` hợp lệ (whitelist) và cập nhật `portal_api` bằng `create or replace` trong migration mới; test hiện có bao phủ hàm này nên chạy lại `bun tests/supabase.test.mjs`.

### D. Giao diện (`frontend/src/pages/Search.jsx`)
- [ ] Trang `/search` chia hai cột: trái là kết quả từ khóa hiện có (`api('/documents')`), phải là `/api/search`; gọi song song; chỉ hiện danh sách bài, không hiện điểm hay chỉ số.
- [ ] Ô tìm bằng ảnh: chọn file, xem trước, chuyển sang PNG bằng canvas ở trình duyệt, giới hạn dung lượng; khi tìm bằng ảnh chỉ hiện cột vector.
- [ ] Bộ lọc category/tag/ngày áp cho cả hai cột; mobile xếp dọc hoặc tab; `logClick` truyền thêm engine.

### E. Admin
- [ ] Tab "Search Engine" (`AdminLayout.jsx` `NAV` + route trong `main.jsx`, `RequireAuth adminOnly`).
- [ ] Số liệu qua `portal_api` nhánh `/admin/search-engine` (dùng `private.require_admin()`): tổng bài, đã/chưa index, số ảnh đã embed trên số bài có ảnh, bài lỗi + `last_error`.
- [ ] Nút: index các bài chưa xử lý, chạy lại một bài, index lại tất cả (gọi function ở B từng bài một).
- [ ] `SearchLogs.jsx` + nhánh `/admin/search-logs`: thêm cột và bộ lọc `engine`, `query_type`; trong `analytics`/top query lọc `query_type='text'` (dòng ảnh có `query_string` rỗng sẽ gộp thành một nhóm).

### F. Đánh giá và báo cáo
- [ ] Tập khoảng 30 đến 50 query có nhãn do người khác (không phải người viết hệ thống) soạn, gồm cả query rác để chọn ngưỡng điểm.
- [ ] P@k, MRR, nDCG: từ khóa so với vector (và hybrid RRF nếu còn thời gian). Dùng `scripts/embedding-probe.mjs` làm khung.
- [ ] Tìm ảnh: embedding so với tìm chữ trên `image_alt` + `image_caption` (nằm trong seed JSON, không có trong DB).
- [ ] Nêu trong báo cáo: dữ liệu bài và query người dùng đi qua Google; model là hộp đen (`gemini-embedding-2`, không phải EmbeddingGemma 2); log seed là dữ liệu mô phỏng.
- [ ] Cập nhật `README.md`: dòng "Tìm kiếm hiện tại mới là baseline…" và bảng `search_logs` (hai cột mới), bảng mới.

## 5. Thứ tự gợi ý

A → B → (C + D) → E → F. E làm song song được sau B. Mỗi bước nên chạy `bun tests/supabase.test.mjs` nếu đụng migration hoặc `portal_api`.
