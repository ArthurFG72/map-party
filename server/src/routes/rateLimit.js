export function createIpRateLimit({ windowMs = 60_000, max = 30, now = () => Date.now() } = {}) {
  const buckets = new Map();
  let requestCount = 0;
  return (req, res, next) => {
    const timestamp = now();
    const cutoff = timestamp - windowMs;
    requestCount += 1;
    if (requestCount % 256 === 0) {
      for (const [bucketKey, stamps] of buckets) {
        const active = stamps.filter((stamp) => stamp > cutoff);
        if (active.length) buckets.set(bucketKey, active);
        else buckets.delete(bucketKey);
      }
    }
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const hits = (buckets.get(key) || []).filter((stamp) => stamp > cutoff);
    if (hits.length >= max) {
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Muitas requisições. Tente novamente em instantes.' } });
    }
    hits.push(timestamp);
    buckets.set(key, hits);
    return next();
  };
}
