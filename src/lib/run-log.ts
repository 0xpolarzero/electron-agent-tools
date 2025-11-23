import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import * as path from 'node:path'

export type LogSource =
  | 'stdout'
  | 'stderr'
  | 'main'
  | 'renderer'
  | 'preload'
  | 'isolated'
  | 'worker'
  | 'network'
  | 'ipc'
  | 'system'
  | 'screenshot'
  | 'domdump'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'log'

const sanitize = (value: unknown): string => {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const formatTail = (meta?: Record<string, unknown>): string => {
  if (!meta) return ''
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${sanitize(v)}`)
  return parts.length ? ` ${parts.join(' ')}` : ''
}

export class RunLogger {
  #stream: WriteStream
  #closed = false
  path: string

  constructor(runDir: string, fileName = 'run.log') {
    mkdirSync(runDir, { recursive: true })
    this.path = path.join(runDir, fileName)
    this.#stream = createWriteStream(this.path, { flags: 'a' })
  }

  log(source: LogSource, level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (this.#closed) return
    const ts = new Date().toISOString()
    const compact = message.replace(/[\r\n]+/g, ' ').trim()
    const line = `[${ts}] [${source}] [${level}] ${compact}${formatTail(meta)}\n`
    this.#stream.write(line)
  }

  logChunk(source: LogSource, level: LogLevel, chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
    for (const line of text.split(/\r?\n/)) {
      if (!line.length) continue
      this.log(source, level, line)
    }
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    try {
      this.#stream.end()
    } catch {}
  }
}

export const openRunLogger = (runDir: string, fileName = 'run.log'): RunLogger =>
  new RunLogger(runDir, fileName)
