import { Plant } from './src/simulation/Plant.js'
import { Incidents } from './src/simulation/Incidents.js'
import { bus } from './src/utils/events.js'
import { EVENTS } from './src/simulation/constants.js'

const plant = new Plant()
const incidents = new Incidents(plant)
plant.attachIncidents(incidents)

bus.on(EVENTS.ALARM_RAISED, (a) => console.log(`  [${a.level}] ${a.text}`))
bus.on(EVENTS.SCRAM, (e) => console.log(`  SCRAM: ${e.reason}`))

function run(label, seconds, id) {
  console.log(`\n== ${label}`)
  if (id) incidents.trigger(id)
  for (let t = 0; t < seconds; t += 10) {
    plant.update(0.1)
    for (let i = 0; i < 99; i++) plant.update(0.1)
    const s = plant.snapshot()
    console.log(
      `${String(Math.round(plant.time)).padStart(4)}s`,
      s.state.padEnd(9),
      `P=${(s.reactor.power * 100).toFixed(0)}%`,
      `Tc=${s.reactor.coolantTemp.toFixed(0)}`,
      `p=${s.reactor.pressure.toFixed(1)}`,
      `lvl=${(s.cooling.level * 100).toFixed(0)}%`,
      `rpm=${s.turbine.rpm.toFixed(0)}`,
      `MW=${s.turbine.electricPower.toFixed(0)}`
    )
  }
}

run('штатний режим', 30)
run('відмова насоса', 60, 'pumpFailure')
incidents.resolveAll()
run('витік теплоносія', 90, 'coolantLeak')