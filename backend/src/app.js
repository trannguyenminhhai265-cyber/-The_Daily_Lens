const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const config = require('./config');
const Document = require('./models/Document');
const Setting = require('./models/Setting');
const { notFoundHandler, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
if (!config.isProd) app.use(morgan('dev'));

// ---- API ----
app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/manage', require('./routes/manage'));
app.use('/api/moderation', require('./routes/moderation'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api', require('./routes/taxonomy'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/engagement'));
app.use('/api', notFoundHandler);

// ---- SEO helpers ----
function siteUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nSitemap: ${siteUrl(req)}/sitemap.xml\n`);
});

app.get('/sitemap.xml', async (req, res, next) => {
  try {
    const docs = await Document.find({ status: 'published' }).select('slug updated_at').sort({ published_at: -1 });
    const base = siteUrl(req);
    const urls = [`<url><loc>${base}/</loc></url>`].concat(
      docs.map((d) => `<url><loc>${base}/article/${d.slug}</loc><lastmod>${d.updated_at.toISOString()}</lastmod></url>`)
    );
    res
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (err) {
    next(err);
  }
});

// ---- Frontend (production build) ----
const escapeHtml = (s) =>
  String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

if (fs.existsSync(path.join(config.frontendDist, 'index.html'))) {
  const indexHtml = fs.readFileSync(path.join(config.frontendDist, 'index.html'), 'utf8');
  app.use(express.static(config.frontendDist, { index: false, maxAge: '7d' }));

  // Server-side meta tags so that crawlers and link previews see each article's SEO metadata.
  app.get('/{*splat}', async (req, res) => {
    let title;
    let description;
    let image = '';
    try {
      const settings = await Setting.get();
      title = settings.site_name;
      description = settings.tagline;
      const match = req.path.match(/^\/article\/([a-z0-9-]+)$/);
      if (match) {
        const doc = await Document.findOne({ slug: match[1], status: 'published' }).select('title summary seo cover_image');
        if (doc) {
          title = `${doc.seo.meta_title || doc.title} | ${settings.site_name}`;
          description = doc.seo.meta_description || doc.summary;
          image = doc.cover_image.url;
        }
      }
    } catch {
      // fall back to the static index.html values
    }
    const meta = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(description)}" />`,
      `<meta property="og:title" content="${escapeHtml(title)}" />`,
      `<meta property="og:description" content="${escapeHtml(description)}" />`,
      image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : '',
    ].join('\n    ');
    res.type('html').send(indexHtml.replace(/<title>.*<\/title>/, meta));
  });
} else {
  app.get('/', (_req, res) =>
    res.type('text/plain').send('API is running. Start the frontend with "npm run dev" (http://localhost:5173) or build it with "npm run build".')
  );
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
