import { BoxGeometry, CylinderGeometry, Group, Mesh, PointLight, SphereGeometry } from 'three'
import { LAYOUT, SITE, SIZES } from '../layout.js'
import { SteamPlume } from '../SteamPlume.js'
import { SIGNAL, applyShadows } from '../materials.js'
import { TURBINE } from '../../simulation/constants.js'
import { damp } from '../../utils/math.js'

const { length: LENGTH, width: WIDTH, height: HEIGHT } = SIZES.turbineHall
const WALL = 0.6
const AXIS = 8
const ROTOR_SPEED = 10

const CASINGS = [
  { x: -20, length: 8, radius: 2.3, material: 'steel' },
  { x: -8.5, length: 9, radius: 3.3, material: 'steel' },
  { x: 3.5, length: 9, radius: 3.3, material: 'steel' },
  { x: 17, length: 12, radius: 2.9, material: 'generator' },
  { x: 26, length: 4, radius: 1.6, material: 'darkSteel' }
]
const COUPLINGS = [-14.5, -2.5, 9.5, 23.5]

export class TurbineHall {
  constructor(resources, materials) {
    this.group = new Group()
    this.group.position.set(LAYOUT.turbineHall.x, SITE.padHeight, LAYOUT.turbineHall.z)
    this.speed = 1
    this.cutaway = false
    this.shellOpacity = 1
    this.shell = []

    this.#buildShell(materials)
    this.#buildTrain(materials)
    this.#buildEquipment(materials)
    this.#buildRoof(materials)
    this.#buildLights()
    applyShadows(this.group)
  }

  update(delta, elapsed, snapshot, view) {
    this.#updateShell(delta)
    const { turbine } = snapshot
    this.speed = damp(this.speed, turbine.rpm / TURBINE.nominalRpm, 6, delta)
    this.rotor.rotation.x += this.speed * ROTOR_SPEED * delta

    const shake = turbine.vibration * 0.12
    this.train.position.y = AXIS + Math.sin(elapsed * 57) * shake
    this.train.position.z = Math.cos(elapsed * 43) * shake

    this.crane.position.x = Math.sin(elapsed * 0.12) * 22

    let color = SIGNAL.off
    let intensity = 1.8
    if (turbine.tripped) {
      color = SIGNAL.red
      intensity = Math.sin(elapsed * 10) > 0 ? 2 : 0.2
    } else if (turbine.synchronized) {
      color = SIGNAL.green
    } else if (turbine.rpm > 100) {
      color = SIGNAL.amber
    }
    this.lampMaterial.emissive.copy(color)
    this.lampMaterial.emissiveIntensity = intensity

    this.relief.update(delta, turbine.reliefOpening, view.pixelScale)
  }

  setCutaway(value) {
    this.cutaway = Boolean(value)
  }

  #shell(width, height, depth, x, y, z, material) {
    const mesh = this.#box(width, height, depth, x, y, z, material.clone())
    this.shell.push(mesh)
    return mesh
  }

  #updateShell(delta) {
    this.shellOpacity = damp(this.shellOpacity, this.cutaway ? 0.1 : 1, 5, delta)
    const solid = this.shellOpacity > 0.985
    for (const mesh of this.shell) {
      const material = mesh.material
      if (material.transparent === solid) {
        material.transparent = !solid
        material.depthWrite = solid
        material.needsUpdate = true
      }
      material.opacity = solid ? 1 : this.shellOpacity
      mesh.castShadow = solid
    }
  }

  #box(width, height, depth, x, y, z, material) {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material)
    mesh.position.set(x, y, z)
    this.group.add(mesh)
    return mesh
  }

  #buildShell(materials) {
    const half = HEIGHT / 2
    this.#shell(LENGTH, HEIGHT, WALL, 0, half, -WIDTH / 2, materials.panel(LENGTH, HEIGHT))
    this.#shell(WALL, HEIGHT, WIDTH, -LENGTH / 2, half, 0, materials.panel(WIDTH, HEIGHT))
    this.#shell(WALL, HEIGHT, WIDTH, LENGTH / 2, half, 0, materials.panel(WIDTH, HEIGHT))
    this.#shell(LENGTH, 7, WALL, 0, 3.5, WIDTH / 2, materials.panel(LENGTH, 7))
    this.#shell(LENGTH, 7, WALL, 0, HEIGHT - 3.5, WIDTH / 2, materials.panel(LENGTH, 7))
    this.#box(LENGTH - 1, HEIGHT - 14, 0.2, 0, half, WIDTH / 2, materials.glass)
    this.#box(LENGTH - 1.2, 0.1, WIDTH - 1.2, 0, 0.05, 0, materials.darkConcrete)

    for (let x = -30; x <= 30; x += 10) {
      this.#box(1.2, HEIGHT, 1.2, x, half, WIDTH / 2 + 0.3, materials.concrete)
    }
  }

  #buildTrain(materials) {
    this.#box(54, 4, 9, 2, 2, 0, materials.concrete)

    this.train = new Group()
    this.train.position.y = AXIS

    for (const { x, length, radius, material } of CASINGS) {
      const casing = new Mesh(
        new CylinderGeometry(radius, radius, length, 36).rotateZ(Math.PI / 2),
        materials[material]
      )
      casing.position.x = x
      this.train.add(casing)

      for (const side of [-1, 1]) {
        const flange = new Mesh(
          new CylinderGeometry(radius + 0.25, radius + 0.25, 0.4, 36).rotateZ(Math.PI / 2),
          materials.darkSteel
        )
        flange.position.x = x + (side * (length - 0.4)) / 2
        this.train.add(flange)
      }
    }

    this.rotor = new Group()
    const shaft = new Mesh(
      new CylinderGeometry(0.55, 0.55, 54, 16).rotateZ(Math.PI / 2),
      materials.steel
    )
    shaft.position.x = 2
    this.rotor.add(shaft)

    const discGeometry = new CylinderGeometry(1.5, 1.5, 0.5, 24).rotateZ(Math.PI / 2)
    const boltGeometry = new BoxGeometry(0.5, 0.35, 0.35)
    for (const x of COUPLINGS) {
      const disc = new Mesh(discGeometry, materials.darkSteel)
      disc.position.x = x
      this.rotor.add(disc)
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4
        const bolt = new Mesh(boltGeometry, materials.steel)
        bolt.position.set(x, Math.cos(angle) * 1.45, Math.sin(angle) * 1.45)
        this.rotor.add(bolt)
      }
    }

    this.train.add(this.rotor)
    this.group.add(this.train)
  }

  #buildEquipment(materials) {
    for (const z of [-9, -12.5]) {
      const heater = new Mesh(
        new CylinderGeometry(1.8, 1.8, 18, 28).rotateZ(Math.PI / 2),
        materials.steel
      )
      heater.position.set(10, 2.4, z)
      this.group.add(heater)
    }

    for (let i = 0; i < 3; i++) {
      this.#box(5, 4, 3, -24 + i * 6.5, 2, 11, materials.concrete)
    }

    this.crane = new Group()
    this.crane.position.y = 21
    const bridge = new Mesh(new BoxGeometry(1.4, 1.2, WIDTH - 2), materials.darkSteel)
    const trolley = new Mesh(new BoxGeometry(2.4, 1.6, 2.4), materials.steel)
    trolley.position.y = -1.2
    this.crane.add(bridge, trolley)
    this.group.add(this.crane)

    for (const side of [-1, 1]) {
      this.#box(LENGTH - 4, 0.6, 0.6, 0, 20.4, side * (WIDTH / 2 - 1), materials.darkSteel)
    }
  }

  #buildRoof(materials) {
    this.#shell(LENGTH + 2, 0.8, WIDTH + 2, 0, HEIGHT + 0.4, 0, materials.roof)

    for (let x = -24; x <= 24; x += 12) {
      this.#shell(3.2, 1.6, 3.2, x, HEIGHT + 1.6, 5, materials.darkSteel)
    }

    const vent = new Mesh(new CylinderGeometry(0.5, 0.5, 2.5, 12), materials.steel)
    vent.position.set(-8, HEIGHT + 2, -6)
    this.group.add(vent)

    this.relief = new SteamPlume({
      count: 50,
      radius: 0.6,
      size: 5,
      rise: 14,
      lifetime: 4,
      wind: [2, 0, 1],
      spread: 0.6,
      opacity: 0.7
    })
    this.relief.points.position.set(-8, HEIGHT + 3.3, -6)
    this.group.add(this.relief.points)

    const pole = new Mesh(new CylinderGeometry(0.12, 0.12, 3, 8), materials.darkSteel)
    pole.position.set(LENGTH / 2 - 3, HEIGHT + 2.3, WIDTH / 2 - 2)
    this.lampMaterial = materials.lamp(SIGNAL.green)
    const lamp = new Mesh(new SphereGeometry(0.7, 16, 12), this.lampMaterial)
    lamp.position.set(LENGTH / 2 - 3, HEIGHT + 4.2, WIDTH / 2 - 2)
    this.group.add(pole, lamp)
  }

  #buildLights() {
    for (const x of [-15, 15]) {
      const light = new PointLight(0xfff0d8, 350, 50, 2)
      light.position.set(x, 20, 0)
      this.group.add(light)
    }
  }
}
