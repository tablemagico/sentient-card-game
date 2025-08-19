export const config = { runtime: 'edge' };

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
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    // En iyi ilk 50
    const r1 = await redisPipeline([['ZREVRANGE', 'smm:board', '0', '49']]);
    const handles = r1?.[0]?.result || [];

    if (!handles.length) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200, headers: { 'content-type': 'application/json' }
      });
    }

    const cmds = handles.map(h => ['HMGET', `smm:detail:${h}`, 'matched', 'timeMs', 'updatedAt']);
    const r2 = await redisPipeline(cmds);

    const items = handles.map((h, i) => {
      const arr = r2[i]?.result || [];
      return {
        handle: h,
        matched: parseInt(arr?.[0] ?? '0', 10),
        timeMs: parseInt(arr?.[1] ?? '0', 10),
        updatedAt: parseInt(arr?.[2] ?? '0', 10)
      };
    });

    return new Response(JSON.stringify({ items }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
}
