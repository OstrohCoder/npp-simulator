import { Color, MeshStandardMaterial } from 'three'
import { createRandom } from '../utils/math.js'

export const SIGNAL = Object.freeze({
  green: new Color(0x48bb78),
  amber: new Color(0xf6ad55),
  red: new Color(0xf56565),
  cyan: new Color(0x4fd1c5),
  off: new Color(0x20262b)
})

const STATE_COLORS = Object.freeze({
  normal: SIGNAL.green,
  warning: SIGNAL.amber,
  emergency: SIGNAL.red
})

export function stateColor(state) {
  return STATE_COLORS[state] ?? SIGNAL.green
}

function paintWall(ctx, size) {
  const random = createRandom(53)
  ctx.fillStyle = '#c8cac7'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 5000; i++) {
    const shade = 150 + random() * 70
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.22)`
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2)
  }
  ctx.strokeStyle = 'rgba(55, 60, 66, 0.3)'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, size - 2, size - 2)
  ctx.beginPath()
  ctx.moveTo(size / 2, 0)
  ctx.lineTo(size / 2, size)
  ctx.stroke()
}

function paintRoof(ctx, size) {
  ctx.fillStyle = '#5a5f66'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
  for (let x = 0; x < size; x += 16) ctx.fillRect(x, 0, 3, size)
}

export function createMaterials(resources) {
  const standard = (parameters) => resources.track(new MeshStandardMaterial(parameters))

  return {
    concrete: standard({ color: 0xa9aaa7, roughness: 0.9, metalness: 0.02 }),
    darkConcrete: standard({ color: 0x7d7f80, roughness: 0.95, metalness: 0.02 }),
    steel: standard({ color: 0x8d98a2, roughness: 0.38, metalness: 0.75 }),
    darkSteel: standard({ color: 0x4b535b, roughness: 0.45, metalness: 0.8 }),
    boiler: standard({ color: 0x9a6a58, roughness: 0.5, metalness: 0.55 }),
    generator: standard({ color: 0x3d5f78, roughness: 0.42, metalness: 0.6 }),
    white: standard({ color: 0xe8eaec, roughness: 0.7, metalness: 0.05 }),
    red: standard({ color: 0xc43c32, roughness: 0.7, metalness: 0.05 }),
    roof: standard({
      map: resources.texture('roof', 128, paintRoof, 12, 6),
      roughness: 0.7,
      metalness: 0.3
    }),
    glass: standard({
      color: 0x8fc1dd,
      roughness: 0.05,
      metalness: 0.3,
      transparent: true,
      opacity: 0.32,
      depthWrite: false
    }),
    panel(width, height) {
      const texture = resources.texture(
        'wall',
        256,
        paintWall,
        Math.max(1, width / 8),
        Math.max(1, height / 8)
      )
      return standard({ map: texture, roughness: 0.88, metalness: 0.04 })
    },
    lamp(color) {
      return standard({ color: 0x15181c, emissive: color, emissiveIntensity: 1, roughness: 0.4 })
    }
  }
}

export function applyShadows(root) {
  root.traverse((object) => {
    if (!object.isMesh) return
    object.castShadow = !object.material.transparent
    object.receiveShadow = true
  })
}
