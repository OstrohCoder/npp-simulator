export const SIM = Object.freeze({
  fixedStep: 1 / 30,
  maxFrameDelta: 0.1,
  defaultTimeScale: 1,
  timeScales: [1, 2, 4, 8]
})

export const PLANT_STATE = Object.freeze({
  NORMAL: 'normal',
  WARNING: 'warning',
  EMERGENCY: 'emergency'
})

export const ALARM_LEVEL = Object.freeze({
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical'
})

export const REACTOR = Object.freeze({
  nominalThermalPower: 3000,
  nominalElectricPower: 1000,
  coolantTempInlet: 290,
  coolantTempNominal: 320,
  coolantTempWarning: 335,
  coolantTempScram: 350,
  pressureNominal: 15.7,
  pressureWarning: 17.0,
  pressureScram: 18.2,
  pressureLow: 13.5,
  fuelTempNominal: 900,
  fuelTempWarning: 1500,
  fuelTempMeltdown: 2200,
  ambientTemp: 25,
  rodSpeed: 0.03,
  scramRodSpeed: 0.35,
  minPowerFraction: 0.02
})

export const COOLING = Object.freeze({
  pumpCount: 4,
  pumpNominalFlow: 4500,
  pumpSpinUpRate: 0.25,
  pumpSpinDownRate: 0.15,
  minSafeFlowFraction: 0.5,
  coolantLevelNominal: 1,
  coolantLevelWarning: 0.7,
  coolantLevelCritical: 0.4,
  towerEfficiency: 0.85
})

export const TURBINE = Object.freeze({
  nominalRpm: 3000,
  maxRpm: 3300,
  tripRpm: 3150,
  spinUpRate: 0.2,
  spinDownRate: 0.05,
  steamPressureNominal: 6.4,
  efficiency: 0.333
})

export const GRID = Object.freeze({
  nominalFrequency: 50,
  frequencyTolerance: 0.5,
  baseDemand: 800,
  demandSwing: 150,
  demandPeriod: 240
})

export const EVENTS = Object.freeze({
  STATE_CHANGED: 'plant:state',
  ALARM_RAISED: 'alarm:raised',
  ALARM_CLEARED: 'alarm:cleared',
  SCRAM: 'reactor:scram',
  INCIDENT_STARTED: 'incident:started',
  INCIDENT_RESOLVED: 'incident:resolved',
  COMMAND: 'ui:command',
  TICK: 'sim:tick',
  TURBINE_TRIP: 'turbine:trip',
  ALARM_ACK: 'alarm:ack',
  PLANT_RESET: 'plant:reset',
  NOTICE: 'ui:notice',
  MELTDOWN: 'reactor:meltdown',
  EXPLOSION: 'scene:explosion'
})