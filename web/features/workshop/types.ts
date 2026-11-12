export const FILE = '/project/component.json' as const;
export const PAGE_FILE = '/project/page.json' as const;
export type PageSurface = 'home' | 'wiki' | 'collaboration';
export function projectFile(project: Pick<Project, 'kind'> | null): string {
  return project?.kind === 'page' ? PAGE_FILE : FILE;
}
export type { Endpoint, Config, ProviderVendor, Provider } from '../../shared/providers/types';
export { providerMetadata } from '../../shared/providers/types';
export type Project = {
  id: string;
  name: string;
  instruction: string;
  state: string;
  iterations: number;
  error?: string | null;
  files: Record<string, string>;
  kind?: 'component' | 'page';
  sourceSurface?: PageSurface;
  sourceRevision?: number;
  revision?: number;
  workspaceId: string;
  turnId?: string;
};
export type WorkshopMessageDetails = {
  path?: string;
  bytes?: number;
  lines?: number;
  valid?: boolean;
  issues?: string[];
  durationMs?: number;
  summary?: string;
};
export type WorkshopMessage = {
  id: string;
  projectId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  status?: string;
  createdAt: string;
  sequence: number;
  runId?: string;
  callId?: string;
  turn?: number;
  turnId?: string;
  details?: WorkshopMessageDetails;
};
export type Validation = { valid: boolean; issues?: unknown[] };
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请重试。';
