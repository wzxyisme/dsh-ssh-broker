import { createHash, timingSafeEqual } from 'node:crypto'
import ssh2 from 'ssh2'

const { Client, utils } = ssh2

export const OUTPUT_BYTES = 8192
export const EXEC_MS = 30_000
const HANDSHAKE_MS = 5000

export function pinBytes(fingerprint) {
  if (typeof fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) return null
  const pin = Buffer.from(fingerprint.slice(7), 'base64')
  return `SHA256:${pin.toString('base64').slice(0, -1)}` === fingerprint ? pin : null
}

export function authOptions(payload) {
  if (payload?.kind === 'password' && typeof payload.value === 'string' && payload.value.length > 0 && payload.value.length <= 4096 && !payload.value.includes('\0') && payload.passphrase === undefined) {
    return { password: payload.value }
  }
  if (payload?.kind !== 'key' || typeof payload.value !== 'string' || payload.value.length > 32_768 || typeof payload.passphrase !== 'string' || payload.passphrase.length > 4096) return null
  try {
    const privateKey = utils.parseKey(payload.value, payload.passphrase || undefined)
    if (privateKey instanceof Error || Array.isArray(privateKey) || !privateKey.isPrivateKey()) return null
    return { privateKey: payload.value, passphrase: payload.passphrase || undefined }
  } catch {
    return null
  }
}

export function remoteCommand(command, workdir) {
  if (workdir === undefined) return command
  const quoted = `'${workdir.replaceAll("'", "'\\''")}'`
  return `cd ${quoted} || exit 125\n${command}`
}

function collect() {
  const buffer = Buffer.alloc(OUTPUT_BYTES)
  let size = 0
  let truncated = false
  return {
    append(chunk) {
      const count = Math.min(chunk.length, buffer.length - size)
      chunk.copy(buffer, size, 0, count)
      size += count
      truncated ||= count < chunk.length
    },
    result() {
      // 流始终排空。UTF-8 在截断处不补入超出预算的替换字符。
      const input = buffer.subarray(0, size)
      let text = new TextDecoder().decode(input, { stream: truncated })
      while (Buffer.byteLength(text) > OUTPUT_BYTES) {
        text = text.slice(0, -1)
        truncated = true
      }
      return { text, truncated }
    },
  }
}

export function result(status, start = performance.now()) {
  return { status, exitCode: null, exitSignal: null, stdout: '', stderr: '', stdoutTruncated: false, stderrTruncated: false, elapsedMs: Math.max(0, Math.round(performance.now() - start)) }
}

function connectionOptions(device, auth, pin, onMismatch) {
  return {
    host: device.host, port: device.port, username: device.username, ...auth,
    readyTimeout: HANDSHAKE_MS, tryKeyboard: false, agentForward: false,
    hostVerifier(key) {
      const match = Buffer.isBuffer(key) && timingSafeEqual(createHash('sha256').update(key).digest(), pin)
      if (!match) onMismatch()
      return match
    },
  }
}

export function sshError(code) {
  return Object.assign(Error(code), { code })
}

export function withSftp(device, auth, signal, transfer) {
  const pin = pinBytes(device.fingerprint)
  if (!pin) return Promise.reject(sshError('invalid_pin'))
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const client = new Client()
    let pinRejected = false
    let ready = false
    let work
    let failure
    let value
    const aborted = () => client.destroy()
    const connectionFailure = () => sshError(pinRejected ? 'host_key_mismatch' : ready ? 'transport_error' : 'connection_error')
    client.on('error', () => { failure ??= connectionFailure(); client.destroy() })
    client.once('close', () => {
      // 断线后等待流和附件写入退出，再释放设备的操作槽。
      void Promise.resolve(work).then(() => {
        signal.removeEventListener('abort', aborted)
        if (signal.aborted) reject(signal.reason)
        else if (failure) reject(failure)
        else if (value === undefined) reject(connectionFailure())
        else resolve(value)
      })
    })
    client.once('ready', () => {
      if (signal.aborted) return
      ready = true
      client.sftp((error, sftp) => {
        if (signal.aborted) return
        if (error) { failure = sshError('sftp_unavailable'); client.destroy(); return }
        sftp.on('error', () => { failure ??= sshError('transport_error'); client.destroy() })
        work = Promise.resolve().then(() => transfer(sftp)).then(
          (output) => { value = output },
          (cause) => { failure ??= cause },
        ).finally(() => client.destroy())
      })
    })
    signal.addEventListener('abort', aborted, { once: true })
    try { client.connect(connectionOptions(device, auth, pin, () => { pinRejected = true })) }
    catch {
      signal.removeEventListener('abort', aborted)
      client.destroy()
      reject(connectionFailure())
    }
  })
}

export function executeSsh(device, auth, command, signal, startedAt) {
  const pin = pinBytes(device.fingerprint)
  if (!pin) return Promise.resolve(result('invalid_pin', startedAt))
  if (signal.aborted) return Promise.resolve(result(signal.reason, startedAt))
  return new Promise((resolve) => {
    const client = new Client()
    const stdout = collect()
    const stderr = collect()
    let channel
    let outcome
    let pinRejected = false
    let ready = false
    let exitCode = null
    let exitSignal = null
    function complete(status) {
      if (outcome) return
      const out = stdout.result()
      const err = stderr.result()
      outcome = { ...result(status, startedAt), exitCode, exitSignal, stdout: out.text, stderr: err.text, stdoutTruncated: out.truncated, stderrTruncated: err.truncated }
      channel?.close()
      client.destroy()
    }
    function aborted() { complete(signal.reason) }
    client.on('error', () => complete(pinRejected ? 'host_key_mismatch' : ready ? 'transport_error' : 'connection_error'))
    client.once('close', () => {
      signal.removeEventListener('abort', aborted)
      resolve(outcome ?? result(pinRejected ? 'host_key_mismatch' : ready ? 'transport_error' : 'connection_error', startedAt))
    })
    client.once('ready', () => {
      if (outcome || signal.aborted) return
      ready = true
      client.exec(command, { pty: false }, (error, stream) => {
        if (outcome || signal.aborted) {
          stream?.close()
          return
        }
        if (error) { complete('exec_rejected'); return }
        channel = stream
        stream.on('data', (chunk) => stdout.append(chunk))
        stream.stderr.on('data', (chunk) => stderr.append(chunk))
        stream.on('error', () => complete('transport_error'))
        stream.stderr.on('error', () => complete('transport_error'))
        stream.once('exit', (code, name) => {
          if (Number.isInteger(code)) exitCode = code
          if (typeof name === 'string' && /^[A-Z0-9]{1,32}$/.test(name)) exitSignal = name
        })
        stream.once('close', () => complete(exitCode !== null || exitSignal !== null ? 'exited' : 'exit_unknown'))
        stream.end()
      })
    })
    signal.addEventListener('abort', aborted, { once: true })
    try {
      client.connect(connectionOptions(device, auth, pin, () => { pinRejected = true }))
    } catch {
      // 同步失败发生在 socket 交接前时不会产生 close 事件。
      complete('connection_error')
      signal.removeEventListener('abort', aborted)
      resolve(outcome)
    }
  })
}
