import { GRID, REACTOR, TURBINE, EVENTS } from './constants.js'
import { bus } from '../utils/events.js'
import { approach, clamp, damp, smoothstep } from '../utils/math.js'

const TUNING = Object.freeze({
  idleValve: 0.06,
  valveRiseRate: 0.08,
  valveFallRate: 0.15,
  governorRate: 1.5,
  tripValveRate: 3,
  pressureRate: 0.3,
  pressureMin: 0.05,
  pressureMax: 1.6,
  minSteamPressure: 0.3,
  bypassCapacity: 0.4,
  bypassOpenFrom: 1.05,
  bypassOpenTo: 1.15,
  bypassLag: 1.5,
  reliefCapacity: 0.3,
  reliefOpenFrom: 1.22,
  reliefOpenTo: 1.35,
  overspeedGain: 1.2,
  syncWindow: 30,
  restartRpm: 600,
  vibrationBase: 0.05,
  vibrationLoad: 0.12,
  vibrationOverspeed: 6,
  vibrationLag: 0.5,
  vibrationTrip: 0.85
})

export class Turbine {
  constructor(initialLoad = 800) {
    const flow = initialLoad / REACTOR.nominalElectricPower
    this.running = true
    this.tripped = false
    this.tripReason = null
    this.synchronized = true
    this.rpm = TURBINE.nominalRpm
    this.loadSetpoint = initialLoad
    this.valve = flow
    this.steamPressure = 1
    this.steamFlow = flow
    this.bypassOpening = 0
    this.bypassFlow = 0
    this.reliefOpening = 0
    this.condenserDemand = flow * (1 - TURBINE.efficiency)
    this.electricPower = initialLoad
    this.vibration = TUNING.vibrationBase + TUNING.vibrationLoad * flow
    this.governorFault = false
    this.bearingFault = 0
    this.bypassAvailable = true
  }

  setLoad(megawatts) {
    this.loadSetpoint = clamp(megawatts, 0, REACTOR.nominalElectricPower * 1.05)
  }

  start() {
    if (this.tripped) return false
    this.running = true
    return true
  }

  stop() {
    this.running = false
    this.synchronized = false
  }

  synchronize(grid) {
    if (!this.running || this.tripped || this.synchronized) return false
    if (!grid.available || !grid.frequencyOk) return false
    if (Math.abs(this.rpm - TURBINE.nominalRpm) > TUNING.syncWindow) return false
    this.synchronized = true
    return true
  }

  openBreaker() {
    this.synchronized = false
  }

  trip(reason = 'manual') {
    if (this.tripped) return false
    this.tripped = true
    this.tripReason = reason
    this.running = false
    this.synchronized = false
    bus.emit(EVENTS.TURBINE_TRIP, { reason })
    return true
  }

  resetTrip() {
    if (!this.tripped || this.rpm > TUNING.restartRpm) return false
    this.tripped = false
    this.tripReason = null
    this.running = false
    return true
  }

  setGovernorFault(enabled) {
    this.governorFault = Boolean(enabled)
  }

  setBearingFault(level) {
    this.bearingFault = clamp(level, 0, 1)
  }

  setBypassAvailable(enabled) {
    this.bypassAvailable = Boolean(enabled)
  }

  update(dt, { steamSupply, condenserFactor, grid }) {
    this.#updateValve(dt)
    this.#updateSteam(dt, steamSupply, condenserFactor)
    this.#updateRotor(dt, grid)
    this.#updateVibration(dt)
    this.#protect()
  }

  snapshot() {
    return {
      running: this.running,
      tripped: this.tripped,
      tripReason: this.tripReason,
      synchronized: this.synchronized,
      rpm: this.rpm,
      loadSetpoint: this.loadSetpoint,
      valve: this.valve,
      steamPressure: this.steamPressure,
      steamFlow: this.steamFlow,
      bypassOpening: this.bypassOpening,
      reliefOpening: this.reliefOpening,
      electricPower: this.electricPower,
      condenserDemand: this.condenserDemand,
      vibration: this.vibration,
      governorFault: this.governorFault,
      bypassAvailable: this.bypassAvailable
    }
  }

  #valveTarget() {
    if (this.tripped || !this.running) return 0
    const demand = this.synchronized
      ? this.loadSetpoint / REACTOR.nominalElectricPower
      : TUNING.idleValve
    if (this.governorFault || this.synchronized) return demand
    const margin = clamp(
      (TURBINE.tripRpm - this.rpm) / (TURBINE.tripRpm - TURBINE.nominalRpm),
      0,
      1
    )
    return demand * margin
  }

  #updateValve(dt) {
    const target = this.#valveTarget()
    let rate = target < this.valve ? TUNING.valveFallRate : TUNING.valveRiseRate
    if (this.tripped) rate = TUNING.tripValveRate
    else if (!this.synchronized && !this.governorFault) rate = TUNING.governorRate
    this.valve = approach(this.valve, target, rate * dt)
  }

  #updateSteam(dt, supply, condenserFactor) {
    const pressure = this.steamPressure
    const turbineRaw = this.valve * pressure
    const bypassWanted = this.bypassAvailable
      ? smoothstep(TUNING.bypassOpenFrom, TUNING.bypassOpenTo, pressure)
      : 0
    this.bypassOpening = damp(this.bypassOpening, bypassWanted, TUNING.bypassLag, dt)
    const bypassRaw = this.bypassOpening * TUNING.bypassCapacity * pressure
    this.reliefOpening = smoothstep(TUNING.reliefOpenFrom, TUNING.reliefOpenTo, pressure)
    const reliefFlow = this.reliefOpening * TUNING.reliefCapacity * pressure

    this.condenserDemand = turbineRaw * (1 - TURBINE.efficiency) + bypassRaw
    this.steamFlow = turbineRaw * condenserFactor
    this.bypassFlow = bypassRaw * condenserFactor

    const consumption = this.steamFlow + this.bypassFlow + reliefFlow
    this.steamPressure = clamp(
      pressure + TUNING.pressureRate * (supply - consumption) * dt,
      TUNING.pressureMin,
      TUNING.pressureMax
    )
  }

  #targetRpm(grid) {
    if (this.tripped || !this.running || this.steamPressure < TUNING.minSteamPressure) return 0
    if (this.synchronized) return (TURBINE.nominalRpm * grid.frequency) / GRID.nominalFrequency
    if (this.governorFault) return TURBINE.nominalRpm * (1 + TUNING.overspeedGain * this.valve)
    return TURBINE.nominalRpm
  }

  #updateRotor(dt, grid) {
    if (this.synchronized && (this.tripped || !grid.available)) this.synchronized = false
    const target = this.#targetRpm(grid)
    if (this.synchronized) {
      this.rpm = target
    } else {
      const rate = target > this.rpm ? TURBINE.spinUpRate : TURBINE.spinDownRate
      this.rpm = damp(this.rpm, target, rate, dt)
      if (this.rpm < 1) this.rpm = 0
    }
    this.electricPower = this.synchronized ? this.steamFlow * REACTOR.nominalElectricPower : 0
  }

  #updateVibration(dt) {
    const speed = this.rpm / TURBINE.nominalRpm
    const spinning = speed > 0.05
    const target = spinning
      ? TUNING.vibrationBase +
        TUNING.vibrationLoad * this.steamFlow +
        TUNING.vibrationOverspeed * Math.max(0, speed - 1.01) +
        this.bearingFault * speed
      : 0
    this.vibration = clamp(damp(this.vibration, target, TUNING.vibrationLag, dt), 0, 1)
  }

  #protect() {
    if (this.tripped) return
    if (this.rpm >= TURBINE.tripRpm) this.trip('overspeed')
    else if (this.vibration >= TUNING.vibrationTrip) this.trip('vibration')
    else if (this.running && this.steamPressure < TUNING.minSteamPressure) this.trip('steam pressure')
  }
}