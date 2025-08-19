export const config = { runtime: 'edge' };

// Hem Vercel KV hem Upstash Redis için isim uyumluluğu:
const API_URL =
  process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const API_TOKEN =
  process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisPipeline(cmds) {
  const r = await fetch(`${API_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(cmds)
  });
  if (!r.ok) throw new Error(`KV error: ${r.status}`);
  return r.json();
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const { handle, matched, timeMs } = await req.json();

    if (!handle || typeof matched !== 'number' || typeof timeMs !== 'number') {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400 });
    }

    const h = handle.toLowerCase().replace(/^@/, '').trim();
    const m = Math.max(0, Math.min(8, Math.floor(matched)));
    const t = Math.max(0, Math.min(3_600_000, Math.floor(timeMs))); // güvenli sınır (<= 1 saat)
    const composite = m * 1_000_000_000 - t; // önce eşleşme, eşitse daha hızlı ↑

    // Mevcut skor?
    const zres = await redisPipeline([['ZSCORE', 'smm:board', h]]);
    const current = zres?.[0]?.result;
    const currentNum = current == null ? null : Number(current);

    let updated = false;
    if (currentNum == null || composite > currentNum) {
      await redisPipeline([
        ['ZADD', 'smm:board', composite.toString(), h],
        ['HSET', `smm:detail:${h}`, 'matched', m.toString(), 'timeMs', t.toString(), 'updatedAt', Date.now().toString()]
      ]);
      updated = true;
    }

    return new Response(JSON.stringify({ updated }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
