import { EVENTS, SIM } from '../simulation/constants.js'
import { VIEWS } from '../scene/layout.js'
import { bus } from '../utils/events.js'
import { el, setText } from '../utils/dom.js'
import { formatClock, formatNumber, formatReason } from '../utils/format.js'

const VIEW_LABELS = Object.freeze({
  overview: 'Огляд',
  reactor: 'Реактор',
  core: 'Зона',
  turbine: 'Турбіна',
  towers: 'Градирні',
  control: 'Щит'
})

const STATUS_LABELS = Object.freeze({
  normal: 'Штатний режим',
  warning: 'Попередження',
  emergency: 'Аварійна ситуація'
})

const RESET_LABEL = 'Перезапуск'
const RESET_CONFIRM_LABEL = 'Підтвердити?'
const RESET_ARM_TIME = 3000
const TOAST_TIME = 4500
const TOAST_LIMIT = 4
const MELTDOWN_DIALOG_DELAY = 8000

function chip(label, onClick, modifier = '') {
  return el('button', { type: 'button', class: `chip ${modifier}`.trim(), onClick }, label)
}

export class Overlay {
  constructor(root, { plant, engine, world, sound }) {
    this.root = root
    this.plant = plant
    this.engine = engine
    this.world = world
    this.sound = sound
    this.dialog = root.querySelector('#overlay')
    this.statusNode = root.querySelector('#plant-status')
    this.clockNode = root.querySelector('#sim-clock')
    this.meltdownShown = false
    this.resetTimer = 0
    this.meltdownTimer = 0
    this.viewButtons = new Map()
    this.speedButtons = new Map()
    this.unsubscribers = []

    this.toasts = el('div', { class: 'toasts' })
    this.#buildToolbar()
    this.#buildTimebar()
    this.flash = el('div', { class: 'flash' })
    root.append(this.toolbar, this.timebar, this.toasts, this.flash)
    this.#bind()
  }

  update(snapshot) {
    setText(this.clockNode, formatClock(snapshot.time))
    setText(this.statusNode, STATUS_LABELS[snapshot.state])
    if (this.statusNode.dataset.state !== snapshot.state) {
      this.statusNode.dataset.state = snapshot.state
    }

    setText(this.pauseButton, snapshot.paused ? 'Продовжити' : 'Пауза')
    this.pauseButton.setAttribute('aria-pressed', String(snapshot.paused))
    for (const [scale, node] of this.speedButtons) {
      node.setAttribute('aria-pressed', String(scale === snapshot.timeScale))
    }
    for (const [name, node] of this.viewButtons) {
      node.setAttribute('aria-pressed', String(name === this.engine.view))
    }
    this.cutawayButton.setAttribute('aria-pressed', String(this.world.cutaway))
    this.soundButton.setAttribute('aria-pressed', String(this.sound.enabled))

    const melted = snapshot.reactor.meltdown
    if (melted && !this.meltdownShown) {
      this.meltdownShown = true
      this.meltdownTimer = setTimeout(() => this.#showMeltdown(snapshot), MELTDOWN_DIALOG_DELAY)
    } else if (!melted && this.meltdownShown) {
      this.#cancelMeltdown()
    }
  }

  destroy() {
    document.removeEventListener('keydown', this.handleKey)
    clearTimeout(this.resetTimer)
    this.unsubscribers.forEach((off) => off())
    this.unsubscribers = []
    clearTimeout(this.meltdownTimer)
  }

  handleKey = (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.target !== document.body) return
    if (event.code === 'Space') {
      event.preventDefault()
      this.plant.setPaused(!this.plant.paused)
      return
    }
    const name = Object.keys(VIEWS)[Number(event.key) - 1]
    if (name) this.#selectView(name)
  }

  #buildToolbar() {
    this.toolbar = el('div', { class: 'toolbar', role: 'toolbar' })
    for (const name of Object.keys(VIEWS)) {
      const node = chip(VIEW_LABELS[name], () => this.#selectView(name))
      this.viewButtons.set(name, node)
      this.toolbar.append(node)
    }
    this.cutawayButton = chip('Розріз', () => this.world.toggleCutaway())
    this.toolbar.append(el('span', { class: 'toolbar__divider' }), this.cutawayButton)
  }

  #buildTimebar() {
    this.pauseButton = chip('Пауза', () => this.plant.setPaused(!this.plant.paused))
    this.soundButton = chip('Звук', () => this.sound.setEnabled(!this.sound.enabled))
    this.resetButton = chip(RESET_LABEL, () => this.#requestReset(), 'chip--danger')

    this.timebar = el('div', { class: 'timebar' }, this.pauseButton)
    for (const scale of SIM.timeScales) {
      const node = chip(`${scale}×`, () => this.plant.setTimeScale(scale))
      this.speedButtons.set(scale, node)
      this.timebar.append(node)
    }
    this.timebar.append(
      el('span', { class: 'toolbar__divider' }),
      this.soundButton,
      this.resetButton
    )
  }

  #bind() {
    this.root.addEventListener('click', (event) => {
      event.target.closest?.('button')?.blur()
    })
    document.addEventListener('keydown', this.handleKey)

    this.unsubscribers = [
      bus.on(EVENTS.NOTICE, ({ text, level }) => this.#toast(text, level)),
      bus.on(EVENTS.SCRAM, ({ reason }) =>
        this.#toast(`Аварійна зупинка реактора: ${formatReason(reason)}`, 'critical')
      ),
      bus.on(EVENTS.TURBINE_TRIP, ({ reason }) =>
        this.#toast(`Турбіну відключено: ${formatReason(reason)}`, 'critical')
      ),
      bus.on(EVENTS.INCIDENT_STARTED, ({ title }) => this.#toast(`Збій: ${title}`, 'warning')),
      bus.on(EVENTS.PLANT_RESET, () => this.#cancelMeltdown()),
      bus.on(EVENTS.EXPLOSION, () => this.#flash())
    ]
  }

  #selectView(name) {
    if (name === 'core') this.world.setCutaway(true)
    this.engine.flyTo(name)
  }

  #requestReset() {
    if (this.resetButton.dataset.armed === 'true') {
      this.#disarmReset()
      this.plant.reset()
      return
    }
    this.resetButton.dataset.armed = 'true'
    setText(this.resetButton, RESET_CONFIRM_LABEL)
    this.resetTimer = setTimeout(() => this.#disarmReset(), RESET_ARM_TIME)
  }

  #disarmReset() {
    clearTimeout(this.resetTimer)
    this.resetButton.dataset.armed = 'false'
    setText(this.resetButton, RESET_LABEL)
  }

  #toast(text, level = 'info') {
    const node = el('div', { class: 'toast', role: 'status', dataset: { level } }, text)
    this.toasts.append(node)
    while (this.toasts.children.length > TOAST_LIMIT) this.toasts.firstChild.remove()
    setTimeout(() => {
      node.classList.add('is-leaving')
      setTimeout(() => node.remove(), 300)
    }, TOAST_TIME)
  }

  #showMeltdown({ time, reactor, grid }) {
    const row = (label, value) => el('div', {}, el('dt', {}, label), el('dd', {}, value))

    const card = el(
      'div',
      { class: 'dialog dialog--danger', role: 'alertdialog' },
      el('h2', { class: 'dialog__title' }, 'Плавлення активної зони'),
      el(
        'p',
        { class: 'dialog__text' },
        'Температура палива перевищила допустиму межу. Блок виведено з ладу, подальше керування неможливе.'
      ),
      el(
        'dl',
        { class: 'dialog__stats' },
        row('Час від початку', formatClock(time)),
        row('Температура палива', `${formatNumber(reactor.fuelTemp, 0)} °C`),
        row(
          'Причина аварійної зупинки',
          reactor.scramReason ? formatReason(reactor.scramReason) : 'захист не спрацював'
        ),
        row('Видано в мережу', `${formatNumber(grid.delivered, 1)} МВт·год`)
      ),
      el(
        'div',
        { class: 'dialog__actions' },
        el(
          'button',
          {
            type: 'button',
            class: 'btn',
            onClick: () => {
              this.dialog.hidden = true
            }
          },
          'Спостерігати'
        ),
        el(
          'button',
          { type: 'button', class: 'btn btn--primary', onClick: () => this.plant.reset() },
          'Перезапустити блок'
        )
      )
    )

    this.dialog.replaceChildren(card)
    this.dialog.hidden = false
  }

  #cancelMeltdown() {
    clearTimeout(this.meltdownTimer)
    this.meltdownShown = false
    this.dialog.hidden = true
  }

  #flash() {
    this.flash.classList.remove('is-flashing')
    void this.flash.offsetWidth
    this.flash.classList.add('is-flashing')
  }
}
