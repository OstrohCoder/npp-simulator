import { Reactor } from './Reactor.js'
import { CoolingSystem } from './CoolingSystem.js'
import { Turbine } from './Turbine.js'
import { Grid } from './Grid.js'
import { REACTOR, COOLING, TURBINE, GRID, SIM, PLANT_STATE, ALARM_LEVEL, EVENTS } from './constants.js'
import { bus } from '../utils/events.js'

const SCRAM_DELAY = 1.5

const ALARM_DEFS = Object.freeze([
  {
    id: 'coolant-temp-high',
    level: ALARM_LEVEL.WARNING,
    text: 'Висока температура теплоносія',
    test: (s) => s.reactor.coolantTemp >= REACTOR.coolantTempWarning
  },
  {
    id: 'pressure-high',
    level: ALARM_LEVEL.WARNING,
    text: 'Високий тиск у контурі',
    test: (s) => s.reactor.pressure >= REACTOR.pressureWarning
  },
  {
    id: 'pressure-low',
    level: ALARM_LEVEL.WARNING,
    text: 'Низький тиск у контурі',
    test: (s) => s.reactor.pressure <= REACTOR.pressureLow
  },
  {
    id: 'fuel-temp-high',
    level: ALARM_LEVEL.CRITICAL,
    text: 'Перегрів палива',
    test: (s) => s.reactor.fuelTemp >= REACTOR.fuelTempWarning
  },
  {
    id: 'level-low',
    level: ALARM_LEVEL.WARNING,
    text: 'Знижений рівень теплоносія',
    test: (s) => s.cooling.level <= COOLING.coolantLevelWarning
  },
  {
    id: 'level-critical',
    level: ALARM_LEVEL.CRITICAL,
    text: 'Критичний рівень теплоносія',
    test: (s) => s.cooling.level <= COOLING.coolantLevelCritical
  },
  {
    id: 'flow-low',
    level: ALARM_LEVEL.WARNING,
    text: 'Недостатня циркуляція',
    test: (s) => s.cooling.flow < COOLING.minSafeFlowFraction && !s.reactor.scrammed
  },
  {
    id: 'pump-failed',
    level: ALARM_LEVEL.WARNING,
    text: 'Відмова головного циркуляційного насоса',
    test: (s) => s.cooling.pumps.some((p) => p.failed)
  },
  {
    id: 'eccs-active',
    level: ALARM_LEVEL.WARNING,
    text: 'Спрацювала система аварійного охолодження',
    test: (s) => s.cooling.injecting
  },
  {
    id: 'rod-fault',
    level: ALARM_LEVEL.CRITICAL,
    text: 'Несправність приводу стрижнів',
    test: (s) => Boolean(s.reactor.rodFault)
  },
  {
    id: 'turbine-vibration',
    level: ALARM_LEVEL.WARNING,
    text: 'Підвищена вібрація турбіни',
    test: (s) => s.turbine.vibration >= 0.5
  },
  {
    id: 'turbine-overspeed',
    level: ALARM_LEVEL.WARNING,
    text: 'Перевищення обертів турбіни',
    test: (s) => s.turbine.rpm >= TURBINE.nominalRpm * 1.04
  },
  {
    id: 'turbine-tripped',
    level: ALARM_LEVEL.CRITICAL,
    text: 'Турбіна відключена захистом',
    test: (s) => s.turbine.tripped
  },
  {
    id: 'grid-lost',
    level: ALARM_LEVEL.CRITICAL,
    text: 'Втрата зовнішньої мережі',
    test: (s) => !s.grid.available
  },
  {
    id: 'frequency-off',
    level: ALARM_LEVEL.WARNING,
    text: 'Відхилення частоти мережі',
    test: (s) => s.grid.available && Math.abs(s.grid.frequency - GRID.nominalFrequency) > GRID.frequencyTolerance
  },
  {
    id: 'cooling-tower',
    level: ALARM_LEVEL.WARNING,
    text: 'Градирня не справляється з навантаженням',
    test: (s) => s.cooling.condenserFactor < 0.9
  },
  {
    id: 'scram',
    level: ALARM_LEVEL.CRITICAL,
    text: 'Аварійна зупинка реактора',
    test: (s) => s.reactor.scrammed
  },
  {
    id: 'meltdown',
    level: ALARM_LEVEL.CRITICAL,
    text: 'Плавлення активної зони',
    test: (s) => s.reactor.meltdown
  }
])

const SCRAM_TRIPS = Object.freeze([
  {
    reason: 'high coolant temperature',
    test: (s) => s.reactor.coolantTemp >= REACTOR.coolantTempScram
  },
  {
    reason: 'high pressure',
    test: (s) => s.reactor.pressure >= REACTOR.pressureScram
  },
  {
    reason: 'low coolant level',
    test: (s) => s.cooling.level <= COOLING.coolantLevelCritical
  },
  {
    reason: 'high fuel temperature',
    test: (s) => s.reactor.fuelTemp >= REACTOR.fuelTempWarning
  },
  {
    reason: 'loss of flow',
    test: (s) => s.cooling.flow < COOLING.minSafeFlowFraction * 0.5 && s.reactor.power > 0.2
  },
  {
    reason: 'high power',
    test: (s) => s.reactor.power >= 1.2
  }
])

export class Plant {
  constructor() {
    this.reactor = new Reactor()
    this.cooling = new CoolingSystem()
    this.turbine = new Turbine()
    this.grid = new Grid()
    this.time = 0
    this.accumulator = 0
    this.timeScale = SIM.defaultTimeScale
    this.paused = false
    this.state = PLANT_STATE.NORMAL
    this.alarms = new Map()
    this.scramTimers = new Map()
    this.autoScram = true
    this.incidents = null
  }

  attachIncidents(incidents) {
    this.incidents = incidents
  }

  setTimeScale(scale) {
    if (SIM.timeScales.includes(scale)) this.timeScale = scale
  }

  setPaused(paused) {
    this.paused = Boolean(paused)
  }

  setAutoScram(enabled) {
    this.autoScram = Boolean(enabled)
  }

  update(frameDelta) {
    if (this.paused) return
    const delta = Math.min(frameDelta, SIM.maxFrameDelta)
    this.accumulator += delta * this.timeScale
    const limit = SIM.fixedStep * SIM.timeScales[SIM.timeScales.length - 1] * 4
    if (this.accumulator > limit) this.accumulator = limit
    while (this.accumulator >= SIM.fixedStep) {
      this.#step(SIM.fixedStep)
      this.accumulator -= SIM.fixedStep
    }
  }

  acknowledgeAlarm(id) {
    const alarm = this.alarms.get(id)
    if (!alarm) return
    alarm.acknowledged = true
    bus.emit(EVENTS.ALARM_ACK, { id })
  }

  acknowledgeAll() {
    for (const id of this.alarms.keys()) this.acknowledgeAlarm(id)
  }

  reset() {
    this.reactor = new Reactor()
    this.cooling = new CoolingSystem()
    this.turbine = new Turbine()
    this.grid = new Grid()
    this.time = 0
    this.accumulator = 0
    this.alarms.clear()
    this.scramTimers.clear()
    this.state = PLANT_STATE.NORMAL
    this.incidents?.reset()
    bus.emit(EVENTS.PLANT_RESET)
    bus.emit(EVENTS.STATE_CHANGED, { state: this.state })
  }

  snapshot() {
    return {
      time: this.time,
      state: this.state,
      timeScale: this.timeScale,
      paused: this.paused,
      autoScram: this.autoScram,
      reactor: this.reactor.snapshot(),
      cooling: this.cooling.snapshot(),
      turbine: this.turbine.snapshot(),
      grid: this.grid.snapshot(),
      alarms: [...this.alarms.values()]
    }
  }

  #step(dt) {
    this.time += dt
    this.incidents?.update(dt, this.time)
    this.cooling.update(dt, {
      steamPressure: this.turbine.steamPressure,
      condenserLoad: this.turbine.condenserDemand
    })
    this.reactor.update(dt, this.cooling)
    this.turbine.update(dt, {
      steamSupply: this.reactor.steamSupply,
      condenserFactor: this.cooling.condenserFactor,
      grid: this.grid
    })
    this.grid.update(dt, {
      electricPower: this.turbine.electricPower,
      connected: this.turbine.synchronized
    })
    this.#evaluateProtection(dt)
    this.#evaluateAlarms()
    this.#evaluateState()
    bus.emit(EVENTS.TICK, { time: this.time })
  }

  #evaluateProtection(dt) {
    const view = this.#view()
    if (this.autoScram && !this.reactor.scrammed) {
      for (const trip of SCRAM_TRIPS) {
        if (trip.test(view)) {
          const elapsed = (this.scramTimers.get(trip.reason) ?? 0) + dt
          this.scramTimers.set(trip.reason, elapsed)
          if (elapsed >= SCRAM_DELAY) this.reactor.scram(trip.reason)
        } else {
          this.scramTimers.delete(trip.reason)
        }
      }
    }
    if (this.turbine.tripped && !this.reactor.scrammed && this.reactor.power > 0.6) {
      this.reactor.scram('turbine trip')
    }
  }

  #evaluateAlarms() {
    const view = this.#view()
    for (const def of ALARM_DEFS) {
      const active = def.test(view)
      const existing = this.alarms.get(def.id)
      if (active && !existing) {
        const alarm = {
          id: def.id,
          level: def.level,
          text: def.text,
          time: this.time,
          acknowledged: false
        }
        this.alarms.set(def.id, alarm)
        bus.emit(EVENTS.ALARM_RAISED, alarm)
      } else if (!active && existing) {
        this.alarms.delete(def.id)
        bus.emit(EVENTS.ALARM_CLEARED, { id: def.id })
      }
    }
  }

  #evaluateState() {
    let next = PLANT_STATE.NORMAL
    for (const alarm of this.alarms.values()) {
      if (alarm.level === ALARM_LEVEL.CRITICAL) {
        next = PLANT_STATE.EMERGENCY
        break
      }
      next = PLANT_STATE.WARNING
    }
    if (next !== this.state) {
      this.state = next
      bus.emit(EVENTS.STATE_CHANGED, { state: next })
    }
  }

  #view() {
    return {
      reactor: this.reactor,
      cooling: this.cooling,
      turbine: this.turbine,
      grid: this.grid
    }
  }
}
