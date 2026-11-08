import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Resources } from './Resources.js'
import { VIEWS } from '../scene/layout.js'
import { smoothstep } from '../utils/math.js'

export class Engine {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.toneMapping = ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.9
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap

    this.scene = new Scene()
    this.camera = new PerspectiveCamera(48, 1, 0.5, 4000)
    this.resources = new Resources(this.renderer)
    this.transition = null
    this.view = null

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.screenSpacePanning = false
    this.controls.minDistance = 18
    this.controls.maxDistance = 450
    this.controls.maxPolarAngle = Math.PI * 0.49
    this.controls.addEventListener('start', () => {
      this.transition = null
      this.view = null
    })

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas)

    this.setView('overview')
    this.resize()
  }

  setView(name) {
    const view = VIEWS[name]
    if (!view) return
    this.view = name
    this.camera.position.set(...view.position)
    this.controls.target.set(...view.target)
    this.controls.update()
  }

  flyTo(name, duration = 1.6) {
    const view = VIEWS[name]
    if (!view) return
    this.view = name
    this.transition = {
      fromPosition: this.camera.position.clone(),
      toPosition: new Vector3(...view.position),
      fromTarget: this.controls.target.clone(),
      toTarget: new Vector3(...view.target),
      duration,
      elapsed: 0
    }
  }

  resize() {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (width === 0 || height === 0) return
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  render(delta) {
    this.#advanceTransition(delta)
    this.controls.update(delta)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.observer.disconnect()
    this.controls.dispose()
    this.resources.dispose()
    this.renderer.dispose()
  }

  #advanceTransition(delta) {
    const move = this.transition
    if (!move) return
    move.elapsed += delta
    const k = smoothstep(0, 1, move.elapsed / move.duration)
    this.camera.position.lerpVectors(move.fromPosition, move.toPosition, k)
    this.controls.target.lerpVectors(move.fromTarget, move.toTarget, k)
    if (move.elapsed >= move.duration) this.transition = null
  }
}
