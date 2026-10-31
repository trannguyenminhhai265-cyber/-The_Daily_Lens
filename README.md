# The Daily Lens — News & Digital Magazine Portal

A full-stack news and magazine portal with complete CRUD, JWT authentication and
Role-Based Access Control (RBAC). It also includes a **Document Data Store** and
standardized **search/click and interaction logging**, ready for the Phase 2 search
engine (tokenization, inverted index, BM25 / TF-IDF ranking).

| Layer | Technology |
|---|---|
| Backend | Node.js 20+, Express 5, REST API, JWT, bcrypt |
| Database | MongoDB (Mongoose) as the document store |
| Frontend | React 18 + React Router (Vite), responsive CSS, light/dark mode |
| Hosting | One Render web service + MongoDB Atlas (free tiers) |

---

## Hướng dẫn nhanh (Quick start, Vietnamese)

```bash
# 1. Cài toàn bộ (root + backend + frontend) — chỉ cần Node.js >= 20
npm install

# 2. Chạy chế độ phát triển: API (http://localhost:5000) + giao diện (http://localhost:5173)
npm run dev
```

* Không cần cài MongoDB: nếu `backend/.env` không có `MONGODB_URI`, ứng dụng tự tải và chạy
  một MongoDB nhúng (lần đầu tải ~600 MB), dữ liệu lưu ở `backend/.mongo-data`.
* Lần chạy đầu tiên database trống nên dữ liệu mẫu (60 bài viết, 16 tài khoản, bình luận,
  log tìm kiếm…) được **tự động seed**.
* Chạy giống môi trường production (một cổng duy nhất): `npm run build` rồi `npm start`
  → mở http://localhost:5000.
* Reset dữ liệu mẫu: `npm run seed:reset`.

### Demo accounts

| Role | Username | Password |
|---|---|---|
| Super Admin | `admin` | `Admin@123` |
| Content Manager | `editor` (also `minh_tran`, `sarah_lee`) | `Password123` |
| Moderator | `moderator` | `Password123` |
| Data & SEO Specialist | `seo` | `Password123` |
| Reader | `alex_reader`, `linh_pham`, `david_kim`, … | `Password123` |

The login page has one-click buttons that fill these in.

---

## Running locally

### Prerequisites
* Node.js 20 or newer (tested with Node 24) and npm
* Git
* Optional: a MongoDB server or MongoDB Atlas cluster. Without one, the embedded MongoDB is used.

### Steps
```bash
git clone <your-repo-url> daily-lens
cd daily-lens
npm install                      # installs root, backend and frontend dependencies
cp backend/.env.example backend/.env   # optional, defaults work out of the box
npm run dev
```
Open http://localhost:5173. Vite proxies `/api` to the Express server on port 5000.

| Command (run from repo root) | What it does |
|---|---|
| `npm run dev` | API with auto-reload + Vite dev server |
| `npm run build` | Builds the React app into `frontend/dist` |
| `npm start` | Production server: API + built frontend on port 5000 |
| `npm run seed` | Seeds the database if it is empty |
| `npm run seed:reset` | Deletes all data and seeds again |

### Environment variables (`backend/.env`)
| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | HTTP port |
| `MONGODB_URI` | *(empty)* | MongoDB connection string. Empty = embedded MongoDB (dev only; required in production) |
| `EMBEDDED_DB_PORT` | `27018` | Port of the embedded MongoDB |
| `JWT_SECRET` | dev value | Secret for signing tokens. Set a long random value in production |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origins when the frontend is hosted elsewhere |
| `AUTO_SEED` | `true` | Seed demo data on start-up when the database is empty |
| `SEED_ADMIN_PASSWORD` | `Admin@123` | Password given to the seeded `admin` account. Set it on public deployments |

---

## Deploying (Render + MongoDB Atlas)

1. **Push the code to GitHub** (see *Publishing to GitHub* below).
2. **Create the database.** Sign up at https://www.mongodb.com/atlas, create a free *M0*
   cluster, add a database user, and under *Network Access* allow `0.0.0.0/0`.
   Copy the connection string and add a database name, for example
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/newsportal?retryWrites=true&w=majority`.
3. **Create the web service.** On https://render.com choose **New → Blueprint** and
   select the repository. Render reads `render.yaml`: the build command is
   `npm install && npm run build`, the start command is `npm start`, and a random
   `JWT_SECRET` is generated.
4. When asked, paste the Atlas string into **`MONGODB_URI`**, then deploy.
5. On first start the server seeds the empty database automatically. Open
   `https://<your-service>.onrender.com` and sign in with a demo account.

> The free Render plan sleeps after inactivity, so the first request can take about a minute.

Any Node host works the same way (Railway, Fly.io, a VPS). Build with `npm install && npm run build`,
start with `npm start`, and set `NODE_ENV=production`, `MONGODB_URI` and `JWT_SECRET`.

### Publishing to GitHub
```bash
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

---

## Features

### Client interface
* **Home & directory:** featured stories, a paginated list of the latest articles with summary
  snippets, most-read ranking, sections and a tag cloud.
* **Detail view:** full HTML content, cover image, author, date, reading time, view count,
  category, tags and related articles. Views are counted per request.
* **Accounts:** registration, login, profile editing (name, email, bio, avatar), password
  change and public profile pages.
* **Engagement:** threaded comments with replies, **@username tagging** (with autocomplete; tagged
  users see it on their profile), likes, 1–5 star ratings, sharing, and reporting of comments
  or articles.
* **Search & filtering (Phase 1 placeholder):** keyword search with case-insensitive regex
  (the SQL `LIKE '%term%'` equivalent; every term must match the title, summary or body).
  Filters: category, tag and date range, sorted by newest, oldest, most viewed or top rated.

### Admin interface (RBAC)
The admin menu only shows the screens the signed-in user is allowed to use. Every API
route is also protected on the server.

| Role | Default permissions | Screens |
|---|---|---|
| Super Admin | all | Users & roles (assign role and extra permissions, suspend, mute, reset password), System logs, Search logs, Global settings, plus everything below |
| Content Manager | `content:manage`, `content:publish`, `taxonomy:manage` | Articles CRUD with HTML editor and preview, publish / unpublish / archive, featured flag, Categories & Tags |
| Moderator | `comments:moderate`, `reports:handle` | Comment queue (pending / spam / visible / hidden, bulk actions), Reports (hide comment, mute author, resolve, dismiss), mute users |
| Data & SEO Specialist | `seo:manage`, `analytics:view` | SEO metadata editor (meta title and description with length hints, keywords, alt text, canonical URL, search-result preview), Analytics dashboard, Search logs |

**Spam control:** blocked-word list (matching comments go to the review queue), a maximum
number of links per comment (more are marked as spam), optional "approval required" policy,
auto-hide after N reports, and muting users.

**SEO:** for every `/article/:slug` page the server injects `<title>`, the meta description
and Open Graph tags, so crawlers and link previews see them without running JavaScript.
`/sitemap.xml` and `/robots.txt` are generated dynamically.

**Analytics:** total views, daily page views chart, views by category, top articles, top
search queries with click-through rate, queries with zero results (content gaps) and SEO
completeness.

---

## Data schema & Phase 2 preparation

All collections live in MongoDB. The two collections required for Phase 2:

### `documents` (document store)
| Field | Type | Notes |
|---|---|---|
| `_id` (`id` in JSON) | ObjectId | **required** |
| `title` | string | **required** |
| `content` | string (sanitized HTML) | **required** |
| `content_text` | string | plain-text copy of `content`, ready for tokenization |
| `summary` | string | **required** |
| `category_id` | ObjectId → `categories` | **required** |
| `tags` | ObjectId[] → `tags` | **required** |
| `author` | ObjectId → `users` | **required** |
| `created_at` | Date | **required** |
| `views_count` | number | **required** |
| `slug`, `status`, `published_at`, `updated_at` | | publication workflow |
| `cover_image {url, alt, caption}`, `seo {meta_title, meta_description, keywords, canonical_url}` | | media & SEO |
| `likes_count`, `comments_count`, `rating_avg`, `rating_count`, `reading_time`, `is_featured` | | engagement signals usable as ranking features |

### `search_logs` (search & click log)
| Field | Type | Notes |
|---|---|---|
| `user_id` | ObjectId \| null | **required** (null = anonymous) |
| `query_string` | string | **required** |
| `clicked_doc_id` | ObjectId \| null | **required**. `null` for a search event, the document id for a click |
| `timestamp` | Date | **required** |
| `event` | `"search"` \| `"click"` | event type |
| `results_count` | number | number of results returned (search events) |
| `position` | number | 1-based rank of the clicked result (click events) |
| `session_id`, `filters` | | groups events of a session and records the filters used |

A search is logged when a keyword query's first page loads. A click is logged when a
user opens a result from the search page (`POST /api/search/click`). Together they can be
used to evaluate ranking quality, for example CTR@k or MRR.

### Other collections
`users`, `categories`, `tags`, `comments` (with `mentions`), `likes`, `ratings`, `reports`,
`interaction_logs` (standardized `view` / `like` / `unlike` / `rate` / `comment` events with
`user_id`, `session_id`, `doc_id`, `timestamp`), `system_logs` (audit trail of logins and
admin actions) and `settings`.

### Seed data
`backend/src/seed/` holds **60 Vietnamese summaries** of VnExpress articles across 8
categories: Technology, Science, Business, Health, Environment, Culture, Sports and Travel.
Each summary links to its original source; the demo author is not the original article's author.
Most have expanded summaries, and 49 include externally hosted image URLs with attribution.
Those images depend on the source CDN; availability and reuse rights are not guaranteed.
One health article remains a short summary because its source could not be verified.
For an existing seed database, `node backend/src/seed/update-articles.js` updates only
articles whose content still matches the original seed, without resetting the database.
It also publishes the final two seed drafts if their expanded content is unchanged.
The seed also creates 16 users, about 140 comments (some with @mentions, plus spam and reported
examples), likes, ratings, about 5,400 interaction logs over 90 days and about 700 search/click logs.
Search logs are built by running each query through the real search filter, so result counts
and clicked documents are consistent.

---

## REST API overview

Base URL `/api`. Send `Authorization: Bearer <token>` for protected routes.

| Method & path | Access | Purpose |
|---|---|---|
| `POST /auth/register`, `POST /auth/login` | public | create account / sign in → `{ token, user }` |
| `GET /auth/me`, `PUT /auth/me`, `PUT /auth/me/password` | signed in | profile |
| `GET /documents?q=&category=&tag=&from=&to=&sort=&page=&limit=` | public | list / search / filter (logs searches) |
| `GET /documents/:slug` | public | article detail (+1 view, related, viewer state) |
| `POST /documents/:id/like`, `POST /documents/:id/rate` | signed in | like toggle / rating |
| `GET/POST /documents/:id/comments` | public / signed in | comments, replies, @mentions |
| `DELETE /comments/:id` | owner or moderator | delete comment |
| `POST /reports` | signed in | report a comment or article |
| `POST /search/click` | public | log a search-result click |
| `GET /users/:username`, `GET /users/lookup?q=` | public / signed in | public profile, mention autocomplete |
| `GET /categories`, `GET /tags` | public | taxonomy with article counts |
| `POST/PUT/DELETE /categories/:id`, `/tags/:id` | `taxonomy:manage` | taxonomy CRUD |
| `GET/POST/PUT/DELETE /manage/documents[/:id]` | `content:manage` | article CRUD (all statuses) |
| `PATCH /manage/documents/:id/status` | `content:publish` | publish / unpublish / archive |
| `PATCH /manage/documents/:id/seo` | `seo:manage` | SEO metadata & alt text |
| `GET /moderation/comments`, `PATCH /moderation/comments/:id`, `POST /moderation/comments/bulk` | `comments:moderate` | moderation queue |
| `GET/PATCH /moderation/reports[/:id]` | `reports:handle` | handle reports |
| `PATCH /moderation/users/:id/mute` | `comments:moderate` | mute / unmute a reader |
| `GET /analytics/overview?days=` | `analytics:view` | dashboard data |
| `GET/POST/PATCH/DELETE /admin/users[/:id]` | `users:manage` | accounts, roles, permissions |
| `GET /admin/logs`, `GET /admin/search-logs` | `logs:view` (search logs also `analytics:view`) | logs |
| `GET/PUT /admin/settings`, `GET /settings/public` | `settings:manage` / public | global settings |

---

## Project structure
```
├── package.json           # root scripts (install, dev, build, start, seed)
├── render.yaml            # Render deployment blueprint
├── backend/
│   ├── .env.example
│   └── src/
│       ├── server.js      # bootstrap: DB connection, auto-seed, HTTP server
│       ├── app.js         # Express app, routes, SEO meta injection, static frontend
│       ├── config/        # env config, DB (Atlas or embedded), roles & permissions
│       ├── middleware/    # authentication, permission checks, error handler
│       ├── models/        # Mongoose schemas
│       ├── routes/        # REST endpoints
│       ├── services/      # article search, filters and counters
│       ├── utils/         # slugify, HTML sanitizing, audit logging, pagination
│       └── seed/          # seed script + 60 realistic articles
└── frontend/
    └── src/
        ├── pages/         # Home, Article, Search, Auth, Profile
        ├── pages/admin/   # dashboard screens per role
        ├── components/    # layout, cards, comments, shared UI
        └── context/       # auth & settings state
```

## Security notes
* Passwords hashed with bcrypt, JWT authentication, permission checks on every protected route
* Article HTML sanitized on the server (`sanitize-html`) before storage
* Helmet security headers, rate limiting on login and registration, request size limits
* Admin actions and logins recorded in `system_logs`
* Demo passwords are for local testing only. Change or remove the demo accounts on a public deployment.
