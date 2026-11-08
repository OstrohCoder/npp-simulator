import {
  BackSide,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3
} from 'three'
import { SITE } from './layout.js'
import { createRandom } from '../utils/math.js'

const SKY_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SKY_FRAGMENT = `
uniform vec3 topColor;
uniform vec3 horizonColor;
varying vec3 vDirection;
void main() {
  float h = clamp(vDirection.y, 0.0, 1.0);
  gl_FragColor = vec4(mix(horizonColor, topColor, pow(h, 0.5)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

function paintGround(ctx, size) {
  const random = createRandom(11)
  ctx.fillStyle = '#4b5d3f'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 14000; i++) {
    const shade = 55 + random() * 55
    const r = Math.floor(shade * 0.72)
    const g = Math.floor(shade + 22)
    const b = Math.floor(shade * 0.5)
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.4)`
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3)
  }
}

function paintConcrete(ctx, size) {
  const random = createRandom(23)
  ctx.fillStyle = '#9a9c9e'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 9000; i++) {
    const shade = 120 + random() * 60
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade + 4}, 0.25)`
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2)
  }
  ctx.strokeStyle = 'rgba(40, 42, 46, 0.35)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)
}

function paintAsphalt(ctx, size) {
  const random = createRandom(37)
  ctx.fillStyle = '#2b2e33'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 7000; i++) {
    const shade = 45 + random() * 50
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade + 3}, 0.3)`
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2)
  }
}

export class Environment {
  constructor(scene, resources) {
    this.scene = scene
    this.resources = resources
    this.group = new Group()
    this.group.name = 'environment'

    this.#buildSky()
    this.#buildGround()
    this.#buildPad()
    this.#buildRoads()
    this.#buildForest()

    scene.fog = new Fog(0xc3d6e6, 320, 1500)
    scene.add(this.group)
  }

  update(lighting) {
    const uniforms = this.sky.material.uniforms
    uniforms.topColor.value.copy(lighting.sky)
    uniforms.horizonColor.value.copy(lighting.horizon)
    this.scene.fog.color.copy(lighting.horizon)
  }

  #buildSky() {
    const material = new ShaderMaterial({
      uniforms: {
        topColor: { value: new Color() },
        horizonColor: { value: new Color() }
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthWrite: false,
      fog: false
    })
    this.sky = new Mesh(this.resources.track(new SphereGeometry(2400, 32, 16)), this.resources.track(material))
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1
    this.group.add(this.sky)
  }

  #buildGround() {
    const texture = this.resources.texture('ground', 512, paintGround, 420)
    const material = new MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })
    const ground = new Mesh(
      this.resources.track(new CircleGeometry(2200, 48)),
      this.resources.track(material)
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    ground.receiveShadow = true
    this.group.add(ground)
  }

  #buildPad() {
    const width = SITE.halfX * 2
    const depth = SITE.halfZ * 2
    const texture = this.resources.texture('concrete', 256, paintConcrete, width / 12, depth / 12)
    const material = new MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0.02 })
    const pad = new Mesh(
      this.resources.track(new BoxGeometry(width, SITE.padHeight, depth)),
      this.resources.track(material)
    )
    pad.position.y = SITE.padHeight / 2
    pad.receiveShadow = true
    this.group.add(pad)
  }

  #buildRoads() {
    const asphalt = this.resources.track(
      new MeshStandardMaterial({
        map: this.resources.texture('asphalt', 256, paintAsphalt, 1, 1),
        roughness: 0.95,
        metalness: 0
      })
    )
    const width = 10
    const level = SITE.padHeight + 0.04
    const longSide = SITE.halfX * 2 + width * 2
    const shortSide = SITE.halfZ * 2 + width * 2

    const segments = [
      { w: longSide, d: width, x: 0, z: SITE.halfZ + width / 2 },
      { w: longSide, d: width, x: 0, z: -SITE.halfZ - width / 2 },
      { w: width, d: shortSide, x: SITE.halfX + width / 2, z: 0 },
      { w: width, d: shortSide, x: -SITE.halfX - width / 2, z: 0 }
    ]

    for (const { w, d, x, z } of segments) {
      const road = new Mesh(this.resources.track(new BoxGeometry(w, 0.08, d)), asphalt)
      road.position.set(x, 0.04, z)
      road.receiveShadow = true
      this.group.add(road)
    }

    const approach = new Mesh(this.resources.track(new BoxGeometry(width, 0.08, 900)), asphalt)
    approach.position.set(SITE.halfX + width / 2, 0.04, 450)
    approach.receiveShadow = true
    this.group.add(approach)

    this.roadLevel = level
  }

  #buildForest() {
    const random = createRandom(101)
    const count = 700
    const trunks = new InstancedMesh(
      this.resources.track(new CylinderGeometry(0.45, 0.7, 4, 6)),
      this.resources.track(new MeshStandardMaterial({ color: 0x4a3626, roughness: 1 })),
      count
    )
    const crowns = new InstancedMesh(
      this.resources.track(new ConeGeometry(4.2, 11, 7)),
      this.resources.track(new MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 })),
      count
    )

    const dummy = new Object3D()
    const tint = new Color()
    const margin = 40
    let placed = 0

    while (placed < count) {
      const angle = random() * Math.PI * 2
      const radius = 170 + Math.pow(random(), 0.7) * 900
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const insideX = Math.abs(x) < SITE.halfX + margin
      const insideZ = Math.abs(z) < SITE.halfZ + margin
      const onApproach = x > SITE.halfX - 8 && x < SITE.halfX + 30 && z > 0
      if ((insideX && insideZ) || onApproach) continue

      const scale = 0.7 + random() * 0.9
      dummy.position.set(x, 2 * scale, z)
      dummy.rotation.set(0, random() * Math.PI * 2, 0)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      trunks.setMatrixAt(placed, dummy.matrix)

      dummy.position.y = (4 + 5.5) * scale
      dummy.updateMatrix()
      crowns.setMatrixAt(placed, dummy.matrix)

      tint.setHSL(0.27 + random() * 0.06, 0.38 + random() * 0.2, 0.2 + random() * 0.1)
      crowns.setColorAt(placed, tint)
      placed++
    }

    trunks.instanceMatrix.needsUpdate = true
    crowns.instanceMatrix.needsUpdate = true
    crowns.instanceColor.needsUpdate = true
    this.group.add(trunks, crowns)
  }
}
