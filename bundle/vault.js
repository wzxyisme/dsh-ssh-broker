import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

export const MAX_ARCHIVE = 1536 * 1024
const derive = promisify(scrypt)
const kdf = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const noFollow = constants.O_NOFOLLOW ?? 0

export function vaultError(code) {
  return Object.assign(new Error(code), { code })
}

function privateEntry(stat, isDirectory) {
  return (isDirectory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1) &&
    (process.platform === 'win32' || (stat.mode & 0o077) === 0 && stat.uid === process.getuid())
}

async function passwordKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || Buffer.byteLength(passphrase) < 12 || Buffer.byteLength(passphrase) > 1024) throw vaultError('invalid_passphrase')
  const bytes = Buffer.from(passphrase)
  try { return await derive(bytes, salt, 32, kdf) }
  finally { bytes.fill(0) }
}

const context = (kind, id, salt) => Buffer.from(JSON.stringify(['dsh-ssh-broker', 1, kind, id, salt]))
const encode = (bytes) => bytes.toString('base64url')
function decode(value, size) {
  if (typeof value !== 'string') throw Error('invalid bytes')
  const bytes = Buffer.from(value, 'base64url')
  if ((size !== undefined && bytes.length !== size) || encode(bytes) !== value) throw Error('invalid encoding')
  return bytes
}

function seal(kind, id, salt, key, devices) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(context(kind, id, salt))
  const plaintext = Buffer.from(JSON.stringify(devices))
  try {
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const envelope = JSON.stringify({ version: 1, kind, id, salt, nonce: encode(nonce), data: encode(data), tag: encode(cipher.getAuthTag()) })
    if (Buffer.byteLength(envelope) > MAX_ARCHIVE) throw vaultError('vault_limit')
    return envelope
  } finally { plaintext.fill(0) }
}

function envelopeOf(text, kind) {
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_ARCHIVE) throw Error('invalid size')
    const env = JSON.parse(text)
    if (Object.keys(env).length !== 7 || env.version !== 1 || env.kind !== kind || !uuid.test(env.id)) throw Error('invalid format')
    return { ...env, saltBytes: decode(env.salt, 32), nonceBytes: decode(env.nonce, 12), dataBytes: decode(env.data), tagBytes: decode(env.tag, 16) }
  } catch { throw vaultError(kind === 'backup' ? 'backup_invalid' : 'vault_invalid') }
}

function openEnvelope(env, key, validate) {
  const decipher = createDecipheriv('aes-256-gcm', key, env.nonceBytes)
  decipher.setAAD(context(env.kind, env.id, env.salt))
  decipher.setAuthTag(env.tagBytes)
  const chunk = decipher.update(env.dataBytes)
  let plaintext
  try {
    const suffix = decipher.final()
    try { plaintext = Buffer.concat([chunk, suffix]) }
    finally { suffix.fill(0) }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext))
    validate(parsed)
    return frozen(parsed)
  } catch { throw vaultError(env.kind === 'backup' ? 'backup_invalid' : 'vault_invalid') }
  finally { chunk.fill(0); plaintext?.fill(0) }
}

function frozen(devices) {
  for (const entry of devices) {
    Object.freeze(entry.credential)
    Object.freeze(entry)
  }
  return Object.freeze(devices)
}

export class Vault {
  #key
  #lease
  #values
  #header
  #epoch = 0
  #tail = Promise.resolve()

  constructor(path, validateDevices) {
    this.path = path
    this.directory = dirname(path)
    this.leasePath = `${path}.lock`
    this.validateDevices = validateDevices
  }

  #serial(run) {
    const operation = this.#tail.then(run)
    this.#tail = operation.catch(() => {})
    return operation
  }

  async #checkDirectory(create = false) {
    if (create) await mkdir(this.directory, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error })
    try {
      if (!privateEntry(await lstat(this.directory), true)) throw vaultError('vault_invalid')
      return true
    } catch (error) {
      if (!create && error.code === 'ENOENT') return false
      throw error
    }
  }

  async #read() {
    if (!(await this.#checkDirectory())) return undefined
    let file
    try { file = await open(this.path, constants.O_RDONLY | noFollow | constants.O_NONBLOCK) }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw vaultError('vault_io') }
    try {
      const info = await file.stat()
      if (!privateEntry(info, false) || info.size > MAX_ARCHIVE) throw vaultError('vault_invalid')
      const buffer = Buffer.alloc(info.size + 1)
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await file.read(buffer, offset, buffer.length - offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      if (offset !== info.size) throw vaultError('vault_invalid')
      return buffer.toString('utf8', 0, offset)
    } finally { await file.close() }
  }

  async status() {
    if (this.#key) return 'unlocked'
    if (!(await this.#checkDirectory())) return 'uninitialized'
    try { await lstat(this.path); return 'locked' }
    catch (error) { if (error.code === 'ENOENT') return 'uninitialized'; throw vaultError('vault_io') }
  }

  async #acquire() {
    await this.#checkDirectory(true)
    try { this.#lease = await open(this.leasePath, 'wx', 0o600) }
    catch (error) { throw vaultError(error.code === 'EEXIST' ? 'vault_conflict' : 'vault_io') }
  }

  async #release() {
    if (!this.#lease) return
    const lease = this.#lease
    this.#lease = undefined
    try {
      const own = await lease.stat()
      const now = await lstat(this.leasePath)
      if (own.dev === now.dev && own.ino === now.ino) await unlink(this.leasePath)
    } finally { await lease.close() }
  }

  async #commit(text, epoch) {
    const temporary = `${this.path}.${randomUUID()}.tmp`
    let file
    let owned = false
    try {
      file = await open(temporary, 'wx', 0o600)
      owned = true
      await file.writeFile(text)
      await file.sync()
      await file.close()
      file = undefined
      if (epoch !== this.#epoch) throw vaultError('vault_locked')
      await rename(temporary, this.path)
      owned = false
    } finally {
      await file?.close().catch(() => {})
      if (owned) await unlink(temporary).catch(() => {})
    }
  }

  #enter(passphrase, create) {
    const epoch = this.#epoch
    return this.#serial(async () => {
      if (epoch !== this.#epoch) throw vaultError('vault_locked')
      if (this.#key) throw vaultError('vault_conflict')
      await this.#acquire()
      let key
      try {
        const text = await this.#read()
        if (create && text !== undefined) throw vaultError('vault_exists')
        if (!create && text === undefined) throw vaultError('vault_uninitialized')
        const header = create ? { id: randomUUID(), salt: encode(randomBytes(32)) } : envelopeOf(text, 'vault')
        key = await passwordKey(passphrase, decode(header.salt, 32))
        const values = create ? frozen([]) : openEnvelope(header, key, this.validateDevices)
        if (create) await this.#commit(seal('vault', header.id, header.salt, key, values), epoch)
        if (epoch !== this.#epoch) throw vaultError('vault_locked')
        this.#header = { id: header.id, salt: header.salt }
        this.#values = values
        this.#key = key
        key = undefined
      } finally {
        key?.fill(0)
        if (!this.#key) await this.#release()
      }
    })
  }

  initialize(passphrase) { return this.#enter(passphrase, true) }
  unlock(passphrase) { return this.#enter(passphrase, false) }

  #lockNow() {
    ++this.#epoch
    this.#key?.fill(0)
    this.#key = undefined
    this.#values = undefined
    this.#header = undefined
  }

  lock() {
    this.#lockNow()
    return this.#serial(() => this.#release())
  }

  devices() {
    if (!this.#key) throw vaultError('vault_locked')
    return this.#values
  }

  replace(expected, devices) {
    const epoch = this.#epoch
    return this.#serial(async () => {
      if (this.devices() !== expected || epoch !== this.#epoch) throw vaultError('vault_conflict')
      const next = structuredClone(devices)
      this.validateDevices(next)
      const { id, salt } = this.#header
      await this.#commit(seal('vault', id, salt, this.#key, next), epoch)
      if (epoch === this.#epoch) this.#values = frozen(next)
    })
  }

  verify() {
    const epoch = this.#epoch
    return this.#serial(async () => {
      const expected = this.devices()
      const text = await this.#read()
      if (epoch !== this.#epoch) throw vaultError('vault_locked')
      const verified = openEnvelope(envelopeOf(text, 'vault'), this.#key, this.validateDevices)
      if (JSON.stringify(expected) !== JSON.stringify(verified)) throw vaultError('vault_conflict')
      // 清理旧版明文前，确保目标快照的重命名也已写入目录。
      if (process.platform !== 'win32') {
        const parent = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | noFollow)
        try { await parent.sync() }
        finally { await parent.close() }
      }
      if (epoch !== this.#epoch) throw vaultError('vault_locked')
    })
  }

  backup(passphrase) {
    const epoch = this.#epoch
    return this.#serial(async () => {
      this.devices()
      const salt = randomBytes(32)
      const key = await passwordKey(passphrase, salt)
      try {
        if (epoch !== this.#epoch) throw vaultError('vault_locked')
        return seal('backup', randomUUID(), encode(salt), key, this.devices())
      } finally { key.fill(0) }
    })
  }

  async restore(text, passphrase, transform = (devices) => devices) {
    const epoch = this.#epoch
    await this.#serial(async () => {
      if (this.devices().length) throw vaultError('vault_conflict')
      const env = envelopeOf(text, 'backup')
      const key = await passwordKey(passphrase, env.saltBytes)
      let next
      try {
        next = transform(openEnvelope(env, key, this.validateDevices))
        this.validateDevices(next)
      } finally { key.fill(0) }
      if (epoch !== this.#epoch) throw vaultError('vault_locked')
      const { id, salt } = this.#header
      await this.#commit(seal('vault', id, salt, this.#key, next), epoch)
      this.#lockNow()
      await this.#release()
    })
  }
}
