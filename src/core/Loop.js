import { SIM } from '../simulation/constants.js'

export class Loop {
  constructor() {
    this.callbacks = new Set()
    this.running = false
    this.frame = 0
    this.last = 0
    this.elapsed = 0
    this.tick = this.tick.bind(this)
  }

  add(callback) {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    this.frame = requestAnimationFrame(this.tick)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.frame)
  }

  tick(now) {
    if (!this.running) return
    const delta = Math.min((now - this.last) / 1000, SIM.maxFrameDelta)
    this.last = now
    this.elapsed += delta
    for (const callback of this.callbacks) {
      callback(delta, this.elapsed)
    }
    this.frame = requestAnimationFrame(this.tick)
  }
}
