const fs = require('fs');
const net = require('net');
const path = require('path');
const mongoose = require('mongoose');
const config = require('./index');

const EMBEDDED_DB_NAME = 'newsportal';
let embeddedServer = null;

function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  });
}

/**
 * Returns the MongoDB URI to use. When MONGODB_URI is not configured we fall back to an
 * embedded mongod (downloaded on first use) whose data lives in backend/.mongo-data, so the
 * project runs locally without installing MongoDB. If another process (e.g. the API server)
 * already started the embedded instance, we simply connect to it.
 */
async function resolveMongoUri() {
  if (config.mongoUri) return config.mongoUri;
  if (config.isProd) {
    throw new Error('MONGODB_URI must be set in production (e.g. a MongoDB Atlas connection string).');
  }

  const port = config.embeddedDbPort;
  if (!(await isPortOpen(port))) {
    const { MongoMemoryServer } = require('mongodb-memory-server-core');
    const dbPath = path.resolve(__dirname, '../../.mongo-data');
    fs.mkdirSync(dbPath, { recursive: true });
    console.log(`[db] MONGODB_URI not set - starting embedded MongoDB on port ${port}`);
    console.log('[db] (the very first start downloads the MongoDB binary, ~600 MB)');
    embeddedServer = await MongoMemoryServer.create({
      instance: { port, dbPath, dbName: EMBEDDED_DB_NAME, storageEngine: 'wiredTiger' },
    });
  }
  return `mongodb://127.0.0.1:${port}/${EMBEDDED_DB_NAME}`;
}

async function connectDB() {
  const uri = await resolveMongoUri();
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const { host, port, name } = mongoose.connection;
  console.log(`[db] connected to ${host}:${port}/${name}`);
  return mongoose.connection;
}

async function disconnectDB() {
  if (embeddedServer) {
    // Ask mongod to shut down cleanly so WiredTiger flushes its metadata.
    await mongoose.connection.db.admin().command({ shutdown: 1 }).catch(() => {});
  }
  await mongoose.disconnect();
  if (embeddedServer) {
    await embeddedServer.stop({ doCleanup: false });
    embeddedServer = null;
  }
}

module.exports = { connectDB, disconnectDB };
