import {
  BoxGeometry,
  CatmullRomCurve3,
  Group,
  Mesh,
  MeshStandardMaterial,
  TubeGeometry,
  Vector3
} from 'three'
import { LAYOUT, SITE, SIZES } from '../layout.js'
import { clamp } from '../../utils/math.js'

const FLOW_SPEED = 1.4
const CYCLE_LENGTH = 5

const CIRCUITS = Object.freeze({
  primaryHot: { base: '#b3402b', accent: '#f08a64' },
  primaryCold: { base: '#3b6a8f', accent: '#8cc4e8' },
  steam: { base: '#aab1b7', accent: '#f2f5f7' },
  feed: { base: '#2f7fa3', accent: '#9ad8f0' },
  waterHot: { base: '#b9752f', accent: '#f2bd75' },
  waterCold: { base: '#2a7f86', accent: '#82d6dc' }
})

function paintFlow(base, accent) {
  return (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, 0)
    gradient.addColorStop(0, base)
    gradient.addColorStop(0.6, accent)
    gradient.addColorStop(0.62, base)
    gradient.addColorStop(1, base)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  }
}

export class PipeNetwork {
  constructor(resources) {
    this.resources = resources
    this.group = new Group()
    this.flows = new Map()
    this.textures = new Map()
    for (const name of Object.keys(CIRCUITS)) {
      this.flows.set(name, 0)
      this.textures.set(name, new Set())
    }
    this.supportGeometry = new BoxGeometry(1, 1, 1)
    this.supportMaterial = resources.track(
      new MeshStandardMaterial({ color: 0x8b8d8e, roughness: 0.9, metalness: 0.1 })
    )
  }

  add(circuit, points, radius = 0.6, { supports = false } = {}) {
    const curve = new CatmullRomCurve3(
      points.map((point) => new Vector3(...point)),
      false,
      'catmullrom',
      0.05
    )
    const length = curve.getLength()
    const geometry = new TubeGeometry(curve, Math.max(8, Math.ceil(length * 1.5)), radius, 12, false)
    const { base, accent } = CIRCUITS[circuit]
    const texture = this.resources.texture(
      `pipe-${circuit}`,
      128,
      paintFlow(base, accent),
      Math.max(1, length / CYCLE_LENGTH),
      1
    )
    this.textures.get(circuit).add(texture)

    const material = this.resources.track(
      new MeshStandardMaterial({ map: texture, roughness: 0.45, metalness: 0.55 })
    )
    const pipe = new Mesh(geometry, material)
    pipe.castShadow = true
    pipe.receiveShadow = true
    this.group.add(pipe)

    if (supports) this.#addSupports(curve, radius, length)
    return pipe
  }

  setFlow(circuit, value) {
    this.flows.set(circuit, clamp(value, 0, 1.5))
  }

  advance(delta) {
    for (const [circuit, textures] of this.textures) {
      const step = this.flows.get(circuit) * delta * FLOW_SPEED
      if (step === 0) continue
      for (const texture of textures) {
        texture.offset.x = (texture.offset.x - step) % 1
      }
    }
  }

  #addSupports(curve, radius, length) {
    const count = Math.floor(length / 12)
    for (let i = 1; i <= count; i++) {
      const point = curve.getPointAt(i / (count + 1))
      const height = point.y - radius
      if (height < 0.3 || point.y > 6) continue
      const post = new Mesh(this.supportGeometry, this.supportMaterial)
      post.scale.set(0.8, height, 0.8)
      post.position.set(point.x, height / 2, point.z)
      post.castShadow = true
      post.receiveShadow = true
      this.group.add(post)
    }
  }
}

export class PlantPipes {
  constructor(resources) {
    this.network = new PipeNetwork(resources)
    this.group = new Group()
    this.group.position.y = SITE.padHeight
    this.group.add(this.network.group)
    this.#build()
  }

  update(delta, elapsed, snapshot) {
    const { turbine, cooling } = snapshot
    const steam = turbine.steamFlow + turbine.bypassOpening * 0.3
    const load = clamp((turbine.condenserDemand ?? 0) / 0.67, 0, 1.2)
    const water = (0.15 + 0.85 * load) * (0.4 + 0.6 * cooling.fanSpeed)

    this.network.setFlow('steam', steam)
    this.network.setFlow('feed', steam * 0.9)
    this.network.setFlow('waterHot', water)
    this.network.setFlow('waterCold', water)
    this.network.advance(delta)
  }

  #build() {
    const { reactor, turbineHall, coolingTowers } = LAYOUT
    const wallX = reactor.x + SIZES.containment.radius
    const hpX = turbineHall.x - 20
    const hpTop = 8 + 2.3
    const hallBack = turbineHall.z - SIZES.turbineHall.width / 2 + 2
    const edge = (tower) => tower.z + SIZES.coolingTower.baseRadius - 0.6
    const [towerA, towerB] = coolingTowers

    for (const z of [turbineHall.z - 1, turbineHall.z + 1]) {
      this.network.add('steam', [
        [wallX - 0.2, 22, z],
        [wallX + 5, 22, z],
        [wallX + 5, 14, z],
        [hpX, 14, z],
        [hpX, hpTop, z]
      ])
    }

    this.network.add('feed', [
      [turbineHall.x - 27, 3, turbineHall.z + 4],
      [wallX + 5, 3, turbineHall.z + 4],
      [wallX + 5, 6, turbineHall.z + 4],
      [wallX - 0.4, 6, turbineHall.z + 4]
    ])

    this.network.add(
      'waterHot',
      [
        [8, 3, hallBack],
        [8, 3, -36],
        [towerA.x - 4, 3, -36],
        [towerA.x - 4, 3, edge(towerA)]
      ],
      0.6,
      { supports: true }
    )
    this.network.add(
      'waterHot',
      [
        [12, 3, hallBack],
        [12, 3, -40],
        [towerB.x - 4, 3, -40],
        [towerB.x - 4, 3, edge(towerB)]
      ],
      0.6,
      { supports: true }
    )
    this.network.add(
      'waterCold',
      [
        [towerA.x + 4, 1.2, edge(towerA)],
        [towerA.x + 4, 1.2, -33],
        [16, 1.2, -33],
        [16, 1.2, hallBack]
      ],
      0.6,
      { supports: true }
    )
    this.network.add(
      'waterCold',
      [
        [towerB.x + 4, 1.2, edge(towerB)],
        [towerB.x + 4, 1.2, -30],
        [20, 1.2, -30],
        [20, 1.2, hallBack]
      ],
      0.6,
      { supports: true }
    )
  }
}
