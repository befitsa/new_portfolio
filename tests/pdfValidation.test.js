import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidPdfDocument as isClientPdf } from '../src/lib/db/pdfValidation.js'
import { isValidPdfDocument as isServerPdf } from '../functions/pdfValidation.js'

function minimalPdf() {
  let text = '%PDF-1.4\n'
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    '4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n',
  ]
  const offsets = [0]
  for (const object of objects) {
    offsets.push(Buffer.byteLength(text, 'latin1'))
    text += object
  }
  const xrefOffset = Buffer.byteLength(text, 'latin1')
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(text, 'latin1')
}

test('resume validation checks PDF structure in the browser and backend', () => {
  const valid = minimalPdf()
  const fake = Buffer.from('%PDF-1.7\nThis is not a structurally valid PDF')
  assert.equal(isClientPdf(new Uint8Array(valid)), true)
  assert.equal(isServerPdf(valid), true)
  assert.equal(isClientPdf(new Uint8Array(fake)), false)
  assert.equal(isServerPdf(fake), false)
})
