export const config = { runtime: "edge" };

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const NS = process.env.LAMUMU_NS || "lamumu:run";
const RANK_KEY = `${NS}:rank`;

function normalizeHandle(h) {
  const s = String(h || "guest").trim().replace(/^@/, "").toLowerCase();
  const safe = s.replace(/[^a-z0-9_.-]/g, "");
  return safe.slice(0, 32) || "guest";
}

function makeRankScore(score, timeMs) {
  const S = Number(score) | 0;
  const T = Math.max(0, Number(timeMs) | 0);
  return S * 1_000_000_000 - T; // büyük daha iyi → ZREVRANGE ile okunacak
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const handle = normalizeHandle(body.handle);
  const score = Number(body.score) | 0;
  const timeMs = Math.max(0, Number(body.timeMs) | 0);
  if (!Number.isFinite(score) || score < 0) return json({ error: "invalid score" }, 400);
  if (!Number.isFinite(timeMs)) return json({ error: "invalid timeMs" }, 400);

  const userKey = `${NS}:user:${handle}`;

  // Mevcut değerleri al
  const [prevScore, prevTime] = await redis.hmget(userKey, "score", "timeMs");
  const pS = prevScore != null ? Number(prevScore) : null;
  const pT = prevTime != null ? Number(prevTime) : null;

  // Yalnızca iyileşme varsa güncelle
  const improved =
    pS == null ||
    score > pS ||
    (score === pS && (pT == null || timeMs < pT));

  if (!improved) {
    return json({ ok: true, improved: false, handle, score: pS ?? 0, timeMs: pT ?? 0 });
  }

  const now = Date.now();
  const rankScore = makeRankScore(score, timeMs);

  await Promise.all([
    redis.hset(userKey, { score, timeMs, updatedAt: now }),
    redis.zadd(RANK_KEY, { score: rankScore, member: handle }),
  ]);

  return json({ ok: true, improved: true, handle, score, timeMs });
}
