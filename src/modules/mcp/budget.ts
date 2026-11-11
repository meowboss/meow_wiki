export class McpBudget {
  private buckets = new Map<string, { start: number; count: number; active: number }>();
  constructor(private clock = Date.now) {}
  enter(id: string) {
    const now = this.clock();
    for (const [key, bucket] of this.buckets)
      if (!bucket.active && now - bucket.start > 60000) this.buckets.delete(key);
    const bucket = this.buckets.get(id) ?? { start: now, count: 0, active: 0 };
    if (now - bucket.start >= 60000 && !bucket.active) {
      bucket.start = now;
      bucket.count = 0;
    }
    if (
      bucket.count >= 60 ||
      bucket.active >= 2 ||
      (!this.buckets.has(id) && this.buckets.size >= 1000)
    )
      return null;
    bucket.count++;
    bucket.active++;
    this.buckets.set(id, bucket);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        bucket.active--;
      }
    };
  }
}
export async function boundedMcpText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 512000) throw Object.assign(new Error('MCP响应超过预算'), { statusCode: 413 });
      chunks.push(item.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}
