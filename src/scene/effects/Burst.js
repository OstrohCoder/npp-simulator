import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial
} from 'three'
import { randomRange } from '../../utils/math.js'

const VERTEX = `
attribute float aLife;
uniform float uSize;
uniform float uPixelScale;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * (0.55 + aLife * 1.5) * uPixelScale / -viewPosition.z;
  gl_Position = projectionMatrix * viewPosition;
}
`

const FRAGMENT = `
varying float vLife;
void main() {
  float body = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  vec3 color = mix(vec3(1.0, 0.93, 0.7), vec3(1.0, 0.42, 0.08), smoothstep(0.0, 0.3, vLife));
  color = mix(color, vec3(0.22, 0.05, 0.02), smoothstep(0.3, 0.85, vLife));
  float alpha = body * (1.0 - smoothstep(0.5, 1.0, vLife));
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export class Burst {
  constructor({ count, size, lifetime, drag, lift }) {
    this.count = count
    this.lifetime = lifetime
    this.drag = drag
    this.lift = lift
    this.cursor = 0

    this.positions = new Float32Array(count * 3)
    this.velocities = new Float32Array(count * 3)
    this.lives = new Float32Array(count).fill(1)
    this.rates = new Float32Array(count)

    const geometry = new BufferGeometry()
    geometry.setAttribute(
      'position',
      new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage)
    )
    geometry.setAttribute('aLife', new BufferAttribute(this.lives, 1).setUsage(DynamicDrawUsage))

    this.material = new ShaderMaterial({
      uniforms: {
        uSize: { value: size },
        uPixelScale: { value: 1000 }
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false
    })

    this.points = new Points(geometry, this.material)
    this.points.frustumCulled = false
    this.points.visible = false
  }

  emit({ count, origin, radius, speed, up }) {
    for (let n = 0; n < count; n++) {
      const index = this.cursor
      this.cursor = (this.cursor + 1) % this.count
      const offset = index * 3
      const angle = Math.random() * Math.PI * 2
      const distance = Math.sqrt(Math.random()) * radius
      const flat = speed * randomRange(0.35, 1)

      this.positions[offset] = origin.x + Math.cos(angle) * distance
      this.positions[offset + 1] = origin.y + randomRange(-0.5, 0.5)
      this.positions[offset + 2] = origin.z + Math.sin(angle) * distance
      this.velocities[offset] = Math.cos(angle) * flat
      this.velocities[offset + 1] = speed * up * randomRange(0.3, 1.3)
      this.velocities[offset + 2] = Math.sin(angle) * flat
      this.lives[index] = 0
      this.rates[index] = 1 / (this.lifetime * randomRange(0.7, 1.3))
    }
    this.points.visible = true
  }

  update(delta, pixelScale) {
    this.material.uniforms.uPixelScale.value = pixelScale
    const damping = Math.exp(-this.drag * delta)

    for (let i = 0; i < this.count; i++) {
      if (this.lives[i] >= 1) continue
      const offset = i * 3
      this.lives[i] = Math.min(1, this.lives[i] + this.rates[i] * delta)
      this.velocities[offset] *= damping
      this.velocities[offset + 1] = this.velocities[offset + 1] * damping + this.lift * delta
      this.velocities[offset + 2] *= damping
      this.positions[offset] += this.velocities[offset] * delta
      this.positions[offset + 1] += this.velocities[offset + 1] * delta
      this.positions[offset + 2] += this.velocities[offset + 2] * delta
    }

    const attributes = this.points.geometry.attributes
    attributes.position.needsUpdate = true
    attributes.aLife.needsUpdate = true
  }

  clear() {
    this.lives.fill(1)
    this.points.geometry.attributes.aLife.needsUpdate = true
    this.points.visible = false
  }
}
