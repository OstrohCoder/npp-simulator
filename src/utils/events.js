export class EventBus {
  constructor() {
    this.listeners = new Map()
  }

  on(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type).add(handler)
    return () => this.off(type, handler)
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      off()
      handler(payload)
    })
    return off
  }

  off(type, handler) {
    const set = this.listeners.get(type)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) {
      this.listeners.delete(type)
    }
  }

  emit(type, payload) {
    const set = this.listeners.get(type)
    if (!set) return
    for (const handler of [...set]) {
      handler(payload)
    }
  }

  clear() {
    this.listeners.clear()
  }
}

export const bus = new EventBus()