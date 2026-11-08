import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry
} from 'three'
import { LAYOUT, SITE, SIZES } from '../layout.js'
import { PipeNetwork } from './Pipes.js'
import { SIGNAL, applyShadows, stateColor } from '../materials.js'
import { PLANT_STATE, REACTOR } from '../../simulation/constants.js'
import { clamp, damp, inverseLerp } from '../../utils/math.js'

const { radius: RADIUS, wallHeight: WALL_HEIGHT } = SIZES.containment
const ROD_BASE = 17.2
const ROD_TRAVEL = 6.2
const RIB_HEIGHTS = [9, 18, 27, 36]
const LOOP_ANGLES = [45, 135, 225, 315].map((degrees) => (degrees * Math.PI) / 180)
const CORE_COLD = new Color(0x3aa0ff)
const CORE_HOT = new Color(0xff7a2a)
const CORE_MELT = new Color(0xfff2d8)
const ROD_LAYOUT = buildRodLayout()

const BLINK_RATE = Object.freeze({
  [PLANT_STATE.NORMAL]: 1,
  [PLANT_STATE.WARNING]: 3,
  [PLANT_STATE.EMERGENCY]: 8
})

function buildRodLayout() {
  const positions = [[0, 0]]
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3
    positions.push([Math.cos(angle) * 1.1, Math.sin(angle) * 1.1])
  }
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 + Math.PI / 6
    positions.push([Math.cos(angle) * 2, Math.sin(angle) * 2])
  }
  return positions
}

function polar(radius, y, angle, offset = 0) {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return [cos * radius - sin * offset, y, sin * radius + cos * offset]
}

export class ReactorBuilding {
  constructor(resources, materials) {
    this.group = new Group()
    this.group.position.set(LAYOUT.reactor.x, SITE.padHeight, LAYOUT.reactor.z)
    this.cutaway = false
    this.shellOpacity = 1
    this.pumps = []
    this.network = new PipeNetwork(resources)

    this.#buildContainment(materials)
    this.#buildAuxiliary(materials)
    this.#buildStack(materials)
    this.#buildBeacon(materials)
    this.#buildInterior(materials)
    applyShadows(this.group)
  }

  setCutaway(value) {
    this.cutaway = Boolean(value)
  }

  toggleCutaway() {
    this.cutaway = !this.cutaway
    return this.cutaway
  }

  update(delta, elapsed, snapshot) {
    const { reactor, state } = snapshot
    this.#updateShell(delta, elapsed, reactor)
    this.#updateBeacons(elapsed, state)
    if (this.interior.visible) this.#updateInterior(delta, elapsed, snapshot)
  }

  #updateShell(delta, elapsed, reactor) {
    const target = this.cutaway ? 0.12 : 1
    this.shellOpacity = damp(this.shellOpacity, target, 5, delta)

    const solid = this.shellOpacity > 0.985
    const material = this.shellMaterial
    if (material.transparent === solid) {
      material.transparent = !solid
      material.depthWrite = solid
      material.needsUpdate = true
    }
    material.opacity = solid ? 1 : this.shellOpacity
    material.emissiveIntensity = reactor.meltdown ? 0.25 + 0.2 * Math.sin(elapsed * 5) : 0

    this.interior.visible = this.shellOpacity < 0.98
    this.light.intensity = damp(this.light.intensity, this.cutaway ? 600 : 0, 6, delta)
  }

  #updateBeacons(elapsed, state) {
    const color = stateColor(state)
    const blink = Math.sin(elapsed * BLINK_RATE[state]) > 0
    for (const material of [this.domeBeacon, this.stackBeacon]) {
      material.emissive.copy(state === PLANT_STATE.NORMAL && material === this.stackBeacon ? SIGNAL.red : color)
      material.emissiveIntensity = blink ? 2 : 0.25
    }
  }

  #updateInterior(delta, elapsed, snapshot) {
    const { reactor, cooling } = snapshot

    const hot = inverseLerp(REACTOR.fuelTempNominal, REACTOR.fuelTempMeltdown, reactor.fuelTemp)
    this.coreColor.copy(CORE_COLD).lerp(CORE_HOT, hot)
    if (reactor.meltdown) this.coreColor.lerp(CORE_MELT, 0.5 + 0.5 * Math.sin(elapsed * 6))
    this.coreMaterial.emissive.copy(this.coreColor)
    this.coreMaterial.emissiveIntensity = 0.15 + clamp(reactor.power, 0, 1.5) * 1.4 + hot * 1.4

    const heat = inverseLerp(REACTOR.coolantTempInlet, REACTOR.coolantTempScram, reactor.coolantTemp)
    this.vesselMaterial.emissiveIntensity = heat * 0.6

    this.rods.position.y = -ROD_TRAVEL * reactor.rodInsertion
    this.rodMaterial.emissiveIntensity = reactor.rodFault ? 0.5 + 0.4 * Math.sin(elapsed * 8) : 0

    const pressure = inverseLerp(REACTOR.pressureNominal, REACTOR.pressureScram, reactor.pressure)
    this.pressurizerMaterial.emissiveIntensity = pressure * 0.8

    this.pumps.forEach((lamp, index) => {
      const pump = cooling.pumps[index]
      if (!pump) return
      if (pump.failed) {
        lamp.emissive.copy(SIGNAL.red)
        lamp.emissiveIntensity = Math.sin(elapsed * 7) > 0 ? 1.6 : 0.2
      } else if (pump.speed > 0.05) {
        lamp.emissive.copy(SIGNAL.green)
        lamp.emissiveIntensity = 0.4 + pump.speed * 1.4
      } else {
        lamp.emissive.copy(SIGNAL.amber)
        lamp.emissiveIntensity = 0.5
      }
    })

    this.network.setFlow('primaryHot', cooling.flow)
    this.network.setFlow('primaryCold', cooling.flow)
    this.network.advance(delta)
    this.crane.rotation.y += delta * 0.05
  }

  #buildContainment(materials) {
    this.shellMaterial = materials.panel(2 * Math.PI * RADIUS, WALL_HEIGHT)
    this.shellMaterial.emissive.set(0xff3010)
    this.shellMaterial.emissiveIntensity = 0

    const wall = new Mesh(
      new CylinderGeometry(RADIUS, RADIUS, WALL_HEIGHT, 72, 1, true),
      this.shellMaterial
    )
    wall.position.y = WALL_HEIGHT / 2

    const dome = new Mesh(
      new SphereGeometry(RADIUS, 72, 28, 0, Math.PI * 2, 0, Math.PI / 2),
      this.shellMaterial
    )
    dome.position.y = WALL_HEIGHT

    this.group.add(wall, dome)

    for (const y of RIB_HEIGHTS) {
      const rib = new Mesh(new TorusGeometry(RADIUS + 0.05, 0.22, 8, 72), this.shellMaterial)
      rib.rotation.x = Math.PI / 2
      rib.position.y = y
      this.group.add(rib)
    }
  }

  #buildAuxiliary(materials) {
    const building = new Mesh(new BoxGeometry(14, 20, 18), materials.panel(18, 20))
    building.position.set(-28, 10, 0)
    const roof = new Mesh(new BoxGeometry(15, 0.6, 19), materials.roof)
    roof.position.set(-28, 20.3, 0)
    const unit = new Mesh(new BoxGeometry(4, 2, 4), materials.darkSteel)
    unit.position.set(-28, 21.6, 3)
    this.group.add(building, roof, unit)
  }

  #buildStack(materials) {
    const stack = new Group()
    stack.position.set(-30, 0, 22)

    const foundation = new Mesh(new CylinderGeometry(3.2, 3.4, 1, 24), materials.concrete)
    foundation.position.y = 0.5
    stack.add(foundation)

    const total = 62
    const segments = 8
    const segmentHeight = total / segments
    const radiusAt = (y) => 2.2 - (0.8 * y) / total

    for (let i = 0; i < segments; i++) {
      const bottom = i * segmentHeight
      const part = new Mesh(
        new CylinderGeometry(radiusAt(bottom + segmentHeight), radiusAt(bottom), segmentHeight, 20),
        i % 2 === 0 ? materials.white : materials.red
      )
      part.position.y = bottom + segmentHeight / 2
      stack.add(part)
    }

    this.stackBeacon = materials.lamp(SIGNAL.red)
    const beacon = new Mesh(new SphereGeometry(0.6, 12, 10), this.stackBeacon)
    beacon.position.y = total + 0.7
    stack.add(beacon)
    this.group.add(stack)
  }

  #buildBeacon(materials) {
    this.domeBeacon = materials.lamp(SIGNAL.green)
    const top = WALL_HEIGHT + RADIUS
    const mast = new Mesh(new CylinderGeometry(0.12, 0.12, 1.6, 8), materials.darkSteel)
    mast.position.y = top + 0.8
    const beacon = new Mesh(new SphereGeometry(0.8, 16, 12), this.domeBeacon)
    beacon.position.y = top + 2.2
    this.group.add(mast, beacon)
  }

  #buildInterior(materials) {
    this.interior = new Group()
    this.interior.visible = false
    this.coreColor = CORE_COLD.clone()

    this.light = new PointLight(0xfff1dc, 0, 45, 2)
    this.light.position.set(0, 24, 0)

    const floor = new Mesh(new CylinderGeometry(RADIUS - 0.4, RADIUS - 0.4, 0.3, 48), materials.darkConcrete)
    floor.position.y = 0.15
    this.interior.add(floor)

    this.#buildVessel(materials)
    this.#buildLoops(materials)
    this.#buildPressurizer(materials)
    this.#buildCrane(materials)
    this.interior.add(this.network.group)

    this.group.add(this.interior, this.light)
  }

  #buildVessel(materials) {
    this.vesselMaterial = new MeshStandardMaterial({
      color: 0x6b7782,
      metalness: 0.75,
      roughness: 0.4,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      emissive: 0xff5a2a,
      emissiveIntensity: 0
    })

    const body = new Mesh(new CylinderGeometry(4.2, 4.2, 12, 40, 1, true), this.vesselMaterial)
    body.position.y = 11
    const lower = new Mesh(
      new SphereGeometry(4.2, 40, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      this.vesselMaterial
    )
    lower.position.y = 5
    const upper = new Mesh(
      new SphereGeometry(4.2, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      this.vesselMaterial
    )
    upper.position.y = 17

    this.coreMaterial = new MeshStandardMaterial({
      color: 0x1b2733,
      emissive: 0x3aa0ff,
      emissiveIntensity: 0.5,
      roughness: 0.5,
      metalness: 0.3
    })
    const core = new Mesh(new CylinderGeometry(3, 3, 6, 36), this.coreMaterial)
    core.position.y = 10

    this.rodMaterial = new MeshStandardMaterial({
      color: 0x20262d,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0xff2a1a,
      emissiveIntensity: 0
    })
    const rodGeometry = new CylinderGeometry(0.16, 0.16, 8, 10)
    const driveGeometry = new CylinderGeometry(0.28, 0.28, 4, 10)
    this.rods = new Group()
    for (const [x, z] of ROD_LAYOUT) {
      const rod = new Mesh(rodGeometry, this.rodMaterial)
      rod.position.set(x, ROD_BASE, z)
      this.rods.add(rod)
      const drive = new Mesh(driveGeometry, materials.darkSteel)
      drive.position.set(x, 23.2, z)
      this.interior.add(drive)
    }

    this.interior.add(body, lower, upper, core, this.rods)
  }

  #buildLoops(materials) {
    const generatorGeometry = new CylinderGeometry(2.4, 2.4, 15, 32)
    const domeGeometry = new SphereGeometry(2.4, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    const motorGeometry = new CylinderGeometry(0.95, 0.95, 3.4, 20)
    const ringGeometry = new TorusGeometry(0.95, 0.12, 8, 24)

    LOOP_ANGLES.forEach((angle) => {
      const [gx, , gz] = polar(11, 0, angle)
      const body = new Mesh(generatorGeometry, materials.boiler)
      body.position.set(gx, 8.5, gz)
      const dome = new Mesh(domeGeometry, materials.boiler)
      dome.position.set(gx, 16, gz)

      const [mx, , mz] = polar(8.4, 0, angle, 1.5)
      const motor = new Mesh(motorGeometry, materials.darkSteel)
      motor.position.set(mx, 3.4, mz)
      const lampMaterial = materials.lamp(SIGNAL.green)
      const ring = new Mesh(ringGeometry, lampMaterial)
      ring.rotation.x = Math.PI / 2
      ring.position.set(mx, 5.2, mz)
      this.pumps.push(lampMaterial)

      this.interior.add(body, dome, motor, ring)

      this.network.add(
        'primaryHot',
        [
          polar(4.4, 14, angle, -1.2),
          polar(7, 14, angle, -1.2),
          polar(8.8, 6, angle, -1.2),
          polar(9.3, 3, angle, -1.2)
        ],
        0.5
      )
      this.network.add(
        'primaryCold',
        [
          polar(10.4, 1.5, angle, 1.5),
          polar(8.4, 1.5, angle, 1.5),
          polar(6.4, 1.5, angle, 1.5),
          polar(5.4, 7.5, angle, 1.3),
          polar(4.3, 8.4, angle, 1.1)
        ],
        0.5
      )
    })
  }

  #buildPressurizer(materials) {
    this.pressurizerMaterial = new MeshStandardMaterial({
      color: 0x7d8790,
      metalness: 0.6,
      roughness: 0.45,
      emissive: 0xffaa33,
      emissiveIntensity: 0
    })
    const body = new Mesh(new CylinderGeometry(1.6, 1.6, 13, 28), this.pressurizerMaterial)
    body.position.set(9, 7.5, 0)
    const dome = new Mesh(
      new SphereGeometry(1.6, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      this.pressurizerMaterial
    )
    dome.position.set(9, 14, 0)
    this.interior.add(body, dome)

    this.network.add(
      'primaryHot',
      [
        polar(4.4, 12, 0),
        polar(6.3, 12, 0),
        polar(6.3, 3.6, 0),
        polar(7.6, 3.6, 0)
      ],
      0.4
    )
  }

  #buildCrane(materials) {
    this.crane = new Group()
    this.crane.position.y = 31

    const rail = new Mesh(new TorusGeometry(17, 0.35, 8, 72), materials.darkSteel)
    rail.rotation.x = Math.PI / 2
    const bridge = new Mesh(new BoxGeometry(34, 0.9, 1.6), materials.darkSteel)
    const trolley = new Mesh(new BoxGeometry(2.6, 1.4, 2.4), materials.steel)
    trolley.position.set(4, -1.1, 0)
    this.crane.add(rail, bridge, trolley)
    this.interior.add(this.crane)
  }
}
