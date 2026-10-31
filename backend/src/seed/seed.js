/* eslint-disable no-console */
// Seeds the database with realistic demo data.
//   npm run seed          -> seeds only when the documents collection is empty
//   npm run seed:reset    -> wipes all collections and seeds again
const mongoose = require('mongoose');
const User = require('../models/User');
const Document = require('../models/Document');
const Setting = require('../models/Setting');
const { Category, Tag } = require('../models/Taxonomy');
const { Comment, Like, Rating, Report } = require('../models/Engagement');
const { SearchLog, InteractionLog, SystemLog } = require('../models/Logs');
const { slugify, htmlToText, readingTime } = require('../utils/text');
const { buildDocumentFilter } = require('../services/documents');

const ARTICLES = require('./data/articles-vnexpress.json').map((article) => ({
  t: article.title,
  c: article.category,
  tags: article.tags,
  s: article.summary,
  b: article.paragraphs || [article.summary],
  source: article.url,
  image: article.image_url || '',
  imageAlt: article.image_alt || article.title,
  imageCaption: article.image_caption || '',
}));

const CATEGORIES = [
  { name: 'Technology', slug: 'technology', color: '#2563eb', description: 'Software, gadgets, AI and the digital world.' },
  { name: 'Science', slug: 'science', color: '#7c3aed', description: 'Discoveries from space to the human body.' },
  { name: 'Business', slug: 'business', color: '#0f766e', description: 'Economy, markets, work and personal finance.' },
  { name: 'Health', slug: 'health', color: '#dc2626', description: 'Wellbeing, fitness, nutrition and medicine.' },
  { name: 'Environment', slug: 'environment', color: '#16a34a', description: 'Climate, energy, nature and sustainability.' },
  { name: 'Culture', slug: 'culture', color: '#c2410c', description: 'Arts, books, music, film and traditions.' },
  { name: 'Sports', slug: 'sports', color: '#0891b2', description: 'Competition, training and the science of sport.' },
  { name: 'Travel', slug: 'travel', color: '#ca8a04', description: 'Destinations, tips and responsible travel.' },
];

const DEMO_PASSWORD = 'Password123';
const STAFF = [
  // Set SEED_ADMIN_PASSWORD on public deployments so the Super Admin does not use the demo password.
  { username: 'admin', email: 'admin@dailylens.test', display_name: 'Site Administrator', role: 'super_admin', password: process.env.SEED_ADMIN_PASSWORD || 'Admin@123', bio: 'Keeps the lights on.' },
  { username: 'editor', email: 'editor@dailylens.test', display_name: 'Grace Bennett', role: 'content_manager', bio: 'Managing editor covering technology and business.' },
  { username: 'minh_tran', email: 'minh.tran@dailylens.test', display_name: 'Minh Tran', role: 'content_manager', bio: 'Science and environment writer based in Hanoi.' },
  { username: 'sarah_lee', email: 'sarah.lee@dailylens.test', display_name: 'Sarah Lee', role: 'content_manager', bio: 'Health, culture and travel features.' },
  { username: 'moderator', email: 'moderator@dailylens.test', display_name: 'Daniel Ortiz', role: 'moderator', bio: 'Community moderator.' },
  { username: 'seo', email: 'seo@dailylens.test', display_name: 'Priya Shah', role: 'seo_specialist', bio: 'Data and SEO specialist.' },
];
const READERS = [
  ['alex_reader', 'Alex Morgan'],
  ['linh_pham', 'Linh Pham'],
  ['david_kim', 'David Kim'],
  ['maria_garcia', 'Maria Garcia'],
  ['tuan_le', 'Tuan Le'],
  ['emma_wilson', 'Emma Wilson'],
  ['huong_do', 'Huong Do'],
  ['omar_haddad', 'Omar Haddad'],
  ['chloe_martin', 'Chloe Martin'],
  ['nam_vo', 'Nam Vo'],
];

const COMMENTS = [
  'Really clear explanation, thanks for writing this.',
  'I shared this with my study group. The way it is broken into sections makes it easy to follow.',
  'Great read. I would love a follow-up article that goes deeper into the practical side.',
  'This answered a question I have had for ages. Bookmarking it.',
  'Interesting perspective, although I think the costs deserve more attention.',
  'Does anyone have recommendations for further reading on this topic?',
  'I tried this last month and can confirm it makes a real difference.',
  'Well researched and balanced. More articles like this, please.',
  'The second half was my favourite part. Very practical advice.',
  'I disagree slightly with the conclusion, but the article is still very informative.',
  'My teacher mentioned this in class last week, nice to see it explained properly.',
  'Short, clear and useful. Thank you!',
  'It would be helpful to include a few sources at the end for readers who want to check details.',
  'This is exactly the kind of explainer I needed before my exam.',
  'Loved the examples, they made a complicated idea much easier to picture.',
  'I had no idea about this. Learned something new today.',
  'Good points overall. I think local context matters a lot here too.',
  'Printing this out for my parents, they always ask me about this.',
  'The headline undersells how good this piece is.',
  'Would be great to see a version of this with charts or diagrams.',
];
const MENTION_COMMENTS = [
  '@{u} you were asking about this the other day, worth a read!',
  'Agree with @{u}, the practical tips are the best part.',
  '@{u} this is the article I told you about.',
];
const SPAM_COMMENTS = [
  'Earn free money fast!!! visit http://example-spam.test and http://example-spam.test/win now',
  'Best casino bonus here http://casino.example http://casino.example/2 http://casino.example/3',
];

const QUERIES = [...new Set(ARTICLES.flatMap((article) => article.tags))];

// Small deterministic PRNG so every seed run produces the same data.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261031);
const int = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const sample = (arr, n) => [...arr].sort(() => rand() - 0.5).slice(0, n);
const DAY = 24 * 3600 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY - int(0, DAY / 1000) * 1000);

function toHtml(paragraphs) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return paragraphs.map((p) => (p.startsWith('## ') ? `<h2>${escape(p.slice(3))}</h2>` : `<p>${escape(p)}</p>`)).join('\n');
}

async function resetDatabase() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  Setting.invalidate();
}

async function seed({ reset = false } = {}) {
  if (reset) await resetDatabase();

  // Settings
  await Setting.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global', banned_words: ['casino', 'free money', 'viagra'] } },
    { upsert: true }
  );
  Setting.invalidate();

  // Users
  const users = [];
  for (const s of STAFF) {
    const u = new User({ ...s, password: undefined });
    await u.setPassword(s.password || DEMO_PASSWORD);
    users.push(u);
  }
  for (const [username, display_name] of READERS) {
    const u = new User({ username, display_name, email: `${username}@example.com`, role: 'user', bio: '' });
    await u.setPassword(DEMO_PASSWORD);
    users.push(u);
  }
  await User.insertMany(users);
  const byName = Object.fromEntries(users.map((u) => [u.username, u]));
  const authors = [byName.editor, byName.minh_tran, byName.sarah_lee];
  const readers = users.filter((u) => u.role === 'user');

  // Categories & tags
  const categories = await Category.insertMany(CATEGORIES);
  const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
  const tagNames = [...new Set(ARTICLES.flatMap((a) => a.tags))];
  const tags = await Tag.insertMany(tagNames.map((name) => ({ name, slug: slugify(name) })));
  const tagByName = Object.fromEntries(tags.map((t) => [t.name, t]));

  // Documents - spread over the last year, newest first in the source order shuffled.
  const order = sample(ARTICLES.map((_, i) => i), ARTICLES.length);
  const docs = ARTICLES.map((a, i) => {
    const age = Math.round((order.indexOf(i) / ARTICLES.length) * 360) + int(0, 4);
    const published = daysAgo(age);
    const content = `${toHtml(a.b)}\n<p>Bản tóm tắt do The Daily Lens biên soạn. <a href="${a.source}" target="_blank" rel="noopener noreferrer">Đọc bài gốc trên VnExpress</a>.</p>`;
    const content_text = htmlToText(content);
    const slug = slugify(a.t);
    const hasSeo = rand() > 0.3;
    const freshness = Math.max(0.15, 1 - age / 400);
    return {
      title: a.t,
      slug,
      summary: a.s,
      content,
      content_text,
      category_id: catBySlug[a.c]._id,
      tags: a.tags.map((t) => tagByName[t]._id),
      author: authors[i % authors.length]._id,
      status: 'published',
      published_at: published,
      created_at: published,
      updated_at: published,
      cover_image: {
        url: a.image,
        alt: a.imageAlt,
        caption: a.imageCaption,
      },
      seo: hasSeo
        ? { meta_title: a.t.slice(0, 70), meta_description: a.s.slice(0, 160), keywords: a.tags, canonical_url: '' }
        : { meta_title: '', meta_description: '', keywords: [], canonical_url: '' },
      reading_time: readingTime(content_text),
      views_count: Math.round(int(80, 2500) * freshness),
      is_featured: false,
    };
  });
  // Feature the most recent published articles.
  docs
    .filter((d) => d.status === 'published')
    .sort((x, y) => y.published_at - x.published_at)
    .slice(0, 3)
    .forEach((d) => (d.is_featured = true));

  const inserted = await Document.insertMany(docs, { timestamps: false });
  const published = inserted.filter((d) => d.status === 'published');

  // Likes, ratings and comments
  const likes = [];
  const ratings = [];
  const comments = [];
  for (const doc of published) {
    for (const u of sample(readers, int(0, 8))) likes.push({ user_id: u._id, document_id: doc._id, created_at: doc.published_at });
    for (const u of sample(readers, int(0, 7))) {
      ratings.push({ user_id: u._id, document_id: doc._id, value: pick([3, 4, 4, 5, 5, 5, 2]) });
    }
    const commenters = sample(readers, int(0, 5));
    commenters.forEach((u, idx) => {
      let content = pick(COMMENTS);
      if (rand() < 0.25) {
        const other = pick(readers.filter((r) => r !== u));
        content = pick(MENTION_COMMENTS).replace('{u}', other.username);
      }
      const created = new Date(doc.published_at.getTime() + (idx + 1) * int(1, 72) * 3600 * 1000);
      comments.push({
        _id: new mongoose.Types.ObjectId(),
        document_id: doc._id,
        user_id: u._id,
        content,
        mentions: (content.match(/@([a-z0-9_]+)/) || [])[1] ? [byName[content.match(/@([a-z0-9_]+)/)[1]]._id] : [],
        status: 'visible',
        created_at: created > new Date() ? new Date() : created,
      });
    });
  }
  // Replies, a pending comment and spam for the moderation queue.
  for (const parent of sample(comments, 15)) {
    const author = pick(authors);
    comments.push({
      document_id: parent.document_id,
      user_id: author._id,
      parent_id: parent._id,
      content: pick(['Thanks for reading!', 'Good suggestion, we will consider a follow-up.', 'Glad it was useful.']),
      status: 'visible',
      created_at: new Date(parent.created_at.getTime() + 3600 * 1000),
    });
  }
  SPAM_COMMENTS.forEach((content, i) =>
    comments.push({
      document_id: published[i]._id,
      user_id: readers[readers.length - 1 - i]._id,
      content,
      status: 'spam',
      moderation_reason: 'Too many links',
      created_at: daysAgo(i + 1),
    })
  );
  comments.push({
    document_id: published[2]._id,
    user_id: byName.omar_haddad._id,
    content: 'This article ignores half of the story and the comments here are full of people who did not read it.',
    status: 'visible',
    flags_count: 2,
    created_at: daysAgo(2),
  });

  await Like.insertMany(likes);
  await Rating.insertMany(ratings);
  const insertedComments = await Comment.insertMany(comments, { timestamps: false });

  // Reports
  const flagged = insertedComments[insertedComments.length - 1];
  await Report.insertMany([
    { target_type: 'comment', target_id: flagged._id, reporter_id: byName.linh_pham._id, reason: 'abuse', details: 'Rude towards other readers.' },
    { target_type: 'comment', target_id: flagged._id, reporter_id: byName.david_kim._id, reason: 'offensive', details: '' },
    { target_type: 'document', target_id: published[5]._id, reporter_id: byName.emma_wilson._id, reason: 'misinformation', details: 'Please double-check the figures in the second section.' },
  ]);

  // Denormalised counters
  for (const doc of published) {
    const docLikes = likes.filter((l) => String(l.document_id) === String(doc._id)).length;
    const docRatings = ratings.filter((r) => String(r.document_id) === String(doc._id));
    const docComments = comments.filter((c) => String(c.document_id) === String(doc._id) && c.status === 'visible').length;
    const avg = docRatings.length ? docRatings.reduce((s, r) => s + r.value, 0) / docRatings.length : 0;
    await Document.updateOne(
      { _id: doc._id },
      { likes_count: docLikes, comments_count: docComments, rating_avg: Math.round(avg * 10) / 10, rating_count: docRatings.length },
      { timestamps: false }
    );
  }

  // Interaction logs: page views over the last 90 days (more recent articles get more traffic).
  const interactions = [];
  for (let d = 89; d >= 0; d -= 1) {
    const dailyViews = int(25, 60) + Math.round((90 - d) / 3);
    for (let v = 0; v < dailyViews; v += 1) {
      const doc = published[Math.min(published.length - 1, Math.floor(Math.pow(rand(), 2) * published.length))];
      interactions.push({
        user_id: rand() < 0.35 ? pick(readers)._id : null,
        session_id: `seed-${int(1, 400)}`,
        doc_id: doc._id,
        action: 'view',
        timestamp: daysAgo(d),
      });
    }
  }
  await InteractionLog.insertMany(interactions);

  // Search & click logs: results are computed with the real search filter so the data is consistent.
  const searchLogs = [];
  for (let i = 0; i < 450; i += 1) {
    const query = pick(QUERIES);
    const user = rand() < 0.5 ? pick(readers) : null;
    const session = `seed-${int(1, 400)}`;
    const when = daysAgo(int(0, 89));
    const { filter } = await buildDocumentFilter({ q: query }, { status: 'published' });
    const results = await Document.find(filter).select('_id').sort({ published_at: -1 }).limit(10);
    searchLogs.push({
      user_id: user ? user._id : null,
      query_string: query,
      clicked_doc_id: null,
      event: 'search',
      session_id: session,
      results_count: await Document.countDocuments(filter),
      timestamp: when,
    });
    if (results.length && rand() < 0.65) {
      const position = Math.min(results.length, 1 + Math.floor(Math.pow(rand(), 2.5) * results.length));
      searchLogs.push({
        user_id: user ? user._id : null,
        query_string: query,
        clicked_doc_id: results[position - 1]._id,
        event: 'click',
        position,
        session_id: session,
        timestamp: new Date(when.getTime() + int(3, 60) * 1000),
      });
    }
  }
  await SearchLog.insertMany(searchLogs);

  await SystemLog.create({
    action: 'system.seed',
    actor_name: 'system',
    details: { documents: inserted.length, users: users.length, comments: comments.length, search_logs: searchLogs.length },
  });

  const summary = {
    users: users.length,
    categories: categories.length,
    tags: tags.length,
    documents: inserted.length,
    comments: comments.length,
    likes: likes.length,
    ratings: ratings.length,
    interaction_logs: interactions.length,
    search_logs: searchLogs.length,
  };
  console.log('[seed] done:', summary);
  return summary;
}

module.exports = { seed };

if (require.main === module) {
  const { connectDB, disconnectDB } = require('../config/db');
  (async () => {
    const reset = process.argv.includes('--reset');
    await connectDB();
    if (!reset && ((await Document.exists({})) || (await User.exists({})))) {
      console.log('[seed] database already contains data. Use "npm run seed:reset" to wipe and re-seed.');
    } else {
      await seed({ reset });
    }
    await disconnectDB();
  })().catch(async (err) => {
    console.error('[seed] failed:', err);
    await disconnectDB().catch(() => {});
    process.exit(1);
  });
}
