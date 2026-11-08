export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function lerp(a, b, t) {
  return a + (b - a) * t
}

export function inverseLerp(a, b, value) {
  if (a === b) return 0
  return clamp((value - a) / (b - a), 0, 1)
}

export function remap(value, inMin, inMax, outMin, outMax) {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, value))
}

export function smoothstep(edge0, edge1, value) {
  const t = inverseLerp(edge0, edge1, value)
  return t * t * (3 - 2 * t)
}

export function approach(current, target, maxDelta) {
  if (Math.abs(target - current) <= maxDelta) return target
  return current + Math.sign(target - current) * maxDelta
}

export function damp(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt))
}

export function randomRange(min, max) {
  return min + Math.random() * (max - min)
}

export function chance(probability) {
  return Math.random() < probability
}

export function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}