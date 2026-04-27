import { spawn } from 'node:child_process'
import type { LogStream } from './types'

export interface RunLoggedOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  onLine?: (stream: Extract<LogStream, 'stdout' | 'stderr'>, line: string) => void
}

export interface RunLoggedResult {
  stdout: string
  stderr: string
}

function pumpLines(
  stream: NodeJS.ReadableStream,
  name: Extract<LogStream, 'stdout' | 'stderr'>,
  onLine: (stream: Extract<LogStream, 'stdout' | 'stderr'>, line: string) => void,
  onChunk: (chunk: string) => void
): () => void {
  let buffer = ''

  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    onChunk(chunk)
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.length > 0) onLine(name, line)
    }
  })

  return () => {
    if (buffer.length > 0) onLine(name, buffer)
    buffer = ''
  }
}

export function runLogged(
  command: string,
  args: string[],
  options: RunLoggedOptions = {}
): Promise<RunLoggedResult> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let spawnError: Error | null = null

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      shell: false
    })

    const emitLine =
      options.onLine ??
      (() => {
        return undefined
      })

    const flushStdout = pumpLines(
      child.stdout,
      'stdout',
      emitLine,
      (chunk) => {
        stdout += chunk
      }
    )
    const flushStderr = pumpLines(
      child.stderr,
      'stderr',
      emitLine,
      (chunk) => {
        stderr += chunk
      }
    )

    child.on('error', (error) => {
      spawnError = error
    })

    child.on('close', (code) => {
      flushStdout()
      flushStderr()

      if (spawnError) {
        reject(spawnError)
        return
      }

      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`))
    })
  })
}
