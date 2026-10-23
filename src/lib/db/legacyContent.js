const oldProjectIds = new Set(Array.from({ length: 12 }, (_, index) => `project-${String(index + 1).padStart(2, '0')}`))
const oldEducationIds = new Set(['edu-hawassa', 'edu-udacity', 'edu-hackerrank'])
const oldEducationTitles = new Set([
  'computer science (bsc)|hawassa university',
  'fundamental programming|udacity',
  'frontend developer (react)|hackerrank',
])

export function isLegacySeedRecord(type, record) {
  if (type === 'projects') return oldProjectIds.has(String(record?.id || '').toLowerCase())
  if (type !== 'education') return false
  if (oldEducationIds.has(String(record?.id || '').toLowerCase())) return true
  const title = String(record?.degree || record?.title || '').trim().toLowerCase()
  const institution = String(record?.institution || record?.place || '').split(/[·|]/, 1)[0].trim().toLowerCase()
  return oldEducationTitles.has(`${title}|${institution}`)
}
