import { Group, Vector2 } from 'three'
import { Lighting } from './Lighting.js'
import { Environment } from './Environment.js'
import { createMaterials } from './materials.js'
import { LAYOUT } from './layout.js'
import { ReactorBuilding } from './buildings/ReactorBuilding.js'
import { TurbineHall } from './buildings/TurbineHall.js'
import { CoolingTower } from './buildings/CoolingTower.js'
import { ControlRoom } from './buildings/ControlRoom.js'
import { PlantPipes } from './buildings/Pipes.js'
import { ContainmentBreach } from './effects/ContainmentBreach.js'
import { AccidentEffects } from './effects/AccidentEffects.js'

export class World {
  constructor(engine) {
    this.engine = engine
    this.scene = engine.scene
    this.lighting = new Lighting(this.scene)
    this.environment = new Environment(this.scene, engine.resources)
    this.materials = createMaterials(engine.resources)
    this.plant = new Group()
    this.plant.name = 'plant'
    this.scene.add(this.plant)
    this.modules = new Map()
    this.cutaway = false
    this.drawingSize = new Vector2()
    this.#build()
  }

  add(name, module) {
    this.modules.set(name, module)
    this.plant.add(module.group)
    return module
  }

  get(name) {
    return this.modules.get(name)
  }

  setCutaway(value) {
    this.cutaway = Boolean(value)
    this.get('reactor').setCutaway(this.cutaway)
    this.get('turbineHall').setCutaway(this.cutaway)
  }

  toggleCutaway() {
    this.setCutaway(!this.cutaway)
  }

  update(delta, elapsed, snapshot) {
    this.lighting.update(delta, snapshot.state)
    this.environment.update(this.lighting)

    this.engine.renderer.getDrawingBufferSize(this.drawingSize)
    const fov = (this.engine.camera.fov * Math.PI) / 180
    const view = { pixelScale: this.drawingSize.y / (2 * Math.tan(fov / 2)) }

    for (const module of this.modules.values()) {
      module.update?.(delta, elapsed, snapshot, view)
    }
  }

  dispose() {
    this.scene.traverse((object) => {
      object.geometry?.dispose()
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => material?.dispose())
    })
  }

  #build() {
    const { resources } = this.engine
    this.add('reactor', new ReactorBuilding(resources, this.materials))
    this.add('turbineHall', new TurbineHall(resources, this.materials))
    this.add('controlRoom', new ControlRoom(resources, this.materials))
    LAYOUT.coolingTowers.forEach((place, index) => {
      this.add(`tower${index}`, new CoolingTower(resources, this.materials, place))
    })
    this.add('pipes', new PlantPipes(resources))
    this.add('breach', new ContainmentBreach(this.engine, this.get('reactor')))
    this.add(
      'emissions',
      new AccidentEffects(this.engine, {
        turbineHall: this.get('turbineHall'),
        controlRoom: this.get('controlRoom')
      })
    )
  }
}
