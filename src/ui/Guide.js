import { el, setText } from '../utils/dom.js'
import { clamp } from '../utils/math.js'
import { storage } from '../utils/storage.js'

const STORAGE_KEY = 'npp-simulator:guide'
const SPOT_PADDING = 8
const CARD_MARGIN = 16

const STEPS = Object.freeze([
  {
    target: null,
    title: 'Симулятор АЕС',
    text: 'Ви керуєте енергоблоком із водо-водяним реактором. Короткий тур покаже, де що знаходиться. Поки він триває, симуляція стоїть на паузі.'
  },
  {
    target: '#control-panel',
    placement: 'right',
    title: 'Керування блоком',
    text: 'Чотири вкладки: реактор (стрижні, бор, аварійна зупинка), охолодження (насоси, градирня, аварійне впорскування), турбіна з мережею та сценарії збоїв.'
  },
  {
    target: '#gauges',
    placement: 'left',
    title: 'Прилади',
    text: 'Зелена зона шкали означає норму, жовта попередження, червона небезпеку. Смуги внизу показують стрижні, бор, ушкодження палива, вібрацію турбіни, попит мережі й запас води аварійного охолодження.'
  },
  {
    target: '#alarm-panel',
    placement: 'left',
    title: 'Тривоги й журнал',
    text: 'Нова тривога блимає й лунає звуком, доки її не підтвердити клацанням або кнопкою «Підтвердити всі». Усі події лишаються в журналі.'
  },
  {
    target: '.toolbar',
    placement: 'top',
    title: 'Камера',
    text: 'Швидкі види станції. «Розріз» робить стіни реактора й турбінного залу прозорими. Клавіші 1–6 перемикають види, колесо миші наближає, права кнопка миші зсуває сцену.'
  },
  {
    target: '.timebar',
    placement: 'bottom',
    title: 'Час і звук',
    text: 'Пауза (Пробіл), прискорення до 8×, вимкнення звуку сигналізації та перезапуск блока з підтвердженням.'
  },
  {
    target: '#plant-status',
    placement: 'bottom',
    title: 'Що спробувати',
    text: 'Запустіть збій на вкладці «Аварії» або вручну виведіть стрижні. Статус тут покаже стан блока. Підказку можна відкрити знову кнопкою «?» праворуч угорі.'
  }
])

export class Guide {
  constructor(root, { plant, button }) {
    this.plant = plant
    this.index = 0
    this.open = false
    this.resumePaused = false

    this.counter = el('span', { class: 'guide__counter' })
    this.title = el('h3', { class: 'guide__title' })
    this.text = el('p', { class: 'guide__text' })
    this.skip = el(
      'button',
      { type: 'button', class: 'btn btn--small guide__skip', onClick: () => this.close() },
      'Пропустити'
    )
    this.back = el(
      'button',
      { type: 'button', class: 'btn btn--small', onClick: () => this.#move(-1) },
      'Назад'
    )
    this.next = el('button', {
      type: 'button',
      class: 'btn btn--small btn--primary',
      onClick: () => this.#move(1)
    })

    this.spot = el('div', { class: 'guide__spot' })
    this.card = el(
      'div',
      { class: 'guide__card', role: 'dialog', 'aria-live': 'polite' },
      this.counter,
      this.title,
      this.text,
      el('div', { class: 'guide__actions' }, this.skip, this.back, this.next)
    )
    this.layer = el('div', { class: 'guide', hidden: true }, this.spot, this.card)

    root.append(this.layer)
    button.addEventListener('click', () => this.start())
    window.addEventListener('keydown', this.handleKey, true)
    window.addEventListener('resize', this.handleResize)
  }

  startIfNew() {
    if (storage.get(STORAGE_KEY) !== 'done') this.start()
  }

  start() {
    if (this.open) return
    this.open = true
    this.index = 0
    this.resumePaused = this.plant.paused
    this.plant.setPaused(true)
    this.layer.hidden = false
    this.#render(false)
  }

  close() {
    if (!this.open) return
    this.open = false
    this.layer.hidden = true
    this.plant.setPaused(this.resumePaused)
    storage.set(STORAGE_KEY, 'done')
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKey, true)
    window.removeEventListener('resize', this.handleResize)
    this.layer.remove()
  }

  handleKey = (event) => {
    if (!this.open || event.key === 'Tab') return
    const actions = {
      Escape: () => this.close(),
      ArrowRight: () => this.#move(1),
      ArrowLeft: () => this.#move(-1)
    }
    const action = actions[event.key]
    if (!action && event.target !== document.body) return
    event.preventDefault()
    event.stopPropagation()
    action?.()
  }

  handleResize = () => {
    if (this.open) this.#render(false)
  }

  #move(direction) {
    const next = this.index + direction
    if (next >= STEPS.length) {
      this.close()
      return
    }
    if (next < 0) return
    this.index = next
    this.#render(true)
  }

  #render(animate) {
    const step = STEPS[this.index]
    const last = this.index === STEPS.length - 1

    setText(this.counter, `${this.index + 1} / ${STEPS.length}`)
    setText(this.title, step.title)
    setText(this.text, step.text)
    setText(this.next, last ? 'Готово' : 'Далі')
    this.back.hidden = this.index === 0
    this.skip.hidden = last

    const target = step.target ? document.querySelector(step.target) : null
    const rect = target ? target.getBoundingClientRect() : null
    this.#placeSpot(rect, animate)
    this.#placeCard(rect, step.placement)
  }

  #placeSpot(rect, animate) {
    const box = rect
      ? {
          x: rect.left - SPOT_PADDING,
          y: rect.top - SPOT_PADDING,
          width: rect.width + SPOT_PADDING * 2,
          height: rect.height + SPOT_PADDING * 2
        }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2, width: 0, height: 0 }

    this.spot.style.transition = animate ? '' : 'none'
    this.spot.style.left = `${box.x}px`
    this.spot.style.top = `${box.y}px`
    this.spot.style.width = `${box.width}px`
    this.spot.style.height = `${box.height}px`
  }

  #placeCard(rect, placement) {
    const { innerWidth: viewWidth, innerHeight: viewHeight } = window
    const { offsetWidth: width, offsetHeight: height } = this.card

    let x = (viewWidth - width) / 2
    let y = (viewHeight - height) / 2

    if (rect) {
      switch (placement) {
        case 'right':
          x = rect.right + CARD_MARGIN
          y = rect.top
          break
        case 'left':
          x = rect.left - width - CARD_MARGIN
          y = rect.top
          break
        case 'top':
          x = rect.left + rect.width / 2 - width / 2
          y = rect.top - height - CARD_MARGIN
          break
        case 'bottom':
          x = rect.left + rect.width / 2 - width / 2
          y = rect.bottom + CARD_MARGIN
          break
      }
    }

    this.card.style.transition = this.spot.style.transition
    this.card.style.left = `${clamp(x, CARD_MARGIN, viewWidth - width - CARD_MARGIN)}px`
    this.card.style.top = `${clamp(y, CARD_MARGIN, viewHeight - height - CARD_MARGIN)}px`
  }
}
