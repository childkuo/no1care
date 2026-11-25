/**
 * 沒人在乎牆軟體 (No1Care Wall) — 輕量零依賴即時協作伺服器
 *
 * 支援：
 * - 無限制牆面 CRUD 與 JSON 檔案持久化 (data/db.json)
 * - Server-Sent Events (SSE) 多人即時同步
 * - 靜態前端頁面託管
 *
 * 啟動方式：npm start  (預設 http://localhost:3000)
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** @type {Map<string, object>} */
const wallsStore = new Map();
/** @type {Set<http.ServerResponse>} */
const sseClients = new Set();

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDatabase() {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) return;
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.walls)) {
      for (const wall of parsed.walls) {
        if (wall && wall.id) {
          wallsStore.set(wall.id, wall);
        }
      }
    }
  } catch (err) {
    console.error('[No1Care] Failed to load database:', err.message);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDatabase, 120);
}

function flushDatabase() {
  ensureDataDir();
  const payload = JSON.stringify(
    {
      version: 1,
      updatedAt: new Date().toISOString(),
      walls: Array.from(wallsStore.values()),
    },
    null,
    2
  );
  const tmpFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmpFile, payload, 'utf8');
  fs.renameSync(tmpFile, DB_FILE);
}

function broadcastEvent(eventName, data, originClientId = '') {
  const serialized = `event: ${eventName}\ndata: ${JSON.stringify({
    ...data,
    originClientId,
    ts: Date.now(),
  })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(serialized);
    } catch {
      sseClients.delete(res);
    }
  }
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(ROOT_DIR, `.${cleanPath}`);
  if (!resolved.startsWith(ROOT_DIR) || resolved.includes(`${path.sep}data${path.sep}`) || resolved.endsWith('server.js')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(resolved).pipe(res);
  });
}

loadDatabase();

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(reqUrl.pathname);
  const clientId = String(req.headers['x-client-id'] || '');

  try {
    // Health check
    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        mode: 'server',
        name: '沒人在乎牆軟體 (No1Care)',
        wallCount: wallsStore.size,
        onlineClients: sseClients.size,
      });
    }

    // Real-time SSE endpoint
    if (req.method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ onlineClients: sseClients.size + 1 })}\n\n`);
      sseClients.add(res);
      broadcastEvent('presence', { onlineClients: sseClients.size });

      req.on('close', () => {
        sseClients.delete(res);
        broadcastEvent('presence', { onlineClients: sseClients.size });
      });
      return;
    }

    // List all walls
    if (req.method === 'GET' && pathname === '/api/walls') {
      const walls = Array.from(wallsStore.values()).sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );
      return sendJson(res, 200, { walls });
    }

    // Single wall CRUD
    const wallMatch = pathname.match(/^\/api\/walls\/([^/]+)$/);
    if (wallMatch) {
      const wallId = wallMatch[1];

      if (req.method === 'GET') {
        const wall = wallsStore.get(wallId);
        if (!wall) return sendJson(res, 404, { error: 'Wall not found' });
        return sendJson(res, 200, { wall });
      }

      if (req.method === 'PUT') {
        const body = await readJsonBody(req);
        if (!body || typeof body !== 'object') {
          return sendJson(res, 400, { error: 'Invalid wall payload' });
        }
        const wall = {
          ...body,
          id: wallId,
          updatedAt: body.updatedAt || Date.now(),
        };
        wallsStore.set(wallId, wall);
        scheduleSave();
        broadcastEvent('wall_updated', { wall }, clientId);
        return sendJson(res, 200, { ok: true, wall });
      }

      if (req.method === 'DELETE') {
        const existed = wallsStore.delete(wallId);
        if (existed) {
          scheduleSave();
          broadcastEvent('wall_deleted', { wallId }, clientId);
        }
        return sendJson(res, 200, { ok: true, deleted: existed });
      }
    }

    // Bulk import walls
    if (req.method === 'POST' && pathname === '/api/import') {
      const body = await readJsonBody(req);
      const list = Array.isArray(body.walls) ? body.walls : [];
      let count = 0;
      for (const wall of list) {
        if (wall && wall.id) {
          wallsStore.set(wall.id, wall);
          count += 1;
        }
      }
      scheduleSave();
      broadcastEvent('sync_all', { count }, clientId);
      return sendJson(res, 200, { ok: true, imported: count });
    }

    // Static assets
    if (req.method === 'GET' || req.method === 'HEAD') {
      return serveStatic(req, res, pathname);
    }

    sendJson(res, 405, { error: 'Method Not Allowed' });
  } catch (err) {
    const code = err.statusCode || 500;
    sendJson(res, code, { error: err.message || 'Internal Server Error' });
  }
});

// Keep-alive heartbeat for SSE clients
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}, 25000).unref();

server.listen(PORT, HOST, () => {
  console.log(`\n🧱 沒人在乎牆軟體 (No1Care Wall) 已啟動！`);
  console.log(`   網址：http://localhost:${PORT}`);
  console.log(`   已載入牆面數：${wallsStore.size} (無上限 ∞)\n`);
});
