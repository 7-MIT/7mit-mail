import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app.js';
import { openDb } from './db.js';

const file = process.env.DB_FILE || './data/mail.db';
fs.mkdirSync(path.dirname(file), { recursive: true });
const { app, sync } = createApp({ db: openDb(file) });
const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => {
  console.log(`7MIT Mail listening on ${process.env.HOST || '127.0.0.1'}:${port}`);
  sync.startAll();
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { sync.stopAll(); server.close(() => process.exit(0)); });
