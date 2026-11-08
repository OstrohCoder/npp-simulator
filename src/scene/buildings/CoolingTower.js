import {
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector2
} from 'three'
import { SITE, SIZES } from '../layout.js'
import { SteamPlume } from '../SteamPlume.js'
import { applyShadows } from '../materials.js'
import { clamp, createRandom } from '../../utils/math.js'

const { height, throatHeight, throatRadius, baseRadius } = SIZES.coolingTower
const PROFILE_STEPS = 32

function paintTower(ctx, size) {
  const random = createRandom(71)
  ctx.fillStyle = '#b4b2aa'
  ctx.fillRect(0, 0, size, size)
  for (let x = 0; x < size; x += 4) {
    const shade = 120 + random() * 60
    ctx.fillStyle = `rgba(${shade}, ${shade - 4}, ${shade - 10}, 0.35)`
    ctx.fillRect(x, 0, 2 + random() * 2, size)
  }
  ctx.fillStyle = 'rgba(40, 44, 48, 0.28)'
  for (let y = 0; y < size; y += 64) ctx.fillRect(0, y, size, 2)
}

function buildProfile() {
  const c = throatHeight / Math.sqrt((baseRadius / throatRadius) ** 2 - 1)
  const points = []
  for (let i = 0; i <= PROFILE_STEPS; i++) {
    const y = (height * i) / PROFILE_STEPS
    const radius = throatRadius * Math.sqrt(1 + ((y - throatHeight) / c) ** 2)
    points.push(new Vector2(radius, y))
  }
  return points
}

export class CoolingTower {
  constructor(resources, materials, place) {
    this.group = new Group()
    this.group.position.set(place.x, SITE.padHeight, place.z)

    const profile = buildProfile()
    const topRadius = profile[PROFILE_STEPS].x

    const shellMaterial = resources.track(
      new MeshStandardMaterial({
        map: resources.texture('tower', 256, paintTower, 10, 3),
        roughness: 0.92,
        metalness: 0.02,
        side: DoubleSide
      })
    )
    const shell = new Mesh(new LatheGeometry(profile, 72), shellMaterial)

    const basin = new Mesh(
      new CylinderGeometry(baseRadius + 4, baseRadius + 4, 1.2, 72),
      materials.concrete
    )
    basin.position.y = 0.6

    const waterMaterial = resources.track(
      new MeshStandardMaterial({ color: 0x2c6670, roughness: 0.15, metalness: 0.1 })
    )
    const water = new Mesh(
      new CylinderGeometry(baseRadius + 3.4, baseRadius + 3.4, 0.1, 72),
      waterMaterial
    )
    water.position.y = 1.2

    const rim = new Mesh(new TorusGeometry(topRadius, 0.4, 8, 72), materials.concrete)
    rim.rotation.x = Math.PI / 2
    rim.position.y = height

    this.plume = new SteamPlume({
      count: 110,
      radius: topRadius * 0.7,
      size: 16,
      rise: 7,
      lifetime: 18,
      wind: [3, 0, 1.2],
      spread: 1.6,
      opacity: 0.5
    })
    this.plume.points.position.y = height

    this.group.add(shell, basin, water, rim, this.plume.points)
    applyShadows(this.group)
  }

  update(delta, elapsed, snapshot, view) {
    const { turbine, cooling } = snapshot
    const load = clamp((turbine.condenserDemand ?? 0) / 0.67, 0, 1.2)
    const intensity = load * (0.35 + 0.65 * cooling.fanSpeed)
    this.plume.update(delta, intensity, view.pixelScale)
  }
}
