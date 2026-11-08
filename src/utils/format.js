const pad = (value) => String(Math.floor(value)).padStart(2, '0')

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export function formatNumber(value, digits = 1) {
  return Number(value).toLocaleString('uk-UA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

export function formatPercent(fraction, digits = 0) {
  return `${formatNumber(fraction * 100, digits)}%`
}

export function formatValue(value, unit, digits = 1) {
  return `${formatNumber(value, digits)} ${unit}`
}

const REASONS = Object.freeze({
  manual: 'вручну',
  'high coolant temperature': 'висока температура теплоносія',
  'high pressure': 'високий тиск у контурі',
  'low coolant level': 'низький рівень теплоносія',
  'high fuel temperature': 'висока температура палива',
  'loss of flow': 'втрата циркуляції',
  'high power': 'перевищення потужності',
  'turbine trip': 'відключення турбіни',
  overspeed: 'перевищення обертів',
  vibration: 'висока вібрація',
  'steam pressure': 'низький тиск пари'
})

export function formatReason(reason) {
  return REASONS[reason] ?? reason
}
