import MarkdownIt from 'markdown-it'

/**
 * Markdown → HTML for posts and pages (plan §22.6).
 *
 * The safety of every public content page rests on three settings here, so
 * they are spelled out rather than left to defaults:
 *
 * - `html: false` — raw HTML in the source is escaped, not passed through.
 *   There is no "trusted HTML" field anywhere in the module, so there is
 *   nothing to sanitise *around*; there is only Markdown.
 * - `validateLink` — links and images may point at http(s), mailto, or a
 *   relative path, and nothing else. `javascript:`, `data:` and `vbscript:`
 *   URLs are dropped and render as plain text.
 * - Rendered on read, never stored. A fix here reaches every post at once,
 *   and there is no cached HTML that predates it.
 */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

/**
 * A URL with no scheme is relative and stays on this site. One with a scheme
 * must be on the list. markdown-it decodes entities and normalises the URL
 * before asking, so `javascript&#58;` and friends arrive here already spelled
 * as the scheme they are.
 */
export function isSafeLink(url: string): boolean {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())

  return !scheme || SAFE_SCHEMES.has(scheme[1].toLowerCase())
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
})

markdown.validateLink = isSafeLink

/**
 * External links open as themselves but cannot reach back into this page
 * through `window.opener`, and pass no referrer to whoever we link to.
 */
const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options))

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const href = tokens[index].attrGet('href') ?? ''

  if (/^https?:/i.test(href)) {
    tokens[index].attrSet('rel', 'noopener noreferrer')
  }

  return defaultLinkOpen(tokens, index, options, env, self)
}

export function renderMarkdown(source: string): string {
  return markdown.render(source ?? '')
}

/**
 * The first `length` characters of the rendered text, for a meta description
 * when an entry has no excerpt. Tags are stripped from the *rendered* output,
 * so Markdown syntax never leaks into a search result.
 */
export function plainText(source: string, length = 160): string {
  /**
   * Block boundaries become spaces so paragraphs do not run together; inline
   * tags vanish so "a [link](/x)." does not become "a link ."
   */
  const text = renderMarkdown(source)
    .replace(/<\/(p|h[1-6]|li|blockquote|pre|tr|td|th)>|<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text
}
