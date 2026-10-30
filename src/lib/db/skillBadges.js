export const skillBadgeColors = Object.freeze([
  '#f3e8d2',
  '#dce8d9',
  '#d8eee7',
  '#dce8f1',
  '#f5efdf',
  '#f5e1d4',
  '#e9e1f1',
  '#e4ead9',
])

export function skillBadgeColor(index) {
  const normalizedIndex = Number.isInteger(index) && index >= 0 ? index : 0
  return skillBadgeColors[normalizedIndex % skillBadgeColors.length]
}
