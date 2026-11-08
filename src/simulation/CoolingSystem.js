import { COOLING, REACTOR } from './constants.js'
import { clamp, damp } from '../utils/math.js'

const TUNING = Object.freeze({
  makeupRate: 0.002,
  injectionRate: 0.012,
  tankDrain: 0.004,
  tankRefill: 0.001,
  eccsRelease: 0.9,
  fanRate: 0.12,
  fanMin: 0.2,
  fanMargin: 1.15,
  loadEpsilon: 0.01,
  inletRate: 0.12,
  inletPerPressure: 120,
  inletMin: 240,
  inletMax: 340,
  maxDegradation: 0.9
})

export class CoolingSystem {
  constructor() {
    this.pumps = Array.from({ length: COOLING.pumpCount }, (_, id) => ({
      id,
      commanded: true,
      failed: false,
      speed: 1
    }))
    this.flow = 1
    this.level = COOLING.coolantLevelNominal
    this.leakRate = 0
    this.makeupAvailable = true
    this.eccsAvailable = true
    this.eccsAuto = true
    this.eccsLatched = false
    this.manualInjection = false
    this.injecting = false
    this.tank = 1
    this.fanAuto = true
    this.fanSetpoint = 0.72
    this.fanSpeed = 0.72
    this.towerDegradation = 0
    this.capacity = this.fanSpeed * COOLING.towerEfficiency
    this.condenserFactor = 1
    this.inletTemp = REACTOR.coolantTempInlet
  }

  setPump(index, on) {
    const pump = this.pumps[index]
    if (!pump) return false
    if (on && pump.failed) return false
    pump.commanded = Boolean(on)
    return true
  }

  setAllPumps(on) {
    for (const pump of this.pumps) {
      if (!(on && pump.failed)) pump.commanded = Boolean(on)
    }
  }

  failPump(index) {
    const pump = this.pumps[index]
    if (!pump) return false
    pump.failed = true
    pump.commanded = false
    return true
  }

  repairPump(index) {
    const pump = this.pumps[index]
    if (!pump) return false
    pump.failed = false
    return true
  }

  setFanAuto(enabled) {
    this.fanAuto = Boolean(enabled)
    if (!this.fanAuto) this.fanSetpoint = this.fanSpeed
  }

  setFanSetpoint(value) {
    this.fanSetpoint = clamp(value, 0, 1)
  }

  setTowerDegradation(value) {
    this.towerDegradation = clamp(value, 0, TUNING.maxDegradation)
  }

  setInjection(on) {
    this.manualInjection = Boolean(on)
  }

  setLeak(rate) {
    this.leakRate = Math.max(0, rate)
  }

  update(dt, { steamPressure, condenserLoad }) {
    this.#updatePumps(dt)
    this.#updateInventory(dt)
    this.#updateTower(dt, condenserLoad)
    this.#updateInlet(dt, steamPressure)
  }

  snapshot() {
    return {
      pumps: this.pumps.map(({ id, commanded, failed, speed }) => ({
        id,
        commanded,
        failed,
        speed,
        flowRate: speed * COOLING.pumpNominalFlow
      })),
      flow: this.flow,
      level: this.level,
      leakRate: this.leakRate,
      injecting: this.injecting,
      manualInjection: this.manualInjection,
      eccsAvailable: this.eccsAvailable,
      tank: this.tank,
      fanAuto: this.fanAuto,
      fanSpeed: this.fanSpeed,
      fanSetpoint: this.fanSetpoint,
      capacity: this.capacity,
      condenserFactor: this.condenserFactor,
      towerDegradation: this.towerDegradation,
      inletTemp: this.inletTemp
    }
  }

  #updatePumps(dt) {
    let total = 0
    for (const pump of this.pumps) {
      const target = pump.commanded && !pump.failed ? 1 : 0
      const rate = target > pump.speed ? COOLING.pumpSpinUpRate : COOLING.pumpSpinDownRate
      pump.speed = damp(pump.speed, target, rate, dt)
      if (pump.speed < 0.001) pump.speed = 0
      total += pump.speed
    }
    this.flow = total / this.pumps.length
  }

  #updateInventory(dt) {
    if (this.eccsAuto && this.level < COOLING.coolantLevelCritical) this.eccsLatched = true
    if (this.level >= TUNING.eccsRelease) this.eccsLatched = false
    const demanded = this.manualInjection || this.eccsLatched
    this.injecting = demanded && this.eccsAvailable && this.tank > 0 && this.level < 1
    const injection = this.injecting ? TUNING.injectionRate : 0
    const makeup = this.makeupAvailable && this.level < 1 ? TUNING.makeupRate : 0
    const tankChange = this.injecting ? -TUNING.tankDrain : TUNING.tankRefill
    this.tank = clamp(this.tank + tankChange * dt, 0, 1)
    this.level = clamp(this.level + (makeup + injection - this.leakRate) * dt, 0, 1)
  }

  #updateTower(dt, condenserLoad) {
    const unit = COOLING.towerEfficiency * (1 - this.towerDegradation)
    let target = this.fanSetpoint
    if (this.fanAuto) {
      target = unit > 0 ? clamp((condenserLoad / unit) * TUNING.fanMargin, TUNING.fanMin, 1) : 1
    }
    this.fanSpeed = damp(this.fanSpeed, target, TUNING.fanRate, dt)
    this.capacity = this.fanSpeed * unit
    this.condenserFactor =
      condenserLoad > TUNING.loadEpsilon ? clamp(this.capacity / condenserLoad, 0, 1) : 1
  }

  #updateInlet(dt, steamPressure) {
    const target = clamp(
      REACTOR.coolantTempInlet + TUNING.inletPerPressure * (steamPressure - 1),
      TUNING.inletMin,
      TUNING.inletMax
    )
    this.inletTemp = damp(this.inletTemp, target, TUNING.inletRate, dt)
  }
}