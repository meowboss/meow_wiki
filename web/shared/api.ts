export interface WikiPage {
  id: string;
  title: string;
  markdown: string;
  updatedAt: string;
  revision: number;
  deletedAt: string | null;
  parentId: string | null;
}
export interface PageRevision extends WikiPage {
  actorId: string;
  operation: string;
}
export interface WikiPlugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  kind: string;
}
export type ComponentBlock =
  | { type: 'markdown'; text: string }
  | { type: 'page-list'; title: string }
  | { type: 'search'; title: string };
export interface WikiComponent {
  id: string;
  name: string;
  description: string;
  template: string;
  status: string;
  authorId: string;
  version: number;
  blocks?: ComponentBlock[];
  reason?: string | null;
  latestRelease?: { version: number; status: string } | null;
}
export interface InstalledComponent {
  workspaceId: string;
  releaseId: string;
  release: WikiComponent;
}
export type HomeBlock =
  { componentId: string; releaseId?: never } | { releaseId: string; componentId?: never };
export interface HomeData {
  layout: { title: string; blocks: HomeBlock[] } | null;
  components: (WikiComponent | null)[];
  revision: number;
}
export interface WorkspaceData {
  workspace: { id: string; name: string; description: string };
  pages: WikiPage[];
  trash: WikiPage[];
  plugins: WikiPlugin[];
  components: WikiComponent[];
  marketplace: WikiComponent[];
  installed: InstalledComponent[];
}
export interface SearchResult {
  id: string;
  title: string;
  excerpt: string;
}
export interface Answer {
  mode: 'local-extractive';
  answer: string;
  sources: SearchResult[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface SessionUser {
  id: string;
  username: string;
  role: string;
}
export interface SessionInfo {
  mode: 'session' | 'local' | 'token';
  user: SessionUser | null;
  csrfToken: string;
}
export interface Workspace {
  id: string;
  name: string;
  description: string;
}
let csrfToken = '';
let workspaceId = '';
export function setSessionCsrf(token: string) {
  csrfToken = token;
}
export function setActiveWorkspace(id: string) {
  workspaceId = id;
}

export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const requestMethod = (method ?? (body === undefined ? 'GET' : 'POST')).toUpperCase();
  const auth = /^\/auth(?:\/|\?|$)/.test(path);
  const workspaceManagement = /^\/workspaces(?:\/|\?|$)/.test(path);
  const url = new URL(`/api${path}`, window.location.origin);
  if (workspaceId && !auth && !workspaceManagement)
    url.searchParams.set('workspaceId', workspaceId);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!auth && !['GET', 'HEAD', 'OPTIONS'].includes(requestMethod) && csrfToken)
    headers['X-CSRF-Token'] = csrfToken;
  const response = await fetch(url.pathname + url.search, {
    method: requestMethod,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const payload = data as { error?: string | { message?: string }; message?: string } | undefined;
    const detail =
      typeof payload?.error === 'string'
        ? payload.error
        : payload?.error?.message || payload?.message;
    throw new ApiError(
      detail ||
        `请求失败（HTTP ${response.status}）${response.status >= 500 ? '，请检查后端服务' : ''}`,
      response.status,
    );
  }
  if (text && data === undefined) throw new Error('服务返回了无效的数据格式，请检查后端接口。');
  return data as T;
}
