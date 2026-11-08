import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

export class Resources {
  constructor(renderer) {
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy()
    this.sources = new Map()
    this.textures = new Map()
    this.disposables = new Set()
  }

  track(item) {
    this.disposables.add(item)
    return item
  }

  texture(key, size, paint, repeatX = 1, repeatY = repeatX) {
    const id = `${key}:${repeatX}:${repeatY}`
    if (this.textures.has(id)) return this.textures.get(id)

    let source = this.sources.get(key)
    if (!source) {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      paint(canvas.getContext('2d'), size)
      source = new CanvasTexture(canvas)
      source.wrapS = RepeatWrapping
      source.wrapT = RepeatWrapping
      source.colorSpace = SRGBColorSpace
      source.anisotropy = this.maxAnisotropy
      this.sources.set(key, this.track(source))
    }

    const texture = source.clone()
    texture.repeat.set(repeatX, repeatY)
    texture.needsUpdate = true
    this.textures.set(id, this.track(texture))
    return texture
  }

  dispose() {
    for (const item of this.disposables) item.dispose()
    this.disposables.clear()
    this.sources.clear()
    this.textures.clear()
  }
}
