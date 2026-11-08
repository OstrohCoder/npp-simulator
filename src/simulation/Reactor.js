import { REACTOR, EVENTS } from './constants.js'
import { bus } from '../utils/events.js'
import { approach, clamp, damp, inverseLerp, smoothstep } from '../utils/math.js'

const FUEL_DELTA = REACTOR.fuelTempNominal - REACTOR.coolantTempNominal
const COOLANT_RISE = REACTOR.coolantTempNominal - REACTOR.coolantTempInlet
const ROD_BALANCE = 0.5

const TUNING = Object.freeze({
  rodWorth: 0.08,
  coolantCoef: -0.0002,
  fuelCoef: -0.00001,
  xenonWorth: 0.03,
  boronWorth: 0.05,
  levelWorth: 0.03,
  kineticsGain: 6,
  powerFloor: 0.0001,
  powerCeiling: 3,
  rateSmoothing: 6,
  rodGain: 0.4,
  rodDamping: 1,
  setpointMax: 1.05,
  decayFraction: 0.065,
  decayBuildRate: 0.05,
  decayFadeRate: 0.004,
  coolantRate: 0.2,
  fuelRate: 0.125,
  naturalCirculation: 0.08,
  flowCeiling: 1.3,
  coverageLow: 0.12,
  coverageHigh: 0.5,
  minCoverage: 0.008,
  pressurePerKelvin: 0.08,
  pressureRate: 0.25,
  pressureCeiling: 25,
  inventoryLoss: 0.45,
  xenonYield: 0.004,
  xenonDecay: 0.003,
  xenonBurn: 0.006,
  boronRate: 0.004,
  boronFastRate: 0.02,
  emergencyBoron: 0.6
})

function xenonEquilibrium(power) {
  return (TUNING.xenonYield * power) / (TUNING.xenonDecay + TUNING.xenonBurn * power)
}

export class Reactor {
  constructor(initialPower = 0.8) {
    this.mode = 'auto'
    this.power = initialPower
    this.powerRate = 0
    this.powerSetpoint = initialPower
    this.rodInsertion = ROD_BALANCE
    this.rodTarget = ROD_BALANCE
    this.rodFault = null
    this.boron = 0
    this.boronTarget = 0
    this.reactivity = 0
    this.decayHeat = initialPower * TUNING.decayFraction
    this.xenon = xenonEquilibrium(initialPower)
    this.coolantTemp = REACTOR.coolantTempInlet + initialPower * COOLANT_RISE
    this.fuelTemp = this.coolantTemp + initialPower * FUEL_DELTA
    this.pressure = REACTOR.pressureNominal
    this.transfer = initialPower
    this.fuelDamage = 0
    this.scrammed = false
    this.scramReason = null
    this.meltdown = false
    this.reference = {
      coolantTemp: this.coolantTemp,
      fuelTemp: this.fuelTemp,
      xenon: this.xenon
    }
  }

  get heatFraction() {
    return this.power * (1 - TUNING.decayFraction) + this.decayHeat
  }

  get thermalPower() {
    return this.heatFraction * REACTOR.nominalThermalPower
  }

  get steamSupply() {
    return this.transfer
  }

  setMode(mode) {
    if (mode === 'manual') {
      this.mode = 'manual'
      this.rodTarget = this.rodInsertion
      return true
    }
    if (mode !== 'auto') return false
    if (this.scrammed || this.rodFault || this.power < REACTOR.minPowerFraction) return false
    this.mode = 'auto'
    this.powerSetpoint = clamp(this.power, REACTOR.minPowerFraction, TUNING.setpointMax)
    return true
  }

  setPowerSetpoint(value) {
    this.powerSetpoint = clamp(value, REACTOR.minPowerFraction, TUNING.setpointMax)
  }

  setRodTarget(value) {
    this.rodTarget = clamp(value, 0, 1)
  }

  setBoronTarget(value) {
    this.boronTarget = clamp(value, 0, 1)
  }

  setRodFault(type) {
    if (type !== 'stuck' && type !== 'runaway') return false
    this.rodFault = type
    this.mode = 'manual'
    return true
  }

  clearRodFault() {
    this.rodFault = null
    this.rodTarget = this.rodInsertion
  }

  scram(reason = 'manual') {
    if (this.scrammed) return false
    this.scrammed = true
    this.scramReason = reason
    this.mode = 'manual'
    this.rodTarget = 1
    bus.emit(EVENTS.SCRAM, { reason })
    return true
  }

  resetScram() {
    if (!this.scrammed || this.meltdown) return false
    if (this.power > REACTOR.minPowerFraction) return false
    if (this.coolantTemp >= REACTOR.coolantTempWarning) return false
    this.scrammed = false
    this.scramReason = null
    this.mode = 'manual'
    this.rodTarget = this.rodInsertion
    return true
  }

  update(dt, cooling) {
    this.#updateRods(dt)
    this.#updateBoron(dt, cooling.injecting)
    this.reactivity = this.#computeReactivity(cooling.level)
    this.#updatePower(dt)
    this.#updateDecayHeat(dt)
    this.#updateThermal(dt, cooling.flow, cooling.inletTemp, cooling.level)
    this.#updateXenon(dt)
    this.#updatePressure(dt, cooling.level)
    this.#updateDamage()
  }

  snapshot() {
    return {
      mode: this.mode,
      power: this.power,
      thermalPower: this.thermalPower,
      powerSetpoint: this.powerSetpoint,
      rodInsertion: this.rodInsertion,
      rodTarget: this.rodTarget,
      rodFault: this.rodFault,
      boron: this.boron,
      boronTarget: this.boronTarget,
      reactivity: this.reactivity,
      coolantTemp: this.coolantTemp,
      fuelTemp: this.fuelTemp,
      pressure: this.pressure,
      xenon: this.xenon,
      decayHeat: this.decayHeat,
      fuelDamage: this.fuelDamage,
      scrammed: this.scrammed,
      scramReason: this.scramReason,
      meltdown: this.meltdown
    }
  }

  #updateRods(dt) {
    if (this.scrammed) {
      if (this.rodFault !== 'stuck') {
        this.rodInsertion = approach(this.rodInsertion, 1, REACTOR.scramRodSpeed * dt)
      }
      return
    }
    if (this.rodFault === 'stuck') return
    if (this.rodFault === 'runaway') {
      this.rodInsertion = approach(this.rodInsertion, 0, REACTOR.rodSpeed * dt)
      return
    }
    if (this.mode === 'auto') {
      const demand =
        TUNING.rodGain * (this.powerSetpoint - this.power) - TUNING.rodDamping * this.powerRate
      const withdraw = clamp(demand, -REACTOR.rodSpeed, REACTOR.rodSpeed)
      this.rodInsertion = clamp(this.rodInsertion - withdraw * dt, 0, 1)
      return
    }
    this.rodInsertion = approach(this.rodInsertion, this.rodTarget, REACTOR.rodSpeed * dt)
  }

  #updateBoron(dt, injecting) {
    const emergency = injecting || (this.scrammed && this.rodFault === 'stuck')
    const target = emergency ? Math.max(this.boronTarget, TUNING.emergencyBoron) : this.boronTarget
    const rate = emergency ? TUNING.boronFastRate : TUNING.boronRate
    this.boron = approach(this.boron, target, rate * dt)
  }

  #computeReactivity(level) {
    const rods = TUNING.rodWorth * (ROD_BALANCE - this.rodInsertion)
    const coolant = TUNING.coolantCoef * (this.coolantTemp - this.reference.coolantTemp)
    const fuel = TUNING.fuelCoef * (this.fuelTemp - this.reference.fuelTemp)
    const xenon = -TUNING.xenonWorth * (this.xenon - this.reference.xenon)
    const boron = -TUNING.boronWorth * this.boron
    const inventory = -TUNING.levelWorth * (1 - level)
    return rods + coolant + fuel + xenon + boron + inventory
  }

  #updatePower(dt) {
    const previous = this.power
    const growth = this.reactivity * TUNING.kineticsGain
    this.power = clamp(previous * Math.exp(growth * dt), TUNING.powerFloor, TUNING.powerCeiling)
    this.powerRate = damp(this.powerRate, (this.power - previous) / dt, TUNING.rateSmoothing, dt)
  }

  #updateDecayHeat(dt) {
    const source = this.power * TUNING.decayFraction
    const rate = source > this.decayHeat ? TUNING.decayBuildRate : TUNING.decayFadeRate
    this.decayHeat = damp(this.decayHeat, source, rate, dt)
  }

  #updateThermal(dt, flow, inletTemp, level) {
    const coverage = smoothstep(TUNING.coverageLow, TUNING.coverageHigh, level)
    const conductance = Math.max(coverage, TUNING.minCoverage)
    const circulation = clamp(
      flow * smoothstep(0.2, 0.8, level),
      TUNING.naturalCirculation,
      TUNING.flowCeiling
    )
    this.transfer = Math.max(0, ((this.fuelTemp - this.coolantTemp) * conductance) / FUEL_DELTA)
    const coolantTarget = inletTemp + (this.transfer * COOLANT_RISE) / circulation
    this.coolantTemp = damp(this.coolantTemp, coolantTarget, TUNING.coolantRate, dt)
    const fuelTarget = this.coolantTemp + (this.heatFraction * FUEL_DELTA) / conductance
    this.fuelTemp = damp(this.fuelTemp, fuelTarget, TUNING.fuelRate, dt)
  }

  #updateXenon(dt) {
    const production = TUNING.xenonYield * this.power
    const removal = (TUNING.xenonDecay + TUNING.xenonBurn * this.power) * this.xenon
    this.xenon = Math.max(0, this.xenon + (production - removal) * dt)
  }

  #updatePressure(dt, level) {
    const thermal = (this.coolantTemp - this.reference.coolantTemp) * TUNING.pressurePerKelvin
    const inventory = 1 - TUNING.inventoryLoss * (1 - level)
    const target = clamp(
      (REACTOR.pressureNominal + thermal) * inventory,
      0.1,
      TUNING.pressureCeiling
    )
    this.pressure = damp(this.pressure, target, TUNING.pressureRate, dt)
  }

  #updateDamage() {
    const stress = inverseLerp(REACTOR.fuelTempWarning, REACTOR.fuelTempMeltdown, this.fuelTemp)
    this.fuelDamage = Math.max(this.fuelDamage, stress)
    if (this.fuelTemp >= REACTOR.fuelTempMeltdown && !this.meltdown) {
      this.meltdown = true
      bus.emit(EVENTS.MELTDOWN)
    }
  }
}