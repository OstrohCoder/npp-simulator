import { GRID, REACTOR, TURBINE } from '../simulation/constants.js'
import { el, svgEl, setText } from '../utils/dom.js'
import { clamp, inverseLerp } from '../utils/math.js'
import { formatNumber, formatPercent } from '../utils/format.js'

const CENTER_X = 60
const CENTER_Y = 50
const RADIUS = 40
const START_ANGLE = -120
const SWEEP = 240
const DEMAND_SCALE = 1200

const FREQ = GRID.nominalFrequency
const TOL = GRID.frequencyTolerance

const GAUGE_SPECS = Object.freeze([
  {
    label: 'Потужність реактора',
    unit: '%',
    min: 0,
    max: 120,
    digits: 0,
    zones: [
      { from: 0, to: 100, level: 'ok' },
      { from: 100, to: 110, level: 'warn' },
      { from: 110, to: 120, level: 'danger' }
    ],
    read: (s) => s.reactor.power * 100
  },
  {
    label: 'Температура теплоносія',
    unit: '°C',
    min: 250,
    max: 380,
    digits: 0,
    zones: [
      { from: 250, to: REACTOR.coolantTempWarning, level: 'ok' },
      { from: REACTOR.coolantTempWarning, to: REACTOR.coolantTempScram, level: 'warn' },
      { from: REACTOR.coolantTempScram, to: 380, level: 'danger' }
    ],
    read: (s) => s.reactor.coolantTemp
  },
  {
    label: 'Тиск у контурі',
    unit: 'МПа',
    min: 10,
    max: 20,
    digits: 1,
    zones: [
      { from: 10, to: 12, level: 'danger' },
      { from: 12, to: REACTOR.pressureLow, level: 'warn' },
      { from: REACTOR.pressureLow, to: REACTOR.pressureWarning, level: 'ok' },
      { from: REACTOR.pressureWarning, to: REACTOR.pressureScram, level: 'warn' },
      { from: REACTOR.pressureScram, to: 20, level: 'danger' }
    ],
    read: (s) => s.reactor.pressure
  },
  {
    label: 'Температура палива',
    unit: '°C',
    min: 300,
    max: 2400,
    digits: 0,
    zones: [
      { from: 300, to: 1300, level: 'ok' },
      { from: 1300, to: REACTOR.fuelTempWarning, level: 'warn' },
      { from: REACTOR.fuelTempWarning, to: 2400, level: 'danger' }
    ],
    read: (s) => s.reactor.fuelTemp
  },
  {
    label: 'Рівень теплоносія',
    unit: '%',
    min: 0,
    max: 100,
    digits: 0,
    zones: [
      { from: 0, to: 40, level: 'danger' },
      { from: 40, to: 70, level: 'warn' },
      { from: 70, to: 100, level: 'ok' }
    ],
    read: (s) => s.cooling.level * 100
  },
  {
    label: 'Оберти турбіни',
    unit: 'об/хв',
    min: 0,
    max: 3600,
    digits: 0,
    zones: [
      { from: 0, to: TURBINE.nominalRpm * 1.04, level: 'ok' },
      { from: TURBINE.nominalRpm * 1.04, to: TURBINE.tripRpm, level: 'warn' },
      { from: TURBINE.tripRpm, to: 3600, level: 'danger' }
    ],
    read: (s) => s.turbine.rpm
  },
  {
    label: 'Електрична потужність',
    unit: 'МВт',
    min: 0,
    max: 1200,
    digits: 0,
    zones: [
      { from: 0, to: 1050, level: 'ok' },
      { from: 1050, to: 1200, level: 'warn' }
    ],
    read: (s) => s.turbine.electricPower
  },
  {
    label: 'Частота мережі',
    unit: 'Гц',
    min: FREQ - 4,
    max: FREQ + 4,
    digits: 2,
    zones: [
      { from: FREQ - 4, to: FREQ - 2 * TOL, level: 'danger' },
      { from: FREQ - 2 * TOL, to: FREQ - TOL, level: 'warn' },
      { from: FREQ - TOL, to: FREQ + TOL, level: 'ok' },
      { from: FREQ + TOL, to: FREQ + 2 * TOL, level: 'warn' },
      { from: FREQ + 2 * TOL, to: FREQ + 4, level: 'danger' }
    ],
    read: (s) => s.grid.frequency
  }
])

function byThreshold(value, warn, danger) {
  if (value >= danger) return 'danger'
  if (value >= warn) return 'warn'
  return 'ok'
}

const METER_SPECS = Object.freeze([
  {
    label: 'Стрижні',
    read: (s) => s.reactor.rodInsertion,
    text: (s) => formatPercent(s.reactor.rodInsertion),
    level: (s) => (s.reactor.rodFault ? 'danger' : 'ok')
  },
  {
    label: 'Бор',
    read: (s) => s.reactor.boron,
    text: (s) => formatPercent(s.reactor.boron),
    level: () => 'ok'
  },
  {
    label: 'Ушкодження палива',
    read: (s) => s.reactor.fuelDamage,
    text: (s) => formatPercent(s.reactor.fuelDamage),
    level: (s) => byThreshold(s.reactor.fuelDamage, 0.3, 0.7)
  },
  {
    label: 'Вібрація турбіни',
    read: (s) => s.turbine.vibration,
    text: (s) => formatPercent(s.turbine.vibration),
    level: (s) => byThreshold(s.turbine.vibration, 0.5, 0.8)
  },
  {
    label: 'Попит мережі',
    read: (s) => s.grid.demand / DEMAND_SCALE,
    text: (s) => `${formatNumber(s.grid.demand, 0)} МВт`,
    level: () => 'ok'
  },
  {
    label: 'Запас ECCS',
    read: (s) => s.cooling.tank,
    text: (s) => formatPercent(s.cooling.tank),
    level: (s) => (s.cooling.tank < 0.2 ? 'danger' : s.cooling.tank < 0.5 ? 'warn' : 'ok')
  }
])

function point(angle, radius) {
  const radians = (angle * Math.PI) / 180
  return [CENTER_X + radius * Math.sin(radians), CENTER_Y - radius * Math.cos(radians)]
}

function arc(from, to) {
  const [x1, y1] = point(from, RADIUS)
  const [x2, y2] = point(to, RADIUS)
  const large = to - from > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function levelOf(zones, value) {
  for (const zone of zones) {
    if (value <= zone.to) return zone.level
  }
  return zones[zones.length - 1].level
}

class ArcGauge {
  constructor({ label, unit, min, max, digits, zones, read }) {
    this.min = min
    this.max = max
    this.digits = digits
    this.zones = zones
    this.read = read
    this.level = 'ok'
    this.angleOf = (value) => START_ANGLE + SWEEP * inverseLerp(min, max, value)

    this.needle = svgEl(
      'g',
      { class: 'gauge__needle' },
      svgEl('line', {
        x1: CENTER_X,
        y1: CENTER_Y,
        x2: CENTER_X,
        y2: CENTER_Y - RADIUS + 5
      }),
      svgEl('circle', { cx: CENTER_X, cy: CENTER_Y, r: 3.2 })
    )
    this.valueNode = svgEl('tspan', { class: 'gauge__value' }, '0')
    this.unitNode = svgEl('tspan', { class: 'gauge__unit', dx: 3 }, unit)

    this.root = el(
      'div',
      { class: 'gauge', dataset: { level: 'ok' } },
      svgEl(
        'svg',
        { class: 'gauge__dial', viewBox: '0 0 120 84' },
        svgEl('path', { class: 'gauge__track', d: arc(START_ANGLE, START_ANGLE + SWEEP) }),
        ...zones.map((zone) =>
          svgEl('path', {
            class: `gauge__zone gauge__zone--${zone.level}`,
            d: arc(this.angleOf(zone.from), this.angleOf(zone.to))
          })
        ),
        this.needle,
        svgEl('text', { x: CENTER_X, y: 80, 'text-anchor': 'middle' }, this.valueNode, this.unitNode)
      ),
      el('div', { class: 'gauge__label' }, label)
    )
  }

  update(snapshot) {
    const value = this.read(snapshot)
    const angle = this.angleOf(clamp(value, this.min, this.max))
    this.needle.style.transform = `rotate(${angle.toFixed(1)}deg)`
    setText(this.valueNode, formatNumber(value, this.digits))
    const level = levelOf(this.zones, value)
    if (level !== this.level) {
      this.level = level
      this.root.dataset.level = level
    }
  }
}

class MeterBar {
  constructor({ label, read, text, level }) {
    this.readValue = read
    this.readText = text
    this.readLevel = level
    this.level = 'ok'
    this.textNode = el('span', { class: 'meter__text' }, '0%')
    this.fill = el('div', { class: 'meter__fill' })
    this.root = el(
      'div',
      { class: 'meter', dataset: { level: 'ok' } },
      el('div', { class: 'meter__head' }, el('span', { class: 'meter__label' }, label), this.textNode),
      el('div', { class: 'meter__track' }, this.fill)
    )
  }

  update(snapshot) {
    const fraction = clamp(this.readValue(snapshot), 0, 1)
    this.fill.style.width = `${(fraction * 100).toFixed(1)}%`
    setText(this.textNode, this.readText(snapshot))
    const level = this.readLevel(snapshot)
    if (level !== this.level) {
      this.level = level
      this.root.dataset.level = level
    }
  }
}

export class Gauges {
  constructor(container) {
    this.gauges = GAUGE_SPECS.map((spec) => new ArcGauge(spec))
    this.meters = METER_SPECS.map((spec) => new MeterBar(spec))

    container.append(
      el('div', { class: 'panel__header' }, el('h2', { class: 'panel__title' }, 'Параметри блоку')),
      el(
        'div',
        { class: 'gauges' },
        el('div', { class: 'gauge-grid' }, ...this.gauges.map((gauge) => gauge.root)),
        el('div', { class: 'meters' }, ...this.meters.map((meter) => meter.root))
      )
    )
  }

  update(snapshot) {
    for (const gauge of this.gauges) gauge.update(snapshot)
    for (const meter of this.meters) meter.update(snapshot)
  }
}
