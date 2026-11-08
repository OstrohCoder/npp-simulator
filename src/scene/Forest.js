import {
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { SITE } from './layout.js'
import { createRandom, lerp, smoothstep } from '../utils/math.js'

const TREE_COUNT = 1100
const MAX_ATTEMPTS = 40000
const INNER_RADIUS = 170
const OUTER_RADIUS = 1100
const CLEARANCE = 22
const FADE_DISTANCE = 90
const ROAD_X = SITE.halfX + 5
const SWAY_HEIGHT = 16

const SWAY = `
#include <begin_vertex>
float bend = pow(clamp(transformed.y / ${SWAY_HEIGHT.toFixed(1)}, 0.0, 1.0), 2.0);
#ifdef USE_INSTANCING
float phase = instanceMatrix[3].x * 0.045 + instanceMatrix[3].z * 0.037;
#else
float phase = 0.0;
#endif
float gust = sin(uTime * 0.8 + phase) + 0.45 * sin(uTime * 2.1 + phase * 1.7);
transformed.x += gust * bend * 0.32;
transformed.z += gust * bend * 0.18;
`

const between = (random, min, max) => min + random() * (max - min)

const bump = (x, y, z) => Math.sin(x * 1.9 + y * 1.3) * Math.cos(z * 1.7 - y * 0.8)

function createNoise(seed) {
  const random = createRandom(seed)
  const lattice = new Float32Array(1024)
  for (let i = 0; i < lattice.length; i++) lattice[i] = random()
  const at = (x, y) => lattice[((x & 31) << 5) | (y & 31)]

  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const u = smoothstep(0, 1, x - xi)
    const v = smoothstep(0, 1, y - yi)
    return lerp(
      lerp(at(xi, yi), at(xi + 1, yi), u),
      lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u),
      v
    )
  }
}

function paint(geometry, bottom, top = bottom) {
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox
  const span = Math.max(max.y - min.y, 1e-6)
  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  const color = new Color()

  for (let i = 0; i < position.count; i++) {
    color.copy(bottom).lerp(top, (position.getY(i) - min.y) / span)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

function roughen(geometry, amount) {
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    position.setXYZ(
      i,
      x + bump(z, x, y) * amount,
      y + bump(x, y, z) * amount * 0.5,
      z + bump(y, z, x) * amount
    )
  }
  return geometry
}

function assemble(parts) {
  for (const part of parts) part.deleteAttribute('uv')
  const merged = mergeGeometries(parts)
  parts.forEach((part) => part.dispose())
  return merged
}

function trunk(radiusTop, radiusBottom, height, bottom, top = bottom) {
  const geometry = new CylinderGeometry(radiusTop, radiusBottom, height, 7).toNonIndexed()
  geometry.translate(0, height / 2, 0)
  return paint(geometry, bottom, top)
}

function tier(random, radius, height, y, bottom, top) {
  const geometry = new ConeGeometry(radius, height, 10, 1).toNonIndexed()
  geometry.rotateY(random() * Math.PI)
  geometry.translate(0, y + height / 2, 0)
  roughen(geometry, radius * 0.12)
  return paint(geometry, bottom, top)
}

function blob(random, radius, flatten, x, y, z, bottom, top) {
  const geometry = new IcosahedronGeometry(radius, 1)
  roughen(geometry, radius * 0.18)
  geometry.scale(1, flatten, 1)
  geometry.rotateY(random() * Math.PI)
  geometry.translate(x, y, z)
  return paint(geometry, bottom, top)
}

function canopy(random, count, spread, minY, rangeY, minRadius, rangeRadius, flatten, bottom, top) {
  const parts = []
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2
    const distance = random() * spread
    parts.push(
      blob(
        random,
        minRadius + random() * rangeRadius,
        flatten,
        Math.cos(angle) * distance,
        minY + random() * rangeY,
        Math.sin(angle) * distance,
        bottom,
        top
      )
    )
  }
  return parts
}

function buildSpruce(random) {
  const dark = new Color(0x1e3a22)
  const light = new Color(0x3b6a3a)
  const tiers = 7
  const parts = [trunk(0.2, 0.38, 4, new Color(0x3a2b20), new Color(0x4a3828))]

  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1)
    const radius = lerp(3.4, 1, t) * between(random, 0.9, 1.1)
    parts.push(tier(random, radius, lerp(4.4, 3.2, t), lerp(2.2, 10.2, t), dark, light))
  }
  parts.push(tier(random, 0.55, 2.6, 12.6, dark, light))
  return assemble(parts)
}

function buildPine(random) {
  const parts = [trunk(0.22, 0.42, 12, new Color(0x4a3426), new Color(0x9a5f35))]
  parts.push(
    ...canopy(random, 6, 2.2, 10.5, 4, 1.8, 1.1, 0.5, new Color(0x274226), new Color(0x3f6633))
  )
  return assemble(parts)
}

function buildBirch(random) {
  const parts = [
    trunk(0.14, 0.24, 8.5, new Color(0xcfcbbf), new Color(0xe6e2d6)),
    trunk(0.25, 0.27, 0.9, new Color(0x2e2c2a))
  ]
  parts.push(
    ...canopy(random, 6, 1.8, 6.5, 4.5, 1.5, 1.1, 0.85, new Color(0x5f8a36), new Color(0x9cc04f))
  )
  return assemble(parts)
}

function buildOak(random) {
  const parts = [trunk(0.45, 0.75, 5, new Color(0x3d3126), new Color(0x54463a))]
  parts.push(
    ...canopy(random, 8, 3.4, 5.2, 4.2, 2.4, 1.4, 0.8, new Color(0x2f5224), new Color(0x5d8c36))
  )
  return assemble(parts)
}

const SPECIES = Object.freeze([
  { id: 'spruce', build: buildSpruce, seed: 11, scale: [1.6, 2.3], conifer: true },
  { id: 'pine', build: buildPine, seed: 23, scale: [1.5, 2.1], conifer: true },
  { id: 'birch', build: buildBirch, seed: 37, scale: [1.4, 1.9], conifer: false },
  { id: 'oak', build: buildOak, seed: 53, scale: [1.5, 2], conifer: false }
])

const SPECIES_BY_ID = Object.freeze(Object.fromEntries(SPECIES.map((item) => [item.id, item])))

export class Forest {
  constructor() {
    this.group = new Group()
    this.group.name = 'forest'
    this.time = { value: 0 }
    this.material = this.#createMaterial()

    const placements = this.#scatter()
    for (const species of SPECIES) this.#plant(species, placements[species.id])
  }

  update(elapsed) {
    this.time.value = elapsed
  }

  #createMaterial() {
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      flatShading: true
    })
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', SWAY)
    }
    return material
  }

  #scatter() {
    const random = createRandom(2024)
    const coverage = createNoise(7)
    const stands = createNoise(19)
    const result = Object.fromEntries(SPECIES.map(({ id }) => [id, []]))
    let placed = 0

    for (let attempt = 0; attempt < MAX_ATTEMPTS && placed < TREE_COUNT; attempt++) {
      const angle = random() * Math.PI * 2
      const radius = INNER_RADIUS + Math.pow(random(), 0.65) * (OUTER_RADIUS - INNER_RADIUS)
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      const gap = Math.max(Math.abs(x) - SITE.halfX, Math.abs(z) - SITE.halfZ)
      if (gap < CLEARANCE) continue
      if (Math.abs(x - ROAD_X) < 20 && z > -20) continue

      const density =
        0.6 * coverage(x * 0.012, z * 0.012) + 0.4 * coverage(x * 0.035 + 40, z * 0.035 + 40)
      const edge = smoothstep(CLEARANCE, CLEARANCE + FADE_DISTANCE, gap)
      if (random() > smoothstep(0.38, 0.62, density) * (0.35 + 0.65 * edge)) continue

      const coniferShare = smoothstep(0.3, 0.7, stands(x * 0.007 + 90, z * 0.007 + 90))
      const conifer = random() < coniferShare
      const id = conifer
        ? random() < 0.55
          ? 'spruce'
          : 'pine'
        : random() < 0.5
          ? 'birch'
          : 'oak'

      const [minScale, maxScale] = SPECIES_BY_ID[id].scale
      const tint = new Color()
      if (!conifer && random() < 0.07) tint.setHSL(0.12, 0.45, 0.85)
      else tint.setHSL(between(random, 0.08, 0.2), 0.14, between(random, 0.7, 1))

      result[id].push({
        x,
        z,
        yaw: random() * Math.PI * 2,
        leanX: (random() - 0.5) * 0.08,
        leanZ: (random() - 0.5) * 0.08,
        scale: between(random, minScale, maxScale),
        spread: between(random, 0.88, 1.14),
        tint
      })
      placed++
    }
    return result
  }

  #plant(species, trees) {
    if (trees.length === 0) return

    const mesh = new InstancedMesh(species.build(createRandom(species.seed)), this.material, trees.length)
    const dummy = new Object3D()

    trees.forEach((tree, index) => {
      dummy.position.set(tree.x, -0.15, tree.z)
      dummy.rotation.set(tree.leanX, tree.yaw, tree.leanZ)
      dummy.scale.set(tree.scale * tree.spread, tree.scale, tree.scale * tree.spread)
      dummy.updateMatrix()
      mesh.setMatrixAt(index, dummy.matrix)
      mesh.setColorAt(index, tree.tint)
    })

    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
  }
}
