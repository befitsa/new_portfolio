const tailLength = 2048

/** A small structural check that rejects renamed text files and signature-only fakes. */
export function isValidPdfDocument(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0)
  if (bytes.length < 100) return false
  const text = new TextDecoder('latin1').decode(bytes)
  if (!/^%PDF-\d\.\d/.test(text)) return false
  if (!/\b\d+\s+\d+\s+obj\b/.test(text) || !/\bendobj\b/.test(text)) return false
  const tailStart = Math.max(0, text.length - tailLength)
  const tail = text.slice(tailStart)
  if (!/%%EOF\s*$/.test(tail)) return false
  const startXref = [...tail.matchAll(/startxref\s+(\d+)/g)].at(-1)
  if (!startXref) return false
  const offset = Number(startXref[1])
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= text.length) return false
  const crossReference = text.slice(offset, offset + 256)
  return /^xref(?:\s|$)/.test(crossReference) || (/\bobj\b/.test(crossReference) && /\/Type\s*\/XRef\b/.test(crossReference))
}
