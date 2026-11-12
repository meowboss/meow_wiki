import { z } from 'zod';
import { compositionDocumentSchema } from '../canvas-contract/index';

/** Browser-safe declarations only; no host filesystem, execution, or application authority. */
export const PAGE_FILE = '/project/page.json';
export const PAGE_SCHEMA_FILE = '/sdk/page.schema.json';

export const pageProjectFileSchema = z.strictObject({
  format: z.literal('meow.page'),
  version: z.literal(1),
  name: z.string().min(1).max(160),
  composition: compositionDocumentSchema,
});
export type PageProjectFile = z.infer<typeof pageProjectFileSchema>;

export const PAGE_SDK_INSTRUCTIONS = `# Declarative page SDK
This is a database-backed virtual filesystem, not an OS filesystem or a code sandbox.
Edit only ${PAGE_FILE}; read the schema resource ${PAGE_SCHEMA_FILE} before writing.
Paths are exact: no aliases, traversal, directories, shell, npm, imports, network, or host files.
The JSON file is at most 30000 characters and 120000 UTF-8 bytes.
Never include provider keys, credentials, tokens, or other secrets in files or metadata.

The strict root is {"format":"meow.page","version":1,"name":"Page name","composition":{...}}.
name is metadata (1–160 characters), not a route, navigation entry, workspace identity, or authority.
This stage edits an existing surface only: home, wiki, or collaboration. It does not create a
new navigation page. Workspace scope and the expected revision belong to the host, not the file.
Do not include revision, expectedRevision, owner, workspaceId, scripts, HTML, CSS, or code fields.
composition uses schemaVersion 2, columns 12, layout grid/flow/free, bounded instances,
validated style/config fields, and optional bounded layout tree. Every tree leaf must reference
one existing instance exactly once; tree limits are depth 6, 80 nodes, 40 children per node.
Only actual registered views are available:
- home.header, home.controls, home.content
- wiki.header, wiki.stats, wiki.directory, wiki.toolbar, wiki.document, wiki.ask, wiki.footer
- collaboration.header, collaboration.directory, collaboration.detail, collaboration.content
- builtin.text, builtin.search, builtin.directory, builtin.image, builtin.video, builtin.pet
- component.render (references an existing component/release, not executable source)
- trusted package view IDs admitted by the schema (references, not arbitrary code or imports).
Legacy business views are singletons. Independent builtin.text instances may repeat.
The schema resource describes structural fields; validation additionally checks instance IDs,
grid bounds, singleton views, and complete bounded tree coverage.
Validate the JSON declaration before preview. Validation and preview do not save or apply it.
There is no apply tool. Only a separate explicit host-controlled, owner-scoped action may apply
an existing-surface edit with revision checking. Never claim a file write published or applied it.
`;

export type PageProjectContentResult =
  { success: true; data: PageProjectFile } | { success: false; issues: string[] };
export type PageProjectValidation = { valid: true } | { valid: false; issues: string[] };

// Never copy Zod messages or paths: strict-object errors and tree messages can contain raw keys
// or attacker-chosen identifiers. These fixed labels/codes are safe even for malformed input.
function sanitizedIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  const labels = new Set(['format', 'version', 'name', 'composition']);
  return issues.slice(0, 8).map((issue) => {
    const field = issue.path[0];
    const label = typeof field === 'string' && labels.has(field) ? field : 'page';
    return `${label}: ${issue.code}`.slice(0, 160);
  });
}

/** Parse inert JSON first, then validate the existing bounded composition contract. Never eval. */
export function parsePageProjectContent(content: unknown): PageProjectContentResult {
  if (
    typeof content !== 'string' ||
    content.length > 30000 ||
    new TextEncoder().encode(content).byteLength > 120000
  ) {
    return {
      success: false,
      issues: ['page: content must be at most 30000 characters and 120000 UTF-8 bytes'],
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { success: false, issues: ['page: invalid JSON declaration'] };
  }
  try {
    const parsed = pageProjectFileSchema.safeParse(value);
    return parsed.success
      ? { success: true, data: parsed.data }
      : { success: false, issues: sanitizedIssues(parsed.error.issues) };
  } catch {
    return { success: false, issues: ['page: invalid declaration'] };
  }
}

/** Validation reports contain bounded sanitized diagnostics, never declaration content. */
export function validatePageProjectContent(content: unknown): PageProjectValidation {
  const result = parsePageProjectContent(content);
  return result.success ? { valid: true } : { valid: false, issues: result.issues };
}
