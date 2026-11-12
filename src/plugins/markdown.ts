import { Marked, Renderer } from 'marked';
import sanitizeHtml from 'sanitize-html';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
for (const [name, language] of Object.entries({
  javascript,
  typescript,
  python,
  json,
  bash,
  css,
  xml,
  sql,
}))
  hljs.registerLanguage(name, language);
const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
const aliases: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  html: 'xml',
};

/** Fresh parser/slug scope per document; no global marked mutations or executable embeds. */
export async function renderMarkdown(markdown: string): Promise<string> {
  const renderer = new Renderer();
  const slugs = new Map<string, number>();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const plain = sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });
    const base =
      plain
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_ -]/gu, '')
        .trim()
        .replace(/\s+/g, '-') || 'section';
    const count = (slugs.get(base) ?? 0) + 1;
    slugs.set(base, count);
    const id = `wiki-${base}${count > 1 ? `-${count}` : ''}`;
    return `<h${depth} id="${escape(id)}">${text}<a class="heading-anchor" href="#${escape(id)}" aria-hidden="true" tabindex="-1">#</a></h${depth}>\n`;
  };
  renderer.code = ({ text, lang }) => {
    const token = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();
    const language = aliases[token] ?? token;
    const supported = !!hljs.getLanguage(language);
    // Limit syntax processing per fence; large/unknown code remains escaped readable text.
    const highlighted =
      supported && text.length <= 20000
        ? hljs.highlight(text, { language, ignoreIllegals: true }).value
        : escape(text);
    const label = supported ? language : 'text';
    return `<pre class="code-block" data-language="${label}"><code class="hljs language-${label}">${highlighted}</code></pre>\n`;
  };
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const normalized = href.trim();
    if (
      /^(javascript|vbscript|data):/i.test(normalized) ||
      normalized.startsWith('//') ||
      normalized.startsWith('\\')
    )
      return label;
    const anchor = normalized.startsWith('#')
      ? `#${normalized.slice(1).startsWith('wiki-') ? normalized.slice(1) : 'wiki-' + normalized.slice(1)}`
      : normalized;
    const external = /^https?:\/\//i.test(anchor);
    return `<a href="${escape(anchor)}"${title ? ` title="${escape(title)}"` : ''}${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  };
  renderer.image = ({ text }) =>
    `<span class="image-placeholder">[图片未加载${text ? `：${escape(text)}` : ''}：暂不允许远程追踪请求]</span>`;
  renderer.html = ({ text }) =>
    sanitizeHtml(text, {
      allowedTags: sanitizeHtml.defaults.allowedTags,
      allowedAttributes: sanitizeHtml.defaults.allowedAttributes,
    });
  const parser = new Marked({ renderer, gfm: true, breaks: false });
  const html = await parser.parse(markdown);
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['del', 'input']),
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel', 'class', 'aria-label', 'aria-hidden', 'tabindex'],
      h1: ['id'],
      h2: ['id'],
      h3: ['id'],
      h4: ['id'],
      h5: ['id'],
      h6: ['id'],
      pre: ['class', 'data-language'],
      code: ['class'],
      span: ['class'],
      input: ['type', 'disabled', 'checked'],
      th: ['align'],
      td: ['align'],
    },
    allowedClasses: {
      a: ['heading-anchor'],
      pre: ['code-block'],
      code: ['hljs', 'language-*'],
      span: ['hljs-*', 'image-placeholder'],
    },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
    transformTags: {
      input: (_tag, attrs) => ({
        tagName: 'input',
        attribs: {
          type: 'checkbox',
          disabled: 'disabled',
          ...(attrs.checked !== undefined ? { checked: 'checked' } : {}),
        },
      }),
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: {
          ...attrs,
          ...(/^https?:\/\//i.test(attrs.href ?? '')
            ? { target: '_blank', rel: 'noopener noreferrer' }
            : { target: '', rel: '' }),
        },
      }),
    },
    // Only renderer-generated namespaced headings can define IDs; raw HTML cannot clobber host IDs.
    exclusiveFilter: (frame) => frame.tag === 'img',
  });
}
