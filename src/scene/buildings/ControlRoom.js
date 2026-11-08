import { BoxGeometry, CylinderGeometry, Group, Mesh, PointLight, SphereGeometry } from 'three'
import { LAYOUT, SITE, SIZES } from '../layout.js'
import { SIGNAL, applyShadows, stateColor } from '../materials.js'
import { PLANT_STATE } from '../../simulation/constants.js'
import { damp } from '../../utils/math.js'

const { width: W, depth: D, height: H } = SIZES.controlRoom
const WALL = 0.5

const BLINK_RATE = Object.freeze({
  [PLANT_STATE.NORMAL]: 1.5,
  [PLANT_STATE.WARNING]: 4,
  [PLANT_STATE.EMERGENCY]: 9
})

export class ControlRoom {
  constructor(resources, materials) {
    this.group = new Group()
    this.group.position.set(LAYOUT.controlRoom.x, SITE.padHeight, LAYOUT.controlRoom.z)
    this.screenMaterial = materials.lamp(SIGNAL.cyan)
    this.beaconMaterial = materials.lamp(SIGNAL.green)
    this.screenColor = SIGNAL.cyan.clone()

    this.#buildShell(materials)
    this.#buildInterior(materials)
    this.#buildRoof(materials)
    applyShadows(this.group)
  }

  update(delta, elapsed, snapshot) {
    const { state } = snapshot
    const rate = 1 - Math.exp(-5 * delta)
    const target = state === PLANT_STATE.NORMAL ? SIGNAL.cyan : stateColor(state)
    this.screenColor.lerp(target, rate)
    this.screenMaterial.emissive.copy(this.screenColor)
    const flicker = state === PLANT_STATE.EMERGENCY ? (Math.sin(elapsed * 8) > 0 ? 1 : 0.35) : 1
    this.screenMaterial.emissiveIntensity = damp(this.screenMaterial.emissiveIntensity, 0.9 * flicker, 20, delta)

    const blink = Math.sin(elapsed * BLINK_RATE[state]) > 0
    this.beaconMaterial.emissive.copy(stateColor(state))
    this.beaconMaterial.emissiveIntensity = blink ? 2 : 0.2
  }

  #box(width, height, depth, x, y, z, material) {
    const mesh = new Mesh(new BoxGeometry(width, height, depth), material)
    mesh.position.set(x, y, z)
    this.group.add(mesh)
    return mesh
  }

  #buildShell(materials) {
    this.#box(W, H, WALL, 0, H / 2, D / 2, materials.panel(W, H))
    this.#box(WALL, H, D, -W / 2, H / 2, 0, materials.panel(D, H))
    this.#box(WALL, H, D, W / 2, H / 2, 0, materials.panel(D, H))
    this.#box(W, 3, WALL, 0, 1.5, -D / 2, materials.panel(W, 3))
    this.#box(W, 3.5, WALL, 0, H - 1.75, -D / 2, materials.panel(W, 3.5))
    this.#box(W - 1, 7.5, 0.2, 0, 6.75, -D / 2, materials.glass)
    this.#box(W - 1, 0.1, D - 1, 0, 0.05, 0, materials.darkConcrete)
  }

  #buildInterior(materials) {
    for (let i = -3; i <= 3; i++) {
      const x = i * 5
      this.#box(4, 1.1, 1.8, x, 0.55, -D / 2 + 4, materials.darkSteel)
      const screen = this.#box(3.4, 1, 0.1, x, 1.7, -D / 2 + 4.5, this.screenMaterial)
      screen.rotation.x = 0.35
    }
    this.#box(24, 5, 0.2, 0, 7, D / 2 - 0.6, this.screenMaterial)

    const light = new PointLight(0xfff0d8, 300, 40, 2)
    light.position.set(0, 10, 0)
    this.group.add(light)
  }

  #buildRoof(materials) {
    this.#box(W + 1, 0.6, D + 1, 0, H + 0.3, 0, materials.roof)
    this.#box(5, 2, 4, -12, H + 1.6, 3, materials.darkSteel)
    this.#box(5, 2, 4, 0, H + 1.6, 3, materials.darkSteel)
    this.#box(5, 2, 4, 12, H + 1.6, 3, materials.darkSteel)

    const mast = new Mesh(new CylinderGeometry(0.15, 0.25, 10, 8), materials.steel)
    mast.position.set(W / 2 - 3, H + 5.6, 0)
    const beacon = new Mesh(new SphereGeometry(0.55, 16, 12), this.beaconMaterial)
    beacon.position.set(W / 2 - 3, H + 10.8, 0)
    this.group.add(mast, beacon)
  }
}
