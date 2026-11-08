import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Points,
  ShaderMaterial
} from 'three'
import { clamp } from '../utils/math.js'

const VERTEX = `
attribute float aLife;
uniform float uSize;
uniform float uPixelScale;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (0.4 + aLife * 1.8) * uPixelScale / -viewPosition.z;
  gl_Position = projectionMatrix * viewPosition;
}
`

const FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;
void main() {
  float distanceToCenter = length(gl_PointCoord - 0.5);
  float body = smoothstep(0.5, 0.05, distanceToCenter);
  float fade = smoothstep(0.0, 0.1, vLife) * (1.0 - vLife);
  float alpha = body * fade * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class SteamPlume {
  constructor({
    count = 80,
    radius = 5,
    size = 12,
    rise = 6,
    lifetime = 14,
    wind = [2.5, 0, 1],
    spread = 1.2,
    color = 0xeef3f6,
    opacity = 0.55
  } = {}) {
    this.count = count
    this.radius = radius
    this.rise = rise
    this.lifetime = lifetime
    this.wind = wind
    this.spread = spread
    this.opacity = opacity
    this.budget = 0

    this.positions = new Float32Array(count * 3)
    this.lives = new Float32Array(count).fill(1)
    this.seeds = Float32Array.from({ length: count }, () => Math.random())

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage)
    )
    geometry.setAttribute('aLife', new BufferAttribute(this.lives, 1).setUsage(DynamicDrawUsage))

    this.material = new ShaderMaterial({
      uniforms: {
        uSize: { value: size },
        uPixelScale: { value: 1000 },
        uColor: { value: new Color(color) },
        uOpacity: { value: 0 }
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false
    })

    this.points = new Points(geometry, this.material)
    this.points.frustumCulled = false
  }

  update(delta, intensity, pixelScale) {
    const level = clamp(intensity, 0, 1.5)
    const uniforms = this.material.uniforms
    uniforms.uPixelScale.value = pixelScale
    uniforms.uOpacity.value = this.opacity * Math.min(1, 0.35 + level * 0.65)

    this.budget = Math.min(3, this.budget + (this.count / this.lifetime) * level * delta)
    const speed = this.rise * (0.55 + 0.45 * Math.min(level, 1))

    for (let i = 0; i < this.count; i++) {
      const offset = i * 3
      if (this.lives[i] >= 1) {
        if (this.budget < 1) continue
        this.budget -= 1
        this.#spawn(i, offset)
        continue
      }
      this.lives[i] = Math.min(1, this.lives[i] + delta / this.lifetime)
      const phase = this.seeds[i] * 40 + this.lives[i] * 7
      this.positions[offset] += (this.wind[0] + Math.sin(phase) * this.spread) * delta
      this.positions[offset + 1] += speed * delta
      this.positions[offset + 2] += (this.wind[2] + Math.cos(phase) * this.spread) * delta
    }

    const attributes = this.points.geometry.attributes
    attributes.position.needsUpdate = true
    attributes.aLife.needsUpdate = true
  }

  reset() {
    this.lives.fill(1)
    this.budget = 0
  }

  #spawn(index, offset) {
    const angle = Math.random() * Math.PI * 2
    const distance = Math.sqrt(Math.random()) * this.radius
    this.positions[offset] = Math.cos(angle) * distance
    this.positions[offset + 1] = 0
    this.positions[offset + 2] = Math.sin(angle) * distance
    this.lives[index] = 0
    this.seeds[index] = Math.random()
  }
}
