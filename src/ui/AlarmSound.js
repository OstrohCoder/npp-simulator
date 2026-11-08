import { ALARM_LEVEL } from '../simulation/constants.js'
import { storage } from '../utils/storage.js'

const STORAGE_KEY = 'npp-simulator:sound'
const LOOKAHEAD = 0.3
const VOLUME = 0.16
const TONE_GAP = 0.05
const ATTACK = 0.01
const SILENT = 0.0001

const PATTERNS = Object.freeze({
  [ALARM_LEVEL.WARNING]: {
    interval: 2.5,
    tones: [{ frequency: 740, length: 0.2 }]
  },
  [ALARM_LEVEL.CRITICAL]: {
    interval: 1.1,
    tones: [
      { frequency: 980, length: 0.15 },
      { frequency: 740, length: 0.15 },
      { frequency: 980, length: 0.15 }
    ]
  }
})

function urgency(alarms) {
  let level = null
  for (const alarm of alarms) {
    if (alarm.acknowledged) continue
    if (alarm.level === ALARM_LEVEL.CRITICAL) return ALARM_LEVEL.CRITICAL
    level = ALARM_LEVEL.WARNING
  }
  return level
}

export class AlarmSound {
  constructor() {
    this.enabled = storage.get(STORAGE_KEY) !== 'off'
    this.context = null
    this.master = null
    this.level = null
    this.nextBeat = 0
    this.unlock = this.unlock.bind(this)
    window.addEventListener('pointerdown', this.unlock)
    window.addEventListener('keydown', this.unlock)
  }

  unlock() {
    if (!this.context) {
      const Context = window.AudioContext ?? window.webkitAudioContext
      if (!Context) return
      this.context = new Context()
      this.master = this.context.createGain()
      this.master.gain.value = VOLUME
      this.master.connect(this.context.destination)
    }
    if (this.context.state === 'suspended') this.context.resume()
  }

  setEnabled(value) {
    this.enabled = Boolean(value)
    storage.set(STORAGE_KEY, this.enabled ? 'on' : 'off')
  }

  update({ alarms, paused }) {
    if (!this.context || this.context.state !== 'running') return

    const level = this.enabled && !paused ? urgency(alarms) : null
    if (level !== this.level) {
      this.level = level
      this.nextBeat = 0
    }
    if (!level) return

    const now = this.context.currentTime
    const pattern = PATTERNS[level]
    if (this.nextBeat < now) this.nextBeat = now
    while (this.nextBeat < now + LOOKAHEAD) {
      this.#play(pattern, this.nextBeat)
      this.nextBeat += pattern.interval
    }
  }

  destroy() {
    window.removeEventListener('pointerdown', this.unlock)
    window.removeEventListener('keydown', this.unlock)
    this.context?.close()
  }

  #play(pattern, time) {
    let start = time
    for (const { frequency, length } of pattern.tones) {
      const oscillator = this.context.createOscillator()
      const envelope = this.context.createGain()
      oscillator.type = 'square'
      oscillator.frequency.setValueAtTime(frequency, start)
      envelope.gain.setValueAtTime(SILENT, start)
      envelope.gain.exponentialRampToValueAtTime(1, start + ATTACK)
      envelope.gain.exponentialRampToValueAtTime(SILENT, start + length)
      oscillator.connect(envelope).connect(this.master)
      oscillator.start(start)
      oscillator.stop(start + length + 0.02)
      start += length + TONE_GAP
    }
  }
}
