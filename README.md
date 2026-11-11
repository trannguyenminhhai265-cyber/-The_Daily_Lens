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

## Database đang dùng: 6 bảng

| Bảng | Nội dung |
|---|---|
| `profiles` | `id`, `username`, `display_name`, `role`, timestamps; liên kết Supabase Auth |
| `documents` | `id`, `title`, `content` HTML/plain text, `content_text`, `summary`, `category_id`, `author`, `created_at`, `views_count`; thêm `slug`, ảnh `cover_url`, `source_url`, `updated_at` |
| `categories` | `id`, `name`, `slug`, timestamps |
| `tags` | `id`, `name`, `slug`, timestamps |
| `document_tags` | Bảng liên kết bài viết–tag, khóa chính kép |
| `search_logs` | `id`, `user_id`, `query_string`, `clicked_doc_id`, `timestamp`, `event`, `session_id`, `position`, `results_count`, `is_synthetic` |

`tags` trong dataset phẳng được JOIN từ `document_tags` và `tags`. `content_text` phục vụ indexing; `content` giữ cách hiển thị bài. `source_url` giữ nguồn bài viết (không phải metadata SEO).

Log `search` có `clicked_doc_id = NULL`; log `click` có ID bài được chọn. Khách chưa đăng nhập có `user_id = NULL`, nhóm theo `session_id`. Log seed được đánh dấu `is_synthetic = true`, không dùng để tuyên bố chất lượng tìm kiếm với người dùng thật.

Tìm kiếm hiện tại mới là baseline khớp từ trong title/summary/content_text, chưa có inverted index/TF-IDF/BM25. Phần đó là công việc triển khai search engine tiếp theo.

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
