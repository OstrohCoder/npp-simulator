import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Vector3
} from 'three'
import { LAYOUT, SITE, SIZES } from '../layout.js'
import { Burst } from './Burst.js'
import { SteamPlume } from '../SteamPlume.js'
import { EVENTS } from '../../simulation/constants.js'
import { bus } from '../../utils/events.js'
import { clamp, randomRange } from '../../utils/math.js'

const { radius: RADIUS, wallHeight: WALL_HEIGHT } = SIZES.containment

const PHASE = Object.freeze({ IDLE: 'idle', PRELUDE: 'prelude', BLAST: 'blast' })
const CAP_ANGLE = 0.55
const OPENING_RADIUS = RADIUS * Math.sin(CAP_ANGLE)
const OPENING_Y = WALL_HEIGHT + RADIUS * Math.cos(CAP_ANGLE)
const CAP_CENTER = (RADIUS * (1 + Math.cos(CAP_ANGLE))) / 2
const CAP_REST = 1.6

const PRELUDE = 2.5
const GRAVITY = 12
const GROUND = 0.3
const DEBRIS_COUNT = 90
const FLASH_TIME = 0.45
const LIGHT_TIME = 0.9
const SHOCK_TIME = 2.8
const SHOCK_SPEED = 70
const FLASH_LIGHT = 30000
const FIRE_LIGHT = 1800
const FLAME_RATE = 45
const CHAR = new Color(0x5a5551)

export class ContainmentBreach {
  constructor(engine, reactor) {
    this.engine = engine
    this.reactor = reactor
    this.group = new Group()
    this.group.position.set(LAYOUT.reactor.x, SITE.padHeight, LAYOUT.reactor.z)

    this.phase = PHASE.IDLE
    this.clock = 0
    this.flameBudget = 0
    this.capLanded = false
    this.debrisDone = true
    this.velocity = new Vector3()
    this.spin = new Vector3()
    this.origin = new Vector3(0, OPENING_Y, 0)
    this.flameOrigin = new Vector3(0, OPENING_Y - 1, 0)
    this.dummy = new Object3D()

    this.#buildStructure()
    this.#buildFire()
    this.#buildDebris()

    this.unsubscribers = [
      bus.on(EVENTS.MELTDOWN, () => this.#arm()),
      bus.on(EVENTS.PLANT_RESET, () => this.#reset())
    ]
  }

  update(delta, elapsed, snapshot, view) {
    if (this.phase === PHASE.IDLE) return
    this.clock += delta

    if (this.phase === PHASE.PRELUDE) {
      this.engine.shake(0.1 + 0.14 * clamp(this.clock / PRELUDE, 0, 1))
      if (this.clock >= PRELUDE) this.#detonate()
      return
    }
    this.#animateBlast(delta, elapsed, view.pixelScale)
  }

  destroy() {
    this.unsubscribers.forEach((off) => off())
    this.unsubscribers = []
  }

  #buildStructure() {
    const material = this.reactor.shellMaterial

    this.ruin = new Mesh(
      new SphereGeometry(RADIUS, 72, 28, 0, Math.PI * 2, CAP_ANGLE, Math.PI / 2 - CAP_ANGLE),
      material
    )
    this.ruin.position.y = WALL_HEIGHT

    this.cap = new Mesh(
      new SphereGeometry(RADIUS, 40, 10, 0, Math.PI * 2, 0, CAP_ANGLE).translate(0, -CAP_CENTER, 0),
      material
    )

    for (const mesh of [this.ruin, this.cap]) {
      mesh.visible = false
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
    this.reactor.group.add(this.ruin, this.cap)
  }

  #buildFire() {
    this.fireball = new Burst({ count: 150, size: 16, lifetime: 3.4, drag: 0.9, lift: 8 })
    this.flames = new Burst({ count: 70, size: 8, lifetime: 1.3, drag: 0.4, lift: 5 })

    this.smoke = new SteamPlume({
      count: 240,
      radius: 8,
      size: 30,
      rise: 15,
      lifetime: 24,
      wind: [5, 0, 2],
      spread: 2.2,
      color: 0x222426,
      opacity: 0.8
    })
    this.smoke.points.position.set(0, OPENING_Y, 0)
    this.smoke.points.visible = false

    const additive = (color) =>
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
        fog: false
      })

    this.flash = new Mesh(new SphereGeometry(1, 24, 16), additive(0xfff1d6))
    this.flash.position.y = OPENING_Y

    this.shock = new Mesh(
      new RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2),
      Object.assign(additive(0xffe2b8), { side: DoubleSide })
    )
    this.shock.position.y = 0.2

    this.glow = new Mesh(
      new CircleGeometry(OPENING_RADIUS * 0.95, 40).rotateX(-Math.PI / 2),
      additive(0xff6a1f)
    )
    this.glow.position.y = OPENING_Y - 0.6

    this.light = new PointLight(0xff9650, 0, 420, 2)
    this.light.position.set(0, OPENING_Y, 0)

    for (const object of [this.flash, this.shock, this.glow]) object.visible = false

    this.group.add(
      this.fireball.points,
      this.flames.points,
      this.smoke.points,
      this.flash,
      this.shock,
      this.glow,
      this.light
    )
  }

  #buildDebris() {
    this.debris = new InstancedMesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0.05 }),
      DEBRIS_COUNT
    )
    this.debris.visible = false
    this.debris.frustumCulled = false
    this.debris.castShadow = true

    const tint = new Color()
    this.chunks = Array.from({ length: DEBRIS_COUNT }, (_, index) => {
      this.debris.setColorAt(index, tint.setHSL(0, 0, randomRange(0.22, 0.5)))
      return {
        position: new Vector3(),
        velocity: new Vector3(),
        rotation: new Vector3(),
        spin: new Vector3(),
        size: 1,
        settled: true
      }
    })
    this.debris.instanceColor.needsUpdate = true
    this.group.add(this.debris)
  }

  #arm() {
    if (this.phase !== PHASE.IDLE) return
    this.phase = PHASE.PRELUDE
    this.clock = 0
  }

  #detonate() {
    this.phase = PHASE.BLAST
    this.clock = 0
    this.capLanded = false
    this.flameBudget = 0

    const shell = this.reactor.shellMaterial
    shell.side = DoubleSide
    shell.needsUpdate = true

    this.reactor.dome.visible = false
    this.ruin.visible = true
    this.cap.visible = true
    this.cap.position.set(0, WALL_HEIGHT + CAP_CENTER, 0)
    this.cap.rotation.set(0, 0, 0)
    this.velocity.set(randomRange(-12, -6), randomRange(24, 32), randomRange(-5, 5))
    this.spin.set(randomRange(-1.5, 1.5), randomRange(-1, 1), randomRange(-1.5, 1.5))

    this.fireball.emit({ count: 150, origin: this.origin, radius: 5, speed: 36, up: 0.6 })
    this.#launchDebris()

    this.flash.visible = true
    this.shock.visible = true
    this.glow.visible = true
    this.debris.visible = true
    this.smoke.points.visible = true

    this.engine.shake(1)
    bus.emit(EVENTS.EXPLOSION)
  }

  #launchDebris() {
    for (const chunk of this.chunks) {
      const azimuth = Math.PI + randomRange(-2.2, 2.2)
      const radial = randomRange(0, 9)
      const speed = randomRange(10, 46)
      const cos = Math.cos(azimuth)
      const sin = Math.sin(azimuth)

      chunk.position.set(cos * radial, randomRange(46, 56), sin * radial)
      chunk.velocity.set(cos * speed, randomRange(14, 44), sin * speed)
      chunk.rotation.set(
        randomRange(0, Math.PI),
        randomRange(0, Math.PI),
        randomRange(0, Math.PI)
      )
      chunk.spin.set(randomRange(-6, 6), randomRange(-6, 6), randomRange(-6, 6))
      chunk.size = randomRange(0.7, 2.6) * (Math.random() < 0.15 ? 2 : 1)
      chunk.settled = false
    }
    this.debrisDone = false
  }

  #animateBlast(delta, elapsed, pixelScale) {
    const t = this.clock
    const flicker = 0.8 + 0.2 * Math.sin(elapsed * 23) * Math.sin(elapsed * 9.7)

    const flashK = clamp(1 - t / FLASH_TIME, 0, 1)
    this.flash.visible = flashK > 0
    this.flash.scale.setScalar(8 + t * 70)
    this.flash.material.opacity = flashK * flashK

    const shockK = clamp(t / SHOCK_TIME, 0, 1)
    this.shock.visible = shockK < 1
    this.shock.scale.setScalar(2 + t * SHOCK_SPEED)
    this.shock.material.opacity = 0.7 * (1 - shockK) ** 2

    const lightK = clamp(1 - t / LIGHT_TIME, 0, 1)
    this.light.intensity =
      FLASH_LIGHT * lightK * lightK + FIRE_LIGHT * flicker * clamp(t / 0.3, 0, 1)
    this.glow.material.opacity = 0.5 * flicker * clamp(t / 0.4, 0, 1)

    this.flameBudget += FLAME_RATE * delta
    const flames = Math.floor(this.flameBudget)
    if (flames > 0) {
      this.flameBudget -= flames
      this.flames.emit({
        count: flames,
        origin: this.flameOrigin,
        radius: OPENING_RADIUS * 0.8,
        speed: 5,
        up: 2.2
      })
    }

    this.fireball.update(delta, pixelScale)
    this.flames.update(delta, pixelScale)
    this.smoke.update(delta, clamp(t / 4, 0, 1) * 1.2, pixelScale)

    this.#updateCap(delta)
    this.#updateDebris(delta)
    this.reactor.shellMaterial.color.lerp(CHAR, 1 - Math.exp(-0.5 * delta))
  }

  #updateCap(delta) {
    if (this.capLanded) return
    this.velocity.y -= GRAVITY * delta
    this.cap.position.addScaledVector(this.velocity, delta)
    this.cap.rotation.x += this.spin.x * delta
    this.cap.rotation.y += this.spin.y * delta
    this.cap.rotation.z += this.spin.z * delta

    if (this.cap.position.y <= CAP_REST && this.velocity.y < 0) {
      this.cap.position.y = CAP_REST
      this.cap.rotation.x = randomRange(-0.25, 0.25)
      this.cap.rotation.z = randomRange(-0.25, 0.25)
      this.capLanded = true
      this.engine.shake(0.45)
    }
  }

  #updateDebris(delta) {
    if (this.debrisDone) return
    let moving = false

    this.chunks.forEach((chunk, index) => {
      if (!chunk.settled) {
        moving = true
        chunk.velocity.y -= GRAVITY * delta
        chunk.position.addScaledVector(chunk.velocity, delta)
        chunk.rotation.addScaledVector(chunk.spin, delta)

        if (chunk.position.y <= GROUND && chunk.velocity.y < 0) {
          chunk.position.y = GROUND
          if (chunk.velocity.y < -7) {
            chunk.velocity.y *= -0.25
            chunk.velocity.x *= 0.55
            chunk.velocity.z *= 0.55
            chunk.spin.multiplyScalar(0.5)
          } else {
            chunk.velocity.set(0, 0, 0)
            chunk.spin.set(0, 0, 0)
            chunk.settled = true
          }
        }
      }

      this.dummy.position.copy(chunk.position)
      this.dummy.rotation.set(chunk.rotation.x, chunk.rotation.y, chunk.rotation.z)
      this.dummy.scale.set(chunk.size, chunk.size * 0.8, chunk.size * 1.2)
      this.dummy.updateMatrix()
      this.debris.setMatrixAt(index, this.dummy.matrix)
    })

    this.debris.instanceMatrix.needsUpdate = true
    this.debrisDone = !moving
  }

  #reset() {
    this.phase = PHASE.IDLE
    this.clock = 0
    this.capLanded = false
    this.debrisDone = true

    const shell = this.reactor.shellMaterial
    shell.side = FrontSide
    shell.color.set(0xffffff)
    shell.needsUpdate = true

    this.reactor.dome.visible = true
    this.ruin.visible = false
    this.cap.visible = false
    for (const object of [this.flash, this.shock, this.glow, this.debris]) object.visible = false
    this.light.intensity = 0

    this.fireball.clear()
    this.flames.clear()
    this.smoke.reset()
    this.smoke.points.visible = false
  }
}
