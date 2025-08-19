// Node.js Serverless Function
module.exports.config = { runtime: 'nodejs' };

const Redis = require('ioredis');

let client;
function getRedis() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');

  let opts = {};
  try {
    const u = new URL(url);
    if (u.protocol === 'rediss:') opts.tls = {}; // TLS
  } catch (_) {}
  client = new Redis(url, opts);
  return client;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.statusCode = 405; res.end('Method Not Allowed'); return;
  }

  try {
    const r = getRedis();

    // En iyi 50 (yüksekten düşüğe)
    const handles = await r.zrevrange('smm:board', 0, 49);

    if (!handles?.length) {
      res.statusCode = 200; res.setHeader('content-type','application/json');
      res.end(JSON.stringify({ items: [] })); return;
    }

    // Pipeline ile detayları çek
    const pipe = r.pipeline();
    for (const h of handles) {
      pipe.hmget(`smm:detail:${h}`, 'matched', 'timeMs', 'updatedAt');
    }
    const results = await pipe.exec();

    const items = handles.map((h, i) => {
      const arr = results[i]?.[1] || [];
      return {
        handle: h,
        matched: parseInt(arr?.[0] ?? '0', 10),
        timeMs: parseInt(arr?.[1] ?? '0', 10),
        updatedAt: parseInt(arr?.[2] ?? '0', 10)
      };
    });

    res.statusCode = 200; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ items }));
  } catch (e) {
    res.statusCode = 500; res.setHeader('content-type','application/json');
    res.end(JSON.stringify({ error: String(e) }));
  }
};
