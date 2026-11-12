# The Daily Lens — đồ án search engine

React/Vite được build thành frontend tĩnh trên Vercel, gọi trực tiếp Supabase Auth và PostgreSQL RPC. Dùng Bun; không cần server ứng dụng riêng.

## Chạy và kiểm tra

```sh
bun install --frozen-lockfile
cp frontend/.env.example frontend/.env
# Điền URL và publishable key của project Supabase
bun run dev
```

Mở http://localhost:5173. `bun run dev` chỉ chạy frontend. Dùng `bun run preview` để xem bản build tại máy.

```sh
bun run test     # PostgreSQL WASM: schema, dữ liệu, quyền và nghiệp vụ
bun run build    # production frontend
bun run test:live # kiểm thử project thật bằng dữ liệu tạm, cần quyền CLI/admin
```

## Phạm vi tính năng

- Đăng ký, xác nhận email, đăng nhập bằng email, quên/đổi mật khẩu.
- Xem bài, lọc theo danh mục/tag/ngày và tìm kiếm từ khóa.
- Admin tạo/sửa/xóa bài viết và quản lý danh mục/tag.
- Ghi search/click logs; xem và lọc dữ liệu mô phỏng/thực tế.
- Xuất dataset bài viết từ màn hình quản trị để triển khai indexing/ranking.

Chỉ có `admin` và `user`. Vai trò nằm trong database; tự sửa metadata Auth không cấp quyền admin. Không có bình luận, like, rating, báo cáo, kiểm duyệt, SEO dashboard, cấu hình hệ thống hoặc quản trị tài khoản riêng.

## Các phần đã bỏ và quan hệ database tương ứng

| Nhóm tính năng đã bỏ | Phần database/code được bỏ khỏi hoạt động |
|---|---|
| Bình luận, gắn thẻ người dùng, báo cáo, kiểm duyệt | `comments`, `comment_mentions`, `reports`; các màn hình và RPC liên quan |
| Like, rating và analytics tương tác | `likes`, `ratings`, `interaction_logs`; bỏ counter/aggregation từ bài viết |
| SEO, biên tập nhiều trạng thái | Metadata SEO, featured, reading time, trạng thái bài; bỏ SEO Function và dashboard |
| Năm vai trò và quyền cấp riêng | Bỏ permissions/mute/ban; thay bằng hai vai trò `admin/user` |
| Quản trị tài khoản, cấu hình hệ thống, audit | Bỏ Edge Function `admin-users`, `settings`, `system_logs`, role metadata và các màn hình tương ứng |
| Hồ sơ cộng đồng | Bỏ bio/avatar/public profile và lịch sử tương tác công khai |

Không chỉ ẩn menu: các endpoint đã bỏ không còn được RPC phục vụ. Snapshot cũ chỉ nằm trong `archive`, ngoài schema hoạt động của ứng dụng.

## Database đang dùng: 9 bảng

| Bảng | Nội dung |
|---|---|
| `profiles` | `id`, `username`, `display_name`, `role`, timestamps; liên kết Supabase Auth |
| `documents` | `id`, `title`, `content` HTML/plain text, `content_text`, `summary`, `category_id`, `author`, `created_at`, `views_count`; thêm `slug`, ảnh `cover_url`, `source_url`, `updated_at` |
| `categories` | `id`, `name`, `slug`, timestamps |
| `tags` | `id`, `name`, `slug`, timestamps |
| `document_tags` | Bảng liên kết bài viết–tag, khóa chính kép |
| `search_logs` | `id`, `user_id`, `query_string`, `clicked_doc_id`, `timestamp`, `event`, `session_id`, `position`, `results_count`, `is_synthetic`, `engine` (`keyword` hoặc `vector`, mặc định `keyword`), `query_type` (`text` hoặc `image`, mặc định `text`); `query_string` rỗng khi tìm bằng ảnh |
| `search_index_status` | `document_id`, `processed`, `last_error`, `updated_at`; hàng chờ index. Thêm bài, hoặc đổi `title`, `summary`, `content_text`, `cover_url`, đưa bài về trạng thái chưa xử lý |
| `document_embeddings` | `document_id`, `embedding` (vector 768), `model`, `updated_at`; một vector cho mỗi bài |
| `image_embeddings` | `id`, `document_id`, `image_url`, `embedding` (vector 768), `model`, `updated_at`; duy nhất theo (`document_id`, `image_url`) |

`tags` trong dataset phẳng được JOIN từ `document_tags` và `tags`. `content_text` phục vụ indexing; `content` giữ cách hiển thị bài. `source_url` giữ nguồn bài viết (không phải metadata SEO).

Log `search` có `clicked_doc_id = NULL`; log `click` có ID bài được chọn. Khách chưa đăng nhập có `user_id = NULL`, nhóm theo `session_id`. Log seed được đánh dấu `is_synthetic = true`, không dùng để tuyên bố chất lượng tìm kiếm với người dùng thật.

Tìm kiếm gồm hai cột (đang triển khai, xem `docs/search-engine-tasks.md`):

- Cột trái, từ khóa: mọi từ trong câu tìm phải xuất hiện trong title, summary hoặc content_text. Chưa có inverted index, TF-IDF hay BM25.
- Cột phải, ngữ nghĩa: embedding bằng Gemini `gemini-embedding-2` ở 768 chiều, lưu trong pgvector và tìm bằng quét chính xác (không dùng index xấp xỉ). Người dùng cũng có thể tìm bằng ảnh; khi đó chỉ cột ngữ nghĩa hiện kết quả.

Migration `202611130001` và `202611130002` chưa áp dụng lên Supabase thật, và migration vector chưa được chạy trên Postgres có pgvector. Ba bảng tìm kiếm mới chỉ `service_role` được truy cập.

## Biến môi trường server và lập chỉ mục

Các biến này chỉ đọc ở phía server (function hoặc script quản trị), không có tiền tố `VITE_`:

- `GEMINI_API_KEY`: khóa gọi Gemini API để tạo embedding. Khóa không đi vào frontend.
- `SUPABASE_URL`: URL project Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: secret key, dùng để ghi bảng embedding và `search_index_status`. Không in ra log.
- `SEARCH_DAILY_CAP`: trần số lượt query gọi Gemini mỗi ngày, áp dụng toàn hệ thống.

```sh
bun run index   # index các bài đang chờ trong search_index_status
```

Lệnh `bun run index`, hàm server và `.env.example` cho các biến trên chưa có trong repo; xem mục B của `docs/search-engine-tasks.md`.

Lưu ý dữ liệu và mô hình:

- Nội dung bài (title, summary, đoạn văn), ảnh bìa và câu query được gửi tới Google để tạo embedding. Ảnh người dùng tải lên không được lưu.
- `gemini-embedding-2` là hộp đen: không biết dữ liệu huấn luyện và cách biểu diễn bên trong. Đây không phải EmbeddingGemma 2.
- Log seed (`is_synthetic = true`) là dữ liệu mô phỏng. Không dùng để kết luận chất lượng tìm kiếm với người dùng thật.

## Code và quyền

- `frontend/src/api.js`: Supabase Auth và RPC `portal_api`.
- `supabase/migrations/202611110005_simplify.sql`: schema/nghiệp vụ hiện tại.
- `tests/supabase.test.mjs`: chạy đầy đủ lịch sử migration rồi kiểm tra schema cuối cùng.
- `scripts/seed-supabase.mjs`: tạo dataset mới, từ chối nếu đã có bài.
- `supabase/seed-data/articles-vnexpress.json`: dataset mẫu, dùng bởi script seed Supabase.
- `vercel.json`: cài dependency, build `frontend/dist` và rewrite đường dẫn SPA.

Các bảng bật RLS, không cho browser truy vấn/ghi trực tiếp. RPC trả về dữ liệu đã chọn và kiểm tra `admin` trước các thao tác quản trị. Publishable key dùng ở frontend; secret/service_role key chỉ dùng trong script quản trị, không đặt vào biến `VITE_`.

Migration 005 lưu snapshot đầy đủ schema cũ vào schema `archive` trước khi dọn public schema. `archive` không expose cho frontend; migration giữ dữ liệu bài viết, quan hệ, tài khoản và search logs hiện có. Các migration 001–004 là lịch sử, không phải tính năng đang chạy. Không sửa hoặc xóa lịch sử migration đã deploy.

## Supabase và Vercel

```sh
supabase login
supabase link YOUR_PROJECT_REF
supabase db push --remote --dry-run
supabase db push --remote --yes
```

Với Supabase CLI v2, `db push` mặc định dùng linked project. Không cần deploy Edge Function.

Vercel: import repository, Root Directory ở gốc; cấu hình install/build/output đã có trong `vercel.json`. Đặt `VITE_SUPABASE_URL` và `VITE_SUPABASE_PUBLISHABLE_KEY` trước khi build. Rewrite SPA cho phép mở trực tiếp các đường dẫn như `/search`, `/profile`, `/admin` ([tài liệu Vercel](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas)). Chỉ dùng publishable key ở frontend ([tài liệu Supabase](https://supabase.com/docs/guides/getting-started/api-keys)).

Trong Supabase Auth, đặt Site URL là domain Vercel và thêm URL `/profile`, `/reset-password` của domain vào Redirect URLs. Xác nhận email cần cấu hình gửi mail phù hợp; kiểm thử token không chứng minh email đã được gửi vào hộp thư thật.

## Seed một lần

Dataset mẫu nằm tại `supabase/seed-data/articles-vnexpress.json`. Với project mới đã áp dụng migrations, đặt `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` (>=12 ký tự) và `SUPABASE_PROJECT_REF`, rồi chạy `bun run seed`. Script quản trị dùng secret key từ biến môi trường hoặc phiên Supabase CLI, không in key. Seed từ chối nếu đã có bài và không chạy trong quá trình build/deploy.

Bản sao dữ liệu MongoDB và cấu hình cục bộ cũ, nếu có, nằm trong `.local-backups/`. Thư mục này được loại khỏi Git và Vercel, không được ứng dụng sử dụng.
