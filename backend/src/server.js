const config = require('./config');
const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');
const Document = require('./models/Document');
const User = require('./models/User');

async function start() {
  await connectDB();

  // exists() instead of estimatedDocumentCount(): fast counts can be stale after an unclean mongod shutdown.
  if (config.autoSeed && !(await Document.exists({})) && !(await User.exists({}))) {
    console.log('[seed] database is empty - inserting seed data');
    const { seed } = require('./seed/seed');
    await seed();
  }

  const server = app.listen(config.port, () => {
    console.log(`[server] listening on http://localhost:${config.port}`);
  });

  const shutdown = async (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close();
    await disconnectDB().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[server] failed to start:', err);
  process.exit(1);
});
