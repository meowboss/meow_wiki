import { z } from 'zod';
import {
  createDefaultComposition,
  surfaceSchema,
} from '../../../packages/canvas-contract/index.ts';
import {
  PAGE_FILE,
  PAGE_SCHEMA_FILE,
  pageProjectFileSchema,
  parsePageProjectContent,
  validatePageProjectContent,
  PAGE_SDK_INSTRUCTIONS,
} from '../../../packages/workshop-contract/index.ts';
import { componentSchema } from '../../components.ts';
import {
  WorkshopError,
  type WorkshopValidation,
  type WorkshopProject,
  type WorkshopState,
} from './projects.ts';
import type { CanvasSurface } from '../../../packages/canvas-contract/index.ts';

export { PAGE_FILE };
export const componentPath = '/project/component.json';
export const projectInput = z.strictObject({
  name: z.string().trim().min(1).max(160),
  instruction: z.string().min(1).max(3000),
});
export const pageInput = projectInput.extend({ surface: surfaceSchema, fromCurrent: z.boolean() });
export const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const componentSdk = {
  '/sdk/README.md': `# Declarative component SDK
This is a database-backed virtual filesystem, not an OS filesystem or code sandbox.
Only /sdk/README.md, /sdk/component.schema.json and /project/component.json can be read.
Only /project/component.json can be written (at most 30000 characters).
All paths must match exactly. No directories, aliases, traversal, shell, npm, host files,
network access or executable code are supported. Never put provider keys or secrets in files.

Write a JSON object matching /sdk/component.schema.json:
- name: nonempty string, at most 160 characters.
- description: string, at most 500 characters.
- template: inert plain text/Markdown string, at most 10000 characters.
- blocks: optional array of at most 20 blocks. Each block is exactly one of:
  {"type":"markdown","text":"Markdown text (at most 10000 characters)"}
  {"type":"page-list","title":"Title (at most 160 characters)"}
  {"type":"search","title":"Title (at most 160 characters)"}
The markdown block uses text, not title. page-list and search use title, not text.
Unknown fields, scripts, imports and custom executable blocks are rejected.
Validate the JSON before importing it. Import creates a new private component in the
project's workspace, never overwrites an existing component and never publishes to market.
`,
  '/sdk/component.schema.json': JSON.stringify(z.toJSONSchema(componentSchema), null, 2),
};
const pageSdk = {
  '/sdk/README.md': PAGE_SDK_INSTRUCTIONS,
  [PAGE_SCHEMA_FILE]: JSON.stringify(z.toJSONSchema(pageProjectFileSchema), null, 2),
};
export const declarationFiles = (content: string, page: boolean): Record<string, string> =>
  page ? { ...pageSdk, [PAGE_FILE]: content } : { ...componentSdk, [componentPath]: content };
export function projectFromRow(row: Record<string, unknown>): WorkshopProject {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    instruction: String(row.instruction),
    files: declarationFiles(String(row.content), row.kind === 'page'),
    ...(row.kind === 'page'
      ? {
          kind: 'page' as const,
          sourceSurface: row.source_surface as CanvasSurface,
          sourceRevision: Number(row.source_revision),
          revision: Number(row.revision),
        }
      : {}),
    state: row.state as WorkshopState,
    error: row.error === null ? null : String(row.error),
    iterations: Number(row.iterations),
  };
}
export function parsePage(content: string) {
  const result = parsePageProjectContent(content);
  if (!result.success) throw new WorkshopError('Invalid page declaration', 400);
  return result.data;
}
export function validation(content: string, page = false): WorkshopValidation {
  if (page) return validatePageProjectContent(content);
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { valid: false, issues: [`Invalid JSON ${page ? 'page' : 'component'} declaration`] };
  }
  const result = componentSchema.safeParse(value);
  if (result.success) return { valid: true };
  return {
    valid: false,
    issues: result.error.issues
      .slice(0, 8)
      .map((issue) =>
        `${issue.path.map(String).join('.') || 'component'}: ${issue.code}`.slice(0, 160),
      ),
  };
}
export function pageContent(
  name: string,
  current: ReturnType<typeof createDefaultComposition>,
  fromCurrent: boolean,
) {
  const { revision: _, ...base } = fromCurrent
    ? current
    : createDefaultComposition(current.surface);
  const composition = fromCurrent ? base : { ...base, instances: [] };
  const content = JSON.stringify({ format: 'meow.page', version: 1, name, composition }, null, 2);
  if (content.length > 30000)
    throw new WorkshopError('Page declaration exceeds 30000 characters', 400);
  return content;
}
