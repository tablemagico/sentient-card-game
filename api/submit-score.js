// Node.js Serverless Function
module.exports.config = { runtime: 'nodejs' };

const Redis = require('ioredis');

let client;
function getRedis() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  let opts = {};
  try { const u = new URL(url); if (u.protocol === 'rediss:') opts.tls = {}; } catch (_) {}
  client = new Redis(url, opts);
  return client;
}

// Skor: önce matched (büyük olan ↑), eşitse daha hızlı (time küçük olan ↑)
const composite = (matched, timeMs) => matched * 1_000_000_000 - timeMs;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return; }

  try {
    const body = await readJson(req);
    const { handle, matched, timeMs } = body;

    if (!handle || typeof matched !== 'number' || typeof timeMs !== 'number') {
      res.statusCode = 400; res.setHeader('content-type','application/json');
      res.end(JSON.stringify({ error: 'Invalid payload' })); return;
    }

    const h = String(handle).toLowerCase().replace(/^@/, '').trim();
    const m = Math.max(0, Math.min(8, Math.floor(matched)));
    const t = Math.max(0, Math.min(3_600_000, Math.floor(timeMs))); // <=1 saat güvenlik

    const r = getRedis();
    const cur = await r.zscore('smm:board', h);
    const curNum = cur == null ? null : Number(cur);
    const nextScore = composite(m, t);

    let updated = false;
    if (curNum == null || nextScore > curNum) {
      const multi = r.multi();
      multi.zadd('smm:board', nextScore, h);
      multi.hset(`smm:detail:${h}`,
        'matched', String(m),
        'timeMs', String(t),
        'updatedAt', String(Date.now())
      );
      await multi.exec();
      updated = true;
    }

    res.statusCode = 200; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ updated }));
  } catch (e) {
    res.statusCode = 500; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ error: String(e) }));
  }
};
