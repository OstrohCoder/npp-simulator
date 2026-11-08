import { Group } from 'three'
import { LAYOUT, SITE, SIZES } from '../layout.js'
import { SteamPlume } from '../SteamPlume.js'
import { EVENTS } from '../../simulation/constants.js'
import { bus } from '../../utils/events.js'
import { clamp, damp, smoothstep } from '../../utils/math.js'

const LEAK_FULL = 0.03
const OUTAGE_FLICKER = 1.4
const EMERGENCY_LEVEL = 0.3
const TRIP_SHAKE_REASONS = Object.freeze(['overspeed', 'vibration'])

export class AccidentEffects {
  constructor(engine, { turbineHall, controlRoom }) {
    this.engine = engine
    this.group = new Group()
    this.level = 1
    this.outage = 0

    this.leak = new SteamPlume({
      count: 100,
      radius: 1.4,
      size: 11,
      rise: 13,
      lifetime: 7,
      wind: [3, 0, 1.5],
      spread: 1.1,
      opacity: 0.8
    })
    this.leak.points.position.set(
      LAYOUT.reactor.x - 28,
      SITE.padHeight + 21,
      LAYOUT.reactor.z
    )

    this.smoke = new SteamPlume({
      count: 120,
      radius: 2,
      size: 14,
      rise: 9,
      lifetime: 12,
      wind: [3.5, 0, 1.4],
      spread: 1.4,
      color: 0x2b2d30,
      opacity: 0.75
    })
    this.smoke.points.position.set(
      LAYOUT.turbineHall.x + 4,
      SITE.padHeight + SIZES.turbineHall.height + 1,
      LAYOUT.turbineHall.z - 4
    )

    this.group.add(this.leak.points, this.smoke.points)

    this.lights = []
    for (const building of [turbineHall, controlRoom]) {
      building.group.traverse((object) => {
        if (object.isPointLight) this.lights.push({ light: object, base: object.intensity })
      })
    }

    this.unsubscribe = bus.on(EVENTS.TURBINE_TRIP, ({ reason }) => {
      if (TRIP_SHAKE_REASONS.includes(reason)) this.engine.shake(0.35)
    })
  }

  update(delta, elapsed, { cooling, turbine, grid }, view) {
    this.leak.update(delta, clamp(cooling.leakRate / LEAK_FULL, 0, 1), view.pixelScale)
    this.smoke.update(delta, smoothstep(0.55, 0.9, turbine.vibration), view.pixelScale)
    this.#updateLights(delta, elapsed, grid.available)
  }

  destroy() {
    this.unsubscribe()
  }

  #updateLights(delta, elapsed, available) {
    if (available) {
      this.outage = 0
      this.level = damp(this.level, 1, 3, delta)
    } else {
      this.outage += delta
      if (this.outage < OUTAGE_FLICKER) {
        this.level = Math.sin(elapsed * 47) * Math.sin(elapsed * 31) > 0 ? 0.85 : 0.04
      } else {
        this.level = damp(this.level, EMERGENCY_LEVEL, 4, delta)
      }
    }
    for (const { light, base } of this.lights) light.intensity = base * this.level
  }
}
