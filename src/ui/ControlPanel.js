import { EVENTS, REACTOR, TURBINE } from '../simulation/constants.js'
import { bus } from '../utils/events.js'
import { el, setText } from '../utils/dom.js'
import { formatNumber, formatPercent, formatReason } from '../utils/format.js'

const TABS = Object.freeze([
  { id: 'reactor', label: 'Реактор' },
  { id: 'cooling', label: 'Охолодження' },
  { id: 'turbine', label: 'Турбіна' },
  { id: 'incidents', label: 'Аварії' }
])

const PUMP_LABELS = Object.freeze({
  failed: 'Відмова',
  running: 'Працює',
  starting: 'Розгін',
  stopping: 'Зупинка',
  stopped: 'Зупинено'
})

const notice = (text, level = 'warning') => bus.emit(EVENTS.NOTICE, { text, level })

function section(title, ...children) {
  return el('section', { class: 'block' }, el('h3', { class: 'block__title' }, title), ...children)
}

function button(label, onClick, modifier = '') {
  return el('button', { type: 'button', class: `btn ${modifier}`.trim(), onClick }, label)
}

function segmented(options, onSelect) {
  const items = new Map()
  const root = el('div', { class: 'segmented', role: 'group' })
  for (const { value, label } of options) {
    const node = el(
      'button',
      { type: 'button', class: 'segmented__item', onClick: () => onSelect(value) },
      label
    )
    items.set(value, node)
    root.append(node)
  }
  return {
    root,
    set(value) {
      for (const [key, node] of items) node.setAttribute('aria-pressed', String(key === value))
    }
  }
}

function toggle(label, onChange) {
  const input = el('input', { type: 'checkbox' })
  input.addEventListener('change', () => onChange(input.checked))
  const root = el(
    'label',
    { class: 'switch' },
    input,
    el('span', { class: 'switch__track' }),
    el('span', { class: 'switch__text' }, label)
  )
  return {
    root,
    set(checked) {
      input.checked = checked
    }
  }
}

function readoutList(definitions) {
  const values = new Map()
  const rows = new Map()
  const root = el('dl', { class: 'readouts' })
  for (const [key, label] of definitions) {
    const value = el('dd', {}, '—')
    const row = el(
      'div',
      { class: 'readout', dataset: { level: 'ok' } },
      el('dt', {}, label),
      value
    )
    values.set(key, value)
    rows.set(key, row)
    root.append(row)
  }
  return {
    root,
    set(key, text, level = 'ok') {
      setText(values.get(key), text)
      const row = rows.get(key)
      if (row.dataset.level !== level) row.dataset.level = level
    }
  }
}

class Slider {
  constructor({ label, min, max, step = 1, unit = '', digits = 0, onInput }) {
    this.unit = unit
    this.digits = digits
    this.dragging = false
    this.release = () => {
      this.dragging = false
    }

    this.output = el('output', { class: 'slider__output' })
    this.input = el('input', { type: 'range', class: 'slider__input', min, max, step, value: min })
    this.root = el(
      'label',
      { class: 'slider' },
      el('span', { class: 'slider__head' }, el('span', { class: 'slider__label' }, label), this.output),
      this.input
    )

    this.input.addEventListener('pointerdown', () => {
      this.dragging = true
      window.addEventListener('pointerup', this.release, { once: true })
      window.addEventListener('pointercancel', this.release, { once: true })
    })
    this.input.addEventListener('input', () => {
      const value = Number(this.input.value)
      this.#render(value)
      onInput(value)
    })
  }

  sync(value, enabled = true) {
    this.input.disabled = !enabled
    if (this.dragging) return
    this.input.value = value
    this.#render(Number(this.input.value))
  }

  #render(value) {
    const suffix = this.unit ? ` ${this.unit}` : ''
    setText(this.output, `${formatNumber(value, this.digits)}${suffix}`)
  }
}

export class ControlPanel {
  constructor(container, { plant, incidents }) {
    this.plant = plant
    this.incidents = incidents
    this.active = TABS[0].id
    this.last = null
    this.controls = {}
    this.pumpCards = []
    this.incidentRows = new Map()
    this.tabs = new Map()

    const builders = {
      reactor: () => this.#buildReactor(),
      cooling: () => this.#buildCooling(),
      turbine: () => this.#buildTurbine(),
      incidents: () => this.#buildIncidents()
    }
    this.pages = new Map(TABS.map(({ id }) => [id, builders[id]()]))

    const tabBar = el(
      'div',
      { class: 'tabs', role: 'tablist' },
      ...TABS.map(({ id, label }) => {
        const tab = el(
          'button',
          { type: 'button', class: 'tab', role: 'tab', onClick: () => this.#select(id) },
          label
        )
        this.tabs.set(id, tab)
        return tab
      })
    )

    container.append(
      el('div', { class: 'panel__header' }, el('h2', { class: 'panel__title' }, 'Керування блоком')),
      tabBar,
      ...this.pages.values()
    )
    this.#select(this.active)
  }

  update(snapshot) {
    this.last = snapshot
    this.#sync(snapshot)
  }

  #select(id) {
    this.active = id
    for (const [key, tab] of this.tabs) tab.setAttribute('aria-selected', String(key === id))
    for (const [key, page] of this.pages) page.hidden = key !== id
    if (this.last) this.#sync(this.last)
  }

  #sync(snapshot) {
    switch (this.active) {
      case 'reactor':
        this.#syncReactor(snapshot)
        break
      case 'cooling':
        this.#syncCooling(snapshot)
        break
      case 'turbine':
        this.#syncTurbine(snapshot)
        break
      case 'incidents':
        this.#syncIncidents()
        break
    }
  }

  #page(...children) {
    return el('div', { class: 'tab-panel', role: 'tabpanel', hidden: true }, ...children)
  }

  #buildReactor() {
    const c = this.controls
    const reactor = () => this.plant.reactor

    c.mode = segmented(
      [
        { value: 'auto', label: 'Автоматичний' },
        { value: 'manual', label: 'Ручний' }
      ],
      (mode) => {
        if (!reactor().setMode(mode)) {
          notice('Автоматичний режим недоступний: перевірте стрижні, стан захисту та рівень потужності')
        }
      }
    )
    c.setpoint = new Slider({
      label: 'Задана потужність',
      min: Math.round(REACTOR.minPowerFraction * 100),
      max: 105,
      unit: '%',
      onInput: (value) => reactor().setPowerSetpoint(value / 100)
    })
    c.rods = new Slider({
      label: 'Введення стрижнів',
      min: 0,
      max: 100,
      unit: '%',
      onInput: (value) => reactor().setRodTarget(value / 100)
    })
    c.boron = new Slider({
      label: 'Борна кислота в теплоносії',
      min: 0,
      max: 100,
      unit: '%',
      onInput: (value) => reactor().setBoronTarget(value / 100)
    })
    c.scram = button('Аварійна зупинка', () => reactor().scram('manual'), 'btn--scram')
    c.resetScram = button('Скинути аварійну зупинку', () => {
      if (!reactor().resetScram()) {
        notice('Скидання неможливе: потужність і температура теплоносія мають бути в нормі')
      }
    })
    c.autoScram = toggle('Автоматичний захист реактора', (on) => this.plant.setAutoScram(on))
    c.reactorInfo = readoutList([
      ['state', 'Стан'],
      ['thermal', 'Теплова потужність'],
      ['decay', 'Залишкове тепловиділення'],
      ['reactivity', 'Реактивність']
    ])

    return this.#page(
      section('Режим керування', c.mode.root, c.setpoint.root, c.rods.root, c.boron.root),
      section('Аварійний захист', c.scram, c.resetScram, c.autoScram.root),
      section('Стан реактора', c.reactorInfo.root)
    )
  }

  #syncReactor({ reactor, autoScram }) {
    const c = this.controls
    const auto = reactor.mode === 'auto'
    const commandable = !auto && !reactor.scrammed && !reactor.rodFault

    c.mode.set(reactor.mode)
    c.setpoint.sync(reactor.powerSetpoint * 100, auto && !reactor.scrammed)
    c.rods.sync((commandable ? reactor.rodTarget : reactor.rodInsertion) * 100, commandable)
    c.boron.sync(reactor.boronTarget * 100)
    c.scram.disabled = reactor.scrammed
    c.resetScram.disabled = !reactor.scrammed || reactor.meltdown
    c.autoScram.set(autoScram)

    let state = auto ? 'У роботі, автоматичне регулювання' : 'У роботі, ручне керування'
    let level = 'ok'
    if (reactor.meltdown) {
      state = 'Плавлення активної зони'
      level = 'danger'
    } else if (reactor.scrammed) {
      state = `Аварійна зупинка: ${formatReason(reactor.scramReason)}`
      level = 'danger'
    } else if (reactor.rodFault) {
      level = 'warn'
    }
    c.reactorInfo.set('state', state, level)
    c.reactorInfo.set('thermal', `${formatNumber(reactor.thermalPower, 0)} МВт`)
    c.reactorInfo.set(
      'decay',
      `${formatNumber(reactor.decayHeat * REACTOR.nominalThermalPower, 0)} МВт`
    )
    c.reactorInfo.set('reactivity', `${formatNumber(reactor.reactivity * 1e5, 0)} pcm`)
  }

  #buildCooling() {
    const c = this.controls
    const cooling = () => this.plant.cooling

    this.pumpCards = Array.from({ length: this.plant.cooling.pumps.length }, (_, index) => {
      const status = el('span', { class: 'pump__status' }, '—')
      const fill = el('div', { class: 'pump__fill' })
      const root = el(
        'button',
        {
          type: 'button',
          class: 'pump',
          dataset: { state: 'stopped' },
          onClick: () => this.#togglePump(index)
        },
        el('span', { class: 'pump__name' }, `Насос ${index + 1}`),
        status,
        el('div', { class: 'pump__bar' }, fill)
      )
      return { root, status, fill }
    })

    c.pumpAll = el(
      'div',
      { class: 'btn-row' },
      button('Запустити всі', () => cooling().setAllPumps(true), 'btn--small'),
      button('Зупинити всі', () => cooling().setAllPumps(false), 'btn--small')
    )
    c.eccs = button('Аварійне впорскування', () => this.#toggleInjection())
    c.fanMode = segmented(
      [
        { value: 'auto', label: 'Авто' },
        { value: 'manual', label: 'Ручний' }
      ],
      (mode) => cooling().setFanAuto(mode === 'auto')
    )
    c.fan = new Slider({
      label: 'Вентилятори градирні',
      min: 0,
      max: 100,
      unit: '%',
      onInput: (value) => cooling().setFanSetpoint(value / 100)
    })
    c.coolingInfo = readoutList([
      ['flow', 'Циркуляція теплоносія'],
      ['leak', 'Витік з контуру'],
      ['eccs', 'Аварійне охолодження'],
      ['tank', 'Запас води ECCS'],
      ['condenser', 'Тепловідведення градирні']
    ])

    return this.#page(
      section(
        'Головні циркуляційні насоси',
        el('div', { class: 'pumps' }, ...this.pumpCards.map((card) => card.root)),
        c.pumpAll
      ),
      section('Аварійне охолодження', c.eccs),
      section('Градирня', c.fanMode.root, c.fan.root),
      section('Стан контуру', c.coolingInfo.root)
    )
  }

  #togglePump(index) {
    const cooling = this.plant.cooling
    const pump = cooling.pumps[index]
    if (pump.failed) {
      notice(`Насос ${index + 1} несправний і недоступний для запуску`)
      return
    }
    cooling.setPump(index, !pump.commanded)
  }

  #toggleInjection() {
    const cooling = this.plant.cooling
    if (!cooling.eccsAvailable) {
      notice('Система аварійного охолодження недоступна')
      return
    }
    cooling.setInjection(!cooling.manualInjection)
  }

  #syncCooling({ cooling }) {
    const c = this.controls

    cooling.pumps.forEach((pump, index) => {
      const card = this.pumpCards[index]
      let state
      if (pump.failed) state = 'failed'
      else if (!pump.commanded) state = pump.speed > 0.05 ? 'stopping' : 'stopped'
      else state = pump.speed > 0.9 ? 'running' : 'starting'
      if (card.root.dataset.state !== state) card.root.dataset.state = state
      setText(card.status, PUMP_LABELS[state])
      card.fill.style.width = `${(pump.speed * 100).toFixed(0)}%`
    })

    c.eccs.setAttribute('aria-pressed', String(cooling.manualInjection))
    c.fanMode.set(cooling.fanAuto ? 'auto' : 'manual')
    c.fan.sync((cooling.fanAuto ? cooling.fanSpeed : cooling.fanSetpoint) * 100, !cooling.fanAuto)

    let eccs = 'Черговий режим'
    let eccsLevel = 'ok'
    if (!cooling.eccsAvailable) {
      eccs = 'Недоступне'
      eccsLevel = 'danger'
    } else if (cooling.injecting) {
      eccs = 'Подає воду'
      eccsLevel = 'warn'
    }
    c.coolingInfo.set('flow', formatPercent(cooling.flow), cooling.flow < 0.5 ? 'warn' : 'ok')
    c.coolingInfo.set(
      'leak',
      cooling.leakRate > 0 ? `${formatNumber(cooling.leakRate * 100, 1)} %/с` : 'Немає',
      cooling.leakRate > 0 ? 'danger' : 'ok'
    )
    c.coolingInfo.set('eccs', eccs, eccsLevel)
    c.coolingInfo.set('tank', formatPercent(cooling.tank), cooling.tank < 0.2 ? 'warn' : 'ok')
    c.coolingInfo.set(
      'condenser',
      formatPercent(cooling.condenserFactor),
      cooling.condenserFactor < 0.9 ? 'warn' : 'ok'
    )
  }

  #buildTurbine() {
    const c = this.controls
    const turbine = () => this.plant.turbine

    c.load = new Slider({
      label: 'Задане навантаження',
      min: 0,
      max: REACTOR.nominalElectricPower * 1.05,
      step: 10,
      unit: 'МВт',
      onInput: (value) => turbine().setLoad(value)
    })
    c.run = button('Пустити турбіну', () => {
      const unit = turbine()
      if (unit.running) unit.stop()
      else if (!unit.start()) notice('Турбіну відключено захистом: спершу скиньте відключення')
    })
    c.breaker = button('Підключити до мережі', () => {
      const { turbine: unit, grid } = this.plant
      if (unit.synchronized) unit.openBreaker()
      else if (!unit.synchronize(grid)) {
        notice('Синхронізація неможлива: турбіна має працювати на номінальних обертах, а мережа бути доступною')
      }
    })
    c.resetTrip = button('Скинути відключення', () => {
      if (!turbine().resetTrip()) notice('Скидання можливе після майже повної зупинки ротора')
    })
    c.turbineInfo = readoutList([
      ['state', 'Стан'],
      ['valve', 'Регулюючий клапан'],
      ['steam', 'Тиск пари'],
      ['power', 'Віддача в мережу']
    ])
    c.gridInfo = readoutList([
      ['grid', 'Зовнішня мережа'],
      ['frequency', 'Частота'],
      ['delivered', 'Видано енергії']
    ])

    return this.#page(
      section('Навантаження', c.load.root),
      section('Керування турбіною', c.run, c.breaker, c.resetTrip),
      section('Стан турбіни', c.turbineInfo.root),
      section('Мережа', c.gridInfo.root)
    )
  }

  #syncTurbine({ turbine, grid }) {
    const c = this.controls

    c.load.sync(turbine.loadSetpoint)
    setText(c.run, turbine.running ? 'Зупинити турбіну' : 'Пустити турбіну')
    setText(c.breaker, turbine.synchronized ? 'Відключити від мережі' : 'Підключити до мережі')
    c.resetTrip.disabled = !turbine.tripped

    let state = 'Зупинено'
    let level = 'ok'
    if (turbine.tripped) {
      state = `Відключено захистом: ${formatReason(turbine.tripReason)}`
      level = 'danger'
    } else if (turbine.synchronized) {
      state = 'Працює в мережі'
    } else if (turbine.running) {
      state = turbine.rpm >= TURBINE.nominalRpm * 0.98 ? 'Холостий хід' : 'Розгін'
      level = 'warn'
    } else if (turbine.rpm > 50) {
      state = 'Вибіг ротора'
      level = 'warn'
    }

    const steamPressure = turbine.steamPressure * TURBINE.steamPressureNominal
    c.turbineInfo.set('state', state, level)
    c.turbineInfo.set('valve', formatPercent(turbine.valve))
    c.turbineInfo.set(
      'steam',
      `${formatNumber(steamPressure, 1)} МПа`,
      turbine.steamPressure > 1.3 ? 'danger' : turbine.steamPressure > 1.15 ? 'warn' : 'ok'
    )
    c.turbineInfo.set('power', `${formatNumber(turbine.electricPower, 0)} МВт`)

    const deviation = Math.abs(grid.frequency - 50)
    c.gridInfo.set('grid', grid.available ? 'Доступна' : 'Відсутня', grid.available ? 'ok' : 'danger')
    c.gridInfo.set(
      'frequency',
      `${formatNumber(grid.frequency, 2)} Гц`,
      !grid.available || deviation > 1 ? 'danger' : deviation > 0.5 ? 'warn' : 'ok'
    )
    c.gridInfo.set('delivered', `${formatNumber(grid.delivered, 1)} МВт·год`)
  }

  #buildIncidents() {
    const c = this.controls

    const rows = this.incidents.list().map(({ id, title, description }) => {
      const action = button('Запустити', () => this.#toggleIncident(id), 'btn--small')
      const root = el(
        'div',
        { class: 'incident', dataset: { active: 'false' } },
        el(
          'div',
          { class: 'incident__text' },
          el('strong', { class: 'incident__title' }, title),
          el('p', {}, description)
        ),
        action
      )
      this.incidentRows.set(id, { root, action })
      return root
    })

    c.random = toggle('Випадкові збої під час роботи', (on) => this.incidents.setRandom(on))
    c.resolveAll = button('Усунути всі збої', () => this.incidents.resolveAll(), 'btn--small')

    return this.#page(
      section('Режим', c.random.root, c.resolveAll),
      section('Сценарії збоїв', el('div', { class: 'incidents' }, ...rows))
    )
  }

  #toggleIncident(id) {
    if (this.incidents.active.has(id)) this.incidents.resolve(id)
    else if (!this.incidents.trigger(id)) notice('Цей збій не можна запустити за поточного стану блока')
  }

  #syncIncidents() {
    const c = this.controls
    for (const [id, { root, action }] of this.incidentRows) {
      const active = this.incidents.active.has(id)
      const value = String(active)
      if (root.dataset.active !== value) {
        root.dataset.active = value
        setText(action, active ? 'Усунути' : 'Запустити')
      }
    }
    c.random.set(this.incidents.randomEnabled)
    c.resolveAll.disabled = this.incidents.active.size === 0
  }
}
