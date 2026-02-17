import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

function readMongoUri() {
  const candidates = [
    path.join(process.cwd(), 'server', '.env'),
    path.join(process.cwd(), 'server', '.env.example')
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 0) continue;
      const key = trimmed.slice(0, idx).trim();
      if (key !== 'MONGODB_URI') continue;
      let value = trimmed.slice(idx + 1).trim();
      value = value.replace(/^['"]|['"]$/g, '');
      if (value) return value;
    }
  }

  return null;
}

function parseHostPort(mongoUri) {
  try {
    const url = new URL(mongoUri);
    const host = url.hostname || '127.0.0.1';
    const port = url.port ? Number(url.port) : 27017;
    return { host, port };
  } catch {
    return { host: '127.0.0.1', port: 27017 };
  }
}

const mongoUri = readMongoUri();
if (!mongoUri) {
  console.error('mongo:status: Could not find MONGODB_URI in server/.env or server/.env.example');
  process.exit(2);
}

const { host, port } = parseHostPort(mongoUri);

const socket = net.createConnection({ host, port });
const timeoutMs = 1200;

const timer = setTimeout(() => {
  socket.destroy(new Error('timeout'));
}, timeoutMs);

socket.once('connect', () => {
  clearTimeout(timer);
  socket.end();
  console.log(`mongo:status: OK (${host}:${port})`);
  process.exit(0);
});

socket.once('error', (err) => {
  clearTimeout(timer);
  console.error(`mongo:status: NOT READY (${host}:${port}) - ${err.message}`);
  process.exit(1);
});
