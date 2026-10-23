import { Fragment } from 'react'

const inlineToken = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g

function renderInline(value, keyPrefix) {
  return value.split(inlineToken).filter(Boolean).map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={key}>{part.slice(1, -1)}</em>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      let url
      try { url = new URL(link[2]) } catch { return link[1] }
      if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) return link[1]
      return <a key={key} href={url.toString()} target={url.protocol === 'mailto:' ? undefined : '_blank'} rel={url.protocol === 'mailto:' ? undefined : 'noreferrer'}>{link[1]}</a>
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

function renderBlock(block, index) {
  const codeBlock = /^```(?:[\w+-]+)?\n([\s\S]*?)\n```$/.exec(block)
  if (codeBlock) return <pre key={index}><code>{codeBlock[1]}</code></pre>

  const heading = /^(#{1,3})\s+(.+)$/.exec(block)
  if (heading) {
    const Tag = `h${heading[1].length}`
    return <Tag key={index}>{renderInline(heading[2], `heading-${index}`)}</Tag>
  }

  const lines = block.split('\n')
  if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
    return <ul key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line.replace(/^\s*[-*+]\s+/, ''), `ul-${index}-${lineIndex}`)}</li>)}</ul>
  }
  if (lines.every((line) => /^\s*\d+\.\s+/.test(line))) {
    return <ol key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line.replace(/^\s*\d+\.\s+/, ''), `ol-${index}-${lineIndex}`)}</li>)}</ol>
  }
  if (lines.every((line) => /^\s*>\s?/.test(line))) {
    return <blockquote key={index}>{renderInline(lines.map((line) => line.replace(/^\s*>\s?/, '')).join(' '), `quote-${index}`)}</blockquote>
  }
  return <p key={index}>{lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{renderInline(line, `p-${index}-${lineIndex}`)}</Fragment>)}</p>
}

export default function MarkdownContent({ source = '', className = '' }) {
  const blocks = String(source).trim().split(/\n\s*\n/).filter(Boolean)
  return <div className={`markdown-content ${className}`.trim()}>{blocks.map(renderBlock)}</div>
}
