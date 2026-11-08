import { ALARM_LEVEL, EVENTS } from '../simulation/constants.js'
import { bus } from '../utils/events.js'
import { el, setText } from '../utils/dom.js'
import { formatClock, formatReason } from '../utils/format.js'

const LOG_LIMIT = 100

const LEVEL_ORDER = Object.freeze({
  [ALARM_LEVEL.CRITICAL]: 0,
  [ALARM_LEVEL.WARNING]: 1,
  [ALARM_LEVEL.INFO]: 2
})

export class AlarmPanel {
  constructor(container, plant) {
    this.container = container
    this.plant = plant
    this.signature = null
    this.names = new Map()
    this.unsubscribers = []

    this.activeList = el('ul', { class: 'alarm-list' })
    this.logList = el('ul', { class: 'alarm-list' })
    this.empty = el('p', { class: 'alarm-empty' }, 'Активних тривог немає')
    this.badge = el('span', { class: 'badge', hidden: true }, '0')

    this.activeTab = el(
      'button',
      { type: 'button', class: 'alarm-tab', onClick: () => this.#show('active') },
      'Тривоги',
      this.badge
    )
    this.logTab = el(
      'button',
      { type: 'button', class: 'alarm-tab', onClick: () => this.#show('log') },
      'Журнал'
    )
    this.ackButton = el(
      'button',
      { type: 'button', class: 'btn btn--small', onClick: () => plant.acknowledgeAll() },
      'Підтвердити всі'
    )

    this.activeBody = el('div', { class: 'alarm-body' }, this.activeList, this.empty)
    this.logBody = el('div', { class: 'alarm-body' }, this.logList)

    container.append(
      el('div', { class: 'alarm-head' }, this.activeTab, this.logTab, this.ackButton),
      this.activeBody,
      this.logBody
    )

    this.#show('active')
    this.#subscribe()
  }

  update({ alarms }) {
    const sorted = [...alarms].sort(
      (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.time - a.time
    )
    const signature = sorted.map((a) => `${a.id}:${a.acknowledged ? 1 : 0}`).join('|')
    if (signature === this.signature) return
    this.signature = signature

    this.activeList.replaceChildren(...sorted.map((alarm) => this.#item(alarm)))
    this.empty.hidden = sorted.length > 0

    const pending = sorted.filter((alarm) => !alarm.acknowledged)
    setText(this.badge, String(pending.length))
    this.badge.hidden = pending.length === 0
    this.ackButton.disabled = pending.length === 0
    this.container.dataset.alert = String(
      pending.some((alarm) => alarm.level === ALARM_LEVEL.CRITICAL)
    )
  }

  destroy() {
    this.unsubscribers.forEach((off) => off())
    this.unsubscribers = []
  }

  #show(view) {
    const active = view === 'active'
    this.activeBody.hidden = !active
    this.logBody.hidden = active
    this.ackButton.hidden = !active
    this.activeTab.setAttribute('aria-selected', String(active))
    this.logTab.setAttribute('aria-selected', String(!active))
  }

  #item(alarm) {
    return el(
      'li',
      {
        class: 'alarm',
        dataset: { level: alarm.level, ack: String(alarm.acknowledged) },
        onClick: () => this.plant.acknowledgeAlarm(alarm.id)
      },
      el('span', { class: 'alarm__time' }, formatClock(alarm.time)),
      el('span', { class: 'alarm__text' }, alarm.text)
    )
  }

  #log(text, level = ALARM_LEVEL.INFO) {
    const item = el(
      'li',
      { class: 'alarm alarm--log', dataset: { level } },
      el('span', { class: 'alarm__time' }, formatClock(this.plant.time)),
      el('span', { class: 'alarm__text' }, text)
    )
    this.logList.prepend(item)
    while (this.logList.children.length > LOG_LIMIT) this.logList.lastChild.remove()
  }

  #subscribe() {
    this.unsubscribers = [
      bus.on(EVENTS.ALARM_RAISED, (alarm) => {
        this.names.set(alarm.id, alarm.text)
        this.#log(`Тривога: ${alarm.text}`, alarm.level)
      }),
      bus.on(EVENTS.ALARM_CLEARED, ({ id }) => {
        const text = this.names.get(id)
        if (text) this.#log(`Повернулося в норму: ${text}`)
      }),
      bus.on(EVENTS.SCRAM, ({ reason }) =>
        this.#log(`Аварійна зупинка реактора: ${formatReason(reason)}`, ALARM_LEVEL.CRITICAL)
      ),
      bus.on(EVENTS.TURBINE_TRIP, ({ reason }) =>
        this.#log(`Турбіну відключено: ${formatReason(reason)}`, ALARM_LEVEL.CRITICAL)
      ),
      bus.on(EVENTS.INCIDENT_STARTED, ({ title }) =>
        this.#log(`Збій: ${title}`, ALARM_LEVEL.WARNING)
      ),
      bus.on(EVENTS.INCIDENT_RESOLVED, ({ title }) => this.#log(`Усунено: ${title}`)),
      bus.on(EVENTS.NOTICE, ({ text, level }) => this.#log(text, level)),
      bus.on(EVENTS.PLANT_RESET, () => {
        this.names.clear()
        this.signature = null
        this.logList.replaceChildren()
        this.#log('Блок перезапущено')
      })
    ]
  }
}
