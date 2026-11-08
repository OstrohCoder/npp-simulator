import { Color, DirectionalLight, HemisphereLight } from 'three'
import { PLANT_STATE } from '../simulation/constants.js'
import { damp } from '../utils/math.js'

const MOODS = Object.freeze({
  [PLANT_STATE.NORMAL]: {
    sky: 0x5d8fc4,
    horizon: 0xc3d6e6,
    ground: 0x4a5a45,
    sun: 0xfff1da,
    hemi: 1.0,
    intensity: 3.2
  },
  [PLANT_STATE.WARNING]: {
    sky: 0x8a8f99,
    horizon: 0xd3c5ad,
    ground: 0x504b3e,
    sun: 0xffd9a3,
    hemi: 0.85,
    intensity: 2.5
  },
  [PLANT_STATE.EMERGENCY]: {
    sky: 0x6d5560,
    horizon: 0xc98a7c,
    ground: 0x4a3a3a,
    sun: 0xff9d84,
    hemi: 0.7,
    intensity: 1.8
  }
})

const RATE = 0.8

export class Lighting {
  constructor(scene) {
    this.sky = new Color(MOODS[PLANT_STATE.NORMAL].sky)
    this.horizon = new Color(MOODS[PLANT_STATE.NORMAL].horizon)

    this.hemisphere = new HemisphereLight(this.horizon, MOODS[PLANT_STATE.NORMAL].ground, 1)
    this.sun = new DirectionalLight(MOODS[PLANT_STATE.NORMAL].sun, 3.2)
    this.sun.position.set(130, 190, 90)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.6

    const camera = this.sun.shadow.camera
    camera.left = -170
    camera.right = 170
    camera.top = 170
    camera.bottom = -170
    camera.near = 10
    camera.far = 520

    scene.add(this.hemisphere, this.sun, this.sun.target)

    this.target = {
      sky: new Color(),
      horizon: new Color(),
      ground: new Color(),
      sun: new Color()
    }
  }

  update(delta, state) {
    const mood = MOODS[state] ?? MOODS[PLANT_STATE.NORMAL]
    const k = 1 - Math.exp(-RATE * delta)

    this.sky.lerp(this.target.sky.set(mood.sky), k)
    this.horizon.lerp(this.target.horizon.set(mood.horizon), k)
    this.hemisphere.color.copy(this.horizon)
    this.hemisphere.groundColor.lerp(this.target.ground.set(mood.ground), k)
    this.sun.color.lerp(this.target.sun.set(mood.sun), k)
    this.hemisphere.intensity = damp(this.hemisphere.intensity, mood.hemi, RATE, delta)
    this.sun.intensity = damp(this.sun.intensity, mood.intensity, RATE, delta)
  }
}
