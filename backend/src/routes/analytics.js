// Analytics dashboard data for the Data & SEO Specialist.
const express = require('express');
const Document = require('../models/Document');
const User = require('../models/User');
const { Comment, Like } = require('../models/Engagement');
const { SearchLog, InteractionLog } = require('../models/Logs');
const { authenticate, requirePermission } = require('../middleware/auth');
const { PERMISSIONS } = require('../config/roles');

const router = express.Router();

router.get('/overview', authenticate, requirePermission(PERMISSIONS.ANALYTICS_VIEW), async (req, res) => {
  const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  since.setHours(0, 0, 0, 0);

  const [
    publishedCount,
    totals,
    userCount,
    commentCount,
    likeCount,
    dailyViews,
    topDocuments,
    byCategory,
    searchStats,
    topQueries,
    zeroResultQueries,
    seoMissing,
  ] = await Promise.all([
    Document.countDocuments({ status: 'published' }),
    Document.aggregate([{ $group: { _id: null, views: { $sum: '$views_count' } } }]),
    User.countDocuments(),
    Comment.countDocuments({ status: 'visible' }),
    Like.countDocuments(),
    InteractionLog.aggregate([
      { $match: { action: 'view', timestamp: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }, views: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Document.find({ status: 'published' })
      .sort({ views_count: -1 })
      .limit(10)
      .select('title slug views_count likes_count comments_count rating_avg'),
    Document.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: '$category_id', views: { $sum: '$views_count' }, articles: { $sum: 1 } } },
      { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'category' } },
      { $unwind: '$category' },
      { $project: { _id: 0, name: '$category.name', color: '$category.color', views: 1, articles: 1 } },
      { $sort: { views: -1 } },
    ]),
    SearchLog.aggregate([
      { $match: { timestamp: { $gte: since } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]),
    SearchLog.aggregate([
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: { $toLower: '$query_string' },
          searches: { $sum: { $cond: [{ $eq: ['$event', 'search'] }, 1, 0] } },
          clicks: { $sum: { $cond: [{ $eq: ['$event', 'click'] }, 1, 0] } },
        },
      },
      { $match: { searches: { $gt: 0 } } },
      { $sort: { searches: -1 } },
      { $limit: 10 },
    ]),
    SearchLog.aggregate([
      { $match: { event: 'search', results_count: 0, timestamp: { $gte: since } } },
      { $group: { _id: { $toLower: '$query_string' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Document.aggregate([
      { $match: { status: 'published' } },
      {
        $group: {
          _id: null,
          meta_title: { $sum: { $cond: [{ $eq: ['$seo.meta_title', ''] }, 1, 0] } },
          meta_description: { $sum: { $cond: [{ $eq: ['$seo.meta_description', ''] }, 1, 0] } },
          keywords: { $sum: { $cond: [{ $eq: [{ $size: { $ifNull: ['$seo.keywords', []] } }, 0] }, 1, 0] } },
          cover_alt: { $sum: { $cond: [{ $eq: ['$cover_image.alt', ''] }, 1, 0] } },
        },
      },
    ]),
  ]);

  // Fill missing days with zero so the chart has a continuous axis.
  const viewsByDay = new Map(dailyViews.map((d) => [d._id, d.views]));
  const daily = [];
  for (let d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, views: viewsByDay.get(key) || 0 });
  }

  const events = Object.fromEntries(searchStats.map((s) => [s._id, s.count]));
  const searches = events.search || 0;
  const clicks = events.click || 0;
  const seo = seoMissing[0] || { meta_title: 0, meta_description: 0, keywords: 0, cover_alt: 0 };
  delete seo._id;

  res.json({
    range_days: days,
    totals: {
      published: publishedCount,
      views: totals[0] ? totals[0].views : 0,
      users: userCount,
      comments: commentCount,
      likes: likeCount,
      searches,
      clicks,
      ctr: searches ? Math.round((clicks / searches) * 1000) / 10 : 0,
    },
    daily_views: daily,
    top_documents: topDocuments,
    by_category: byCategory,
    top_queries: topQueries.map((q) => ({
      query: q._id,
      searches: q.searches,
      clicks: q.clicks,
      ctr: Math.round((q.clicks / q.searches) * 1000) / 10,
    })),
    zero_result_queries: zeroResultQueries.map((q) => ({ query: q._id, count: q.count })),
    seo_missing: seo,
  });
});

module.exports = router;
