/* Update untouched demo articles without resetting users, comments, or other data. */
const Document = require('../models/Document');
const { connectDB, disconnectDB } = require('../config/db');
const { slugify, htmlToText, readingTime } = require('../utils/text');
const articles = require('./data/articles-vnexpress.json');

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toHtml = (paragraphs) => paragraphs.map((p) => p.startsWith('## ')
  ? `<h2>${escape(p.slice(3))}</h2>` : `<p>${escape(p)}</p>`).join('\n');
const sourceLink = (url) => `<p>Bản tóm tắt do The Daily Lens biên soạn. <a href="${url}" target="_blank" rel="noopener noreferrer">Đọc bài gốc trên VnExpress</a>.</p>`;

async function main() {
  await connectDB();
  let updated = 0;
  let skipped = 0;
  for (const article of articles) {
    if (!article.paragraphs || !article.paragraphs.length) { skipped += 1; continue; }
    const oldContent = `<p>${article.summary}</p>\n${sourceLink(article.url)}`;
    const content = `${toHtml(article.paragraphs)}\n${sourceLink(article.url)}`;
    const contentText = htmlToText(content);
    const changes = { content, content_text: contentText, reading_time: readingTime(contentText) };
    const doc = await Document.findOne({ slug: slugify(article.title), title: article.title, content: oldContent });
    if (!doc) { skipped += 1; continue; }
    if (!doc.cover_image?.url && article.image_url) {
      changes.cover_image = { url: article.image_url, alt: article.image_alt || article.title, caption: article.image_caption || '' };
    }
    const result = await Document.updateOne({ _id: doc._id, content: oldContent }, { $set: changes }, { timestamps: false });
    updated += result.modifiedCount;
  }
  // The previous seed intentionally left the final two untouched demo articles as drafts.
  let published = 0;
  for (const article of articles.slice(-2)) {
    if (!article.paragraphs?.length) continue;
    const content = `${toHtml(article.paragraphs)}\n${sourceLink(article.url)}`;
    const result = await Document.updateOne(
      { slug: slugify(article.title), title: article.title, content, status: 'draft' },
      { $set: { status: 'published' } }, { timestamps: false }
    );
    published += result.modifiedCount;
  }
  console.log(`[articles] updated ${updated}; published ${published}; skipped ${skipped} (missing, edited, or no expanded content)`);
}

main().then(disconnectDB).catch(async (error) => {
  console.error(error);
  await disconnectDB().catch(() => {});
  process.exitCode = 1;
});
