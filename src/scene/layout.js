export const SITE = Object.freeze({
  halfX: 150,
  halfZ: 120,
  padHeight: 0.6
})

export const LAYOUT = Object.freeze({
  reactor: { x: -35, z: 10 },
  turbineHall: { x: 30, z: 10 },
  controlRoom: { x: -5, z: 62 },
  coolingTowers: [
    { x: -30, z: -72 },
    { x: 40, z: -72 }
  ]
})

export const SIZES = Object.freeze({
  containment: { radius: 20, wallHeight: 38 },
  turbineHall: { length: 70, width: 30, height: 26 },
  controlRoom: { width: 40, depth: 22, height: 14 },
  coolingTower: { height: 80, throatHeight: 60, throatRadius: 15, baseRadius: 24 }
})

export const VIEWS = Object.freeze({
  overview: { position: [190, 110, 230], target: [0, 25, -5] },
  reactor: { position: [-100, 48, 90], target: [-35, 25, 10] },
  core: { position: [-12, 24, 32], target: [-35, 10, 10] },
  turbine: { position: [110, 38, 85], target: [30, 10, 10] },
  towers: { position: [135, 60, -20], target: [5, 35, -72] },
  control: { position: [40, 22, 118], target: [-5, 6, 62] }
})
