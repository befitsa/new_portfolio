const tailLength = 2048

export function isValidPdfDocument(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value || [])
  if (bytes.length < 100) return false
  const text = bytes.toString('latin1')
  if (!/^%PDF-\d\.\d/.test(text)) return false
  if (!/\b\d+\s+\d+\s+obj\b/.test(text) || !/\bendobj\b/.test(text)) return false
  const tail = text.slice(Math.max(0, text.length - tailLength))
  if (!/%%EOF\s*$/.test(tail)) return false
  const startXref = [...tail.matchAll(/startxref\s+(\d+)/g)].at(-1)
  if (!startXref) return false
  const offset = Number(startXref[1])
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= text.length) return false
  const crossReference = text.slice(offset, offset + 256)
  return /^xref(?:\s|$)/.test(crossReference) || (/\bobj\b/.test(crossReference) && /\/Type\s*\/XRef\b/.test(crossReference))
}
