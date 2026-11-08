import { ALARM_LEVEL, EVENTS } from '../simulation/constants.js'
import { bus } from '../utils/events.js'
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
    this.unsubscribe = bus.on(EVENTS.EXPLOSION, () => this.#explode())
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
    this.unsubscribe()
    window.removeEventListener('pointerdown', this.unlock)
    window.removeEventListener('keydown', this.unlock)
    this.context?.close()
  }

  #explode() {
    if (!this.enabled || !this.context || this.context.state !== 'running') return
    const context = this.context
    const now = context.currentTime
    const length = 3.4

    const output = context.createGain()
    output.gain.value = 0.5
    output.connect(context.destination)

    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * length), context.sampleRate)
    const samples = buffer.getChannelData(0)
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1

    const noise = context.createBufferSource()
    noise.buffer = buffer
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(2800, now)
    filter.frequency.exponentialRampToValueAtTime(80, now + length)
    const body = context.createGain()
    body.gain.setValueAtTime(SILENT, now)
    body.gain.exponentialRampToValueAtTime(1, now + 0.02)
    body.gain.exponentialRampToValueAtTime(SILENT, now + length)
    noise.connect(filter).connect(body).connect(output)
    noise.onended = () => output.disconnect()
    noise.start(now)
    noise.stop(now + length)

    const thump = context.createOscillator()
    const thumpGain = context.createGain()
    thump.type = 'sine'
    thump.frequency.setValueAtTime(74, now)
    thump.frequency.exponentialRampToValueAtTime(26, now + 1.8)
    thumpGain.gain.setValueAtTime(SILENT, now)
    thumpGain.gain.exponentialRampToValueAtTime(1, now + 0.03)
    thumpGain.gain.exponentialRampToValueAtTime(SILENT, now + 2)
    thump.connect(thumpGain).connect(output)
    thump.start(now)
    thump.stop(now + 2.1)
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
