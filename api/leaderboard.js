export const config = { runtime: "edge" };

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const NS = process.env.LAMUMU_NS || "lamumu:run";
const RANK_KEY = `${NS}:rank`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async function handler(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const { searchParams } = new URL(req.url);
  const start = Math.max(0, Number(searchParams.get("start") ?? 0) | 0);
  const count = Math.min(200, Math.max(1, Number(searchParams.get("count") ?? 50) | 0));
  const rankFor = (searchParams.get("rankFor") || "").trim().toLowerCase();

  const total = await redis.zcard(RANK_KEY);

  // Büyükten küçüğe (en iyi üstte)
  const stop = start + count - 1;
  const members = await redis.zrevrange(RANK_KEY, start, stop); // ["handle1", "handle2", ...]

  let items = [];
  if (members.length) {
    const rows = await Promise.all(
      members.map((m) => redis.hmget(`${NS}:user:${m}`, "score", "timeMs"))
    );
    items = rows.map(([score, timeMs], i) => ({
      handle: members[i],
      score: Number(score ?? 0),
      timeMs: Number(timeMs ?? 0),
    }));
  }

  let rank = null;
  if (rankFor) {
    const r = await redis.zrevrank(RANK_KEY, rankFor);
    rank = (r === null || r === undefined) ? null : (Number(r) + 1); // 1-based
  }

  return json({ items, total, rank });
}
