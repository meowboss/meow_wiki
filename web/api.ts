export interface WikiPage { id: string; title: string; markdown: string; updatedAt: string }
export interface WikiPlugin { id: string; name: string; description: string; enabled: boolean; kind: string }
export interface WikiComponent { id: string; name: string; description: string; template: string; status: string; authorId: string }
export interface WorkspaceData {
  workspace: { id: string; name: string; description: string };
  pages: WikiPage[];
  plugins: WikiPlugin[];
  components: WikiComponent[];
  marketplace: WikiComponent[];
}
export interface SearchResult { id: string; title: string; excerpt: string }
export interface Answer { mode: 'local-extractive'; answer: string; sources: SearchResult[] }

export async function api<T>(path: string, body?: unknown, method = 'POST', signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
  if (!response.ok) {
    const payload = data as { error?: string | { message?: string }; message?: string } | undefined;
    const detail = typeof payload?.error === 'string' ? payload.error : payload?.error?.message || payload?.message;
    throw new Error(detail || `请求失败（HTTP ${response.status}）${response.status >= 500 ? '，请检查后端服务' : ''}`);
  }
  if (text && data === undefined) throw new Error('服务返回了无效的数据格式，请检查后端接口。');
  return data as T;
}
