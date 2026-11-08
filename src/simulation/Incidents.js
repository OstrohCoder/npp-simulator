import { EVENTS } from './constants.js'
import { bus } from '../utils/events.js'
import { randomRange } from '../utils/math.js'

const CATALOG = Object.freeze({
  pumpFailure: {
    title: 'Відмова циркуляційного насоса',
    description: 'Один із головних насосів зупинився через пошкодження підшипника.',
    duration: 90,
    start(plant) {
      const healthy = plant.cooling.pumps.filter((p) => !p.failed)
      if (healthy.length === 0) return false
      const pump = healthy[Math.floor(Math.random() * healthy.length)]
      plant.cooling.failPump(pump.id)
      return { pump: pump.id }
    },
    end(plant, context) {
      plant.cooling.repairPump(context.pump)
    }
  },
  multiplePumpFailure: {
    title: 'Відмова групи насосів',
    description: 'Знеструмлення секції: одночасно втрачено три насоси.',
    duration: 150,
    start(plant) {
      const healthy = plant.cooling.pumps.filter((p) => !p.failed)
      if (healthy.length < 3) return false
      const failed = healthy.slice(0, 3).map((p) => p.id)
      failed.forEach((id) => plant.cooling.failPump(id))
      return { pumps: failed }
    },
    end(plant, context) {
      context.pumps.forEach((id) => plant.cooling.repairPump(id))
    }
  },
  coolantLeak: {
    title: 'Витік теплоносія',
    description: 'Розгерметизація імпульсної лінії першого контуру.',
    duration: 120,
    start(plant) {
      plant.cooling.setLeak(randomRange(0.006, 0.01))
      return {}
    },
    end(plant) {
      plant.cooling.setLeak(0)
    }
  },
  lossOfCoolantAccident: {
    title: 'Велика течa першого контуру',
    description: 'Розрив трубопроводу головного циркуляційного контуру.',
    duration: 180,
    start(plant) {
      plant.cooling.setLeak(0.03)
      return {}
    },
    end(plant) {
      plant.cooling.setLeak(0)
    }
  },
  eccsFailure: {
    title: 'Відмова системи аварійного охолодження',
    description: 'Насоси аварійного впорскування недоступні.',
    duration: 240,
    start(plant) {
      plant.cooling.eccsAvailable = false
      return {}
    },
    end(plant) {
      plant.cooling.eccsAvailable = true
    }
  },
  rodStuck: {
    title: 'Заклинювання стрижнів керування',
    description: 'Привід стрижнів не реагує на команди оператора.',
    duration: 120,
    start(plant) {
      return plant.reactor.setRodFault('stuck') ? {} : false
    },
    end(plant) {
      plant.reactor.clearRodFault()
    }
  },
  rodRunaway: {
    title: 'Мимовільне витягування стрижнів',
    description: 'Збій системи керування: стрижні повільно виходять із зони.',
    duration: 60,
    start(plant) {
      return plant.reactor.setRodFault('runaway') ? {} : false
    },
    end(plant) {
      plant.reactor.clearRodFault()
    }
  },
  gridLoss: {
    title: 'Втрата зовнішньої мережі',
    description: 'Лінія електропередачі відключена, блок працює на власні потреби.',
    duration: 60,
    start(plant) {
      plant.grid.lose(Infinity)
      return {}
    },
    end(plant) {
      plant.grid.restore()
    }
  },
  gridSurge: {
    title: 'Стрибок споживання',
    description: 'Раптове зростання навантаження в енергосистемі.',
    duration: 45,
    start(plant) {
      plant.grid.surge(220, 45)
      return {}
    },
    end() {}
  },
  governorFailure: {
    title: 'Збій регулятора турбіни',
    description: 'Регулятор оборотів не утримує задане значення.',
    duration: 90,
    start(plant) {
      plant.turbine.setGovernorFault(true)
      return {}
    },
    end(plant) {
      plant.turbine.setGovernorFault(false)
    }
  },
  bearingWear: {
    title: 'Знос підшипників турбіни',
    description: 'Зростає вібрація ротора турбогенератора.',
    duration: 150,
    start(plant) {
      plant.turbine.setBearingFault(0.55)
      return {}
    },
    end(plant) {
      plant.turbine.setBearingFault(0)
    }
  },
  bypassFailure: {
    title: 'Відмова скидної установки',
    description: 'Швидкодіючий редукційний пристрій заблоковано.',
    duration: 180,
    start(plant) {
      plant.turbine.setBypassAvailable(false)
      return {}
    },
    end(plant) {
      plant.turbine.setBypassAvailable(true)
    }
  },
  towerDegradation: {
    title: 'Деградація градирні',
    description: 'Забруднення зрошувача знижує тепловіддачу.',
    duration: 180,
    start(plant) {
      plant.cooling.setTowerDegradation(0.55)
      return {}
    },
    end(plant) {
      plant.cooling.setTowerDegradation(0)
    }
  }
})

export const INCIDENT_IDS = Object.freeze(Object.keys(CATALOG))

export function describeIncident(id) {
  const entry = CATALOG[id]
  return entry ? { id, title: entry.title, description: entry.description } : null
}

export class Incidents {
  constructor(plant) {
    this.plant = plant
    this.active = new Map()
    this.history = []
    this.randomEnabled = false
    this.nextRandomAt = Infinity
  }

  list() {
    return INCIDENT_IDS.map((id) => ({
      ...describeIncident(id),
      active: this.active.has(id)
    }))
  }

  trigger(id) {
    const entry = CATALOG[id]
    if (!entry || this.active.has(id)) return false
    const context = entry.start(this.plant)
    if (context === false) return false
    this.active.set(id, {
      context,
      endsAt: this.plant.time + entry.duration
    })
    this.history.push({ id, time: this.plant.time })
    bus.emit(EVENTS.INCIDENT_STARTED, describeIncident(id))
    return true
  }

  resolve(id) {
    const incident = this.active.get(id)
    if (!incident) return false
    CATALOG[id].end(this.plant, incident.context)
    this.active.delete(id)
    bus.emit(EVENTS.INCIDENT_RESOLVED, describeIncident(id))
    return true
  }

  resolveAll() {
    for (const id of [...this.active.keys()]) this.resolve(id)
  }

  setRandom(enabled) {
    this.randomEnabled = Boolean(enabled)
    this.#scheduleRandom()
  }

  reset() {
    this.active.clear()
    this.history.length = 0
    this.#scheduleRandom()
  }

  update(dt, time) {
    for (const [id, incident] of this.active) {
      if (time >= incident.endsAt) this.resolve(id)
    }
    if (this.randomEnabled && time >= this.nextRandomAt) {
      this.#triggerRandom()
      this.#scheduleRandom()
    }
  }

  #scheduleRandom() {
    this.nextRandomAt = this.randomEnabled
      ? this.plant.time + randomRange(60, 180)
      : Infinity
  }

  #triggerRandom() {
    const candidates = INCIDENT_IDS.filter((id) => !this.active.has(id))
    if (candidates.length === 0) return
    const id = candidates[Math.floor(Math.random() * candidates.length)]
    this.trigger(id)
  }
}
