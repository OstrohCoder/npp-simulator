import { GRID, REACTOR } from './constants.js'
import { clamp, damp, randomRange } from '../utils/math.js'

const TUNING = Object.freeze({
  hzPerUnit: 2.5,
  deviationLimit: 3,
  deviationRate: 1.5,
  frequencyRate: 3,
  collapseRate: 1.5,
  jitterRate: 4,
  jitterAmplitude: 0.015,
  noiseRelax: 0.2,
  noiseDrive: 60,
  noiseLimit: 40,
  biasRate: 0.5,
  minDemand: 100,
  maxDemand: 1200
})

export class Grid {
  constructor() {
    this.time = 0
    this.available = true
    this.outageRemaining = 0
    this.demand = GRID.baseDemand
    this.frequency = GRID.nominalFrequency
    this.deviation = 0
    this.jitter = 0
    this.noise = 0
    this.bias = 0
    this.biasTarget = 0
    this.biasRemaining = 0
    this.delivered = 0
  }

  get frequencyOk() {
    return this.available && Math.abs(this.frequency - GRID.nominalFrequency) <= GRID.frequencyTolerance
  }

  lose(duration = Infinity) {
    this.available = false
    this.outageRemaining = duration
  }

  restore() {
    this.available = true
    this.outageRemaining = 0
  }

  surge(megawatts, duration) {
    this.biasTarget = megawatts
    this.biasRemaining = duration
  }

  update(dt, { electricPower, connected }) {
    this.time += dt
    this.#updateOutage(dt)
    this.#updateDemand(dt)
    this.#updateFrequency(dt, electricPower, connected)
    if (connected && this.available) {
      this.delivered += (electricPower * dt) / 3600
    }
  }

  snapshot() {
    return {
      available: this.available,
      outageRemaining: this.outageRemaining,
      demand: this.demand,
      frequency: this.frequency,
      delivered: this.delivered
    }
  }

  #updateOutage(dt) {
    if (this.available || !Number.isFinite(this.outageRemaining)) return
    this.outageRemaining -= dt
    if (this.outageRemaining <= 0) this.restore()
  }

  #updateDemand(dt) {
    if (this.biasRemaining > 0) {
      this.biasRemaining -= dt
      if (this.biasRemaining <= 0) this.biasTarget = 0
    }
    this.bias = damp(this.bias, this.biasTarget, TUNING.biasRate, dt)
    const cycle = GRID.demandSwing * Math.sin((2 * Math.PI * this.time) / GRID.demandPeriod)
    const drift = -this.noise * TUNING.noiseRelax + randomRange(-1, 1) * TUNING.noiseDrive
    this.noise = clamp(this.noise + drift * dt, -TUNING.noiseLimit, TUNING.noiseLimit)
    this.demand = clamp(
      GRID.baseDemand + cycle + this.noise + this.bias,
      TUNING.minDemand,
      TUNING.maxDemand
    )
  }

  #updateFrequency(dt, electricPower, connected) {
    const mismatch = connected ? (electricPower - this.demand) / REACTOR.nominalElectricPower : 0
    const deviationTarget = clamp(
      mismatch * TUNING.hzPerUnit,
      -TUNING.deviationLimit,
      TUNING.deviationLimit
    )
    this.deviation = damp(this.deviation, deviationTarget, TUNING.deviationRate, dt)
    this.jitter = damp(
      this.jitter,
      randomRange(-TUNING.jitterAmplitude, TUNING.jitterAmplitude),
      TUNING.jitterRate,
      dt
    )
    const target = this.available ? GRID.nominalFrequency + this.deviation + this.jitter : 0
    const rate = this.available ? TUNING.frequencyRate : TUNING.collapseRate
    this.frequency = damp(this.frequency, target, rate, dt)
  }
}