import './ui/styles/main.css'
import './ui/styles/panel.css'
import './ui/styles/alarms.css'
import './ui/styles/guide.css'

import { Engine } from './core/Engine.js'
import { Loop } from './core/Loop.js'
import { World } from './scene/World.js'
import { Plant } from './simulation/Plant.js'
import { Incidents } from './simulation/Incidents.js'
import { ControlPanel } from './ui/ControlPanel.js'
import { Gauges } from './ui/Gauges.js'
import { AlarmPanel } from './ui/AlarmPanel.js'
import { AlarmSound } from './ui/AlarmSound.js'
import { Overlay } from './ui/Overlay.js'
import { Guide } from './ui/Guide.js'

const UI_INTERVAL = 0.1

const app = document.getElementById('app')
const engine = new Engine(document.getElementById('scene'))
const world = new World(engine)
const plant = new Plant()
const incidents = new Incidents(plant)
plant.attachIncidents(incidents)

const sound = new AlarmSound()
const controlPanel = new ControlPanel(document.getElementById('control-panel'), { plant, incidents })
const gauges = new Gauges(document.getElementById('gauges'))
const alarmPanel = new AlarmPanel(document.getElementById('alarm-panel'), plant)
const overlay = new Overlay(app, { plant, engine, world, sound })
const guide = new Guide(app, { plant, button: document.getElementById('help-button') })

function refreshInterface(snapshot) {
  controlPanel.update(snapshot)
  gauges.update(snapshot)
  alarmPanel.update(snapshot)
  overlay.update(snapshot)
  sound.update(snapshot)
}

const loop = new Loop()
let interfaceTimer = 0

loop.add((delta, elapsed) => {
  plant.update(delta)
  const snapshot = plant.snapshot()
  world.update(delta, elapsed, snapshot)
  engine.render(delta)

  interfaceTimer += delta
  if (interfaceTimer >= UI_INTERVAL) {
    interfaceTimer = 0
    refreshInterface(snapshot)
  }
})

refreshInterface(plant.snapshot())
loop.start()
document.getElementById('loader').classList.add('is-hidden')
guide.startIfNew()
