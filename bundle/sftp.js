import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { sshError } from './ssh.js'

export const TRANSFER_BYTES = 8 * 1024 * 1024
export const TRANSFER_MS = 60_000
const CHUNK_BYTES = 32 * 1024
const unsafe = /[\p{Cc}\p{Cf}\p{Cs}\\]/u
const fail = (code) => { throw sshError(code) }

export function validFileName(name) {
  return typeof name === 'string' && Buffer.byteLength(name) > 0 && Buffer.byteLength(name) <= 255 &&
    name !== '.' && name !== '..' && !name.includes('/') && !unsafe.test(name) && !name.startsWith('.dsh-sftp-')
}

export function validTransferDirectory(directory) {
  return typeof directory === 'string' && directory.startsWith('/') && directory !== '/' &&
    Buffer.byteLength(directory) <= 1024 && directory.slice(1).split('/').every(validFileName)
}

function request(sftp, signal, method, ...args) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    sftp[method](...args, (error, value) => error ? reject(error) : resolve(value))
  })
}

async function verifyDirectory(sftp, signal, directory) {
  if (await request(sftp, signal, 'realpath', directory) !== directory ||
      !(await request(sftp, signal, 'lstat', directory)).isDirectory()) fail('remote_directory_changed')
}

async function lookup(sftp, signal, path) {
  try { return await request(sftp, signal, 'lstat', path) }
  catch (error) { if (error?.code !== 2) throw error }
}

export async function uploadFile(sftp, signal, directory, name, attachments, ref) {
  if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || ref.bytes > TRANSFER_BYTES) fail('file_too_large')
  const target = posix.join(directory, name)
  await verifyDirectory(sftp, signal, directory)
  if (await lookup(sftp, signal, target)) fail('remote_exists')
  const staging = posix.join(directory, `.dsh-sftp-${randomUUID()}`)
  let handle
  let created = false
  let published = false
  let bytes = 0
  try {
    handle = await request(sftp, signal, 'open', staging, 'wx', { mode: 0o600 })
    created = true
    for await (const chunk of attachments.readFileStream(ref, signal)) {
      if (bytes + chunk.byteLength > ref.bytes) fail('attachment_changed')
      const data = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      for (let offset = 0; offset < data.length;) {
        const length = Math.min(CHUNK_BYTES, data.length - offset)
        await request(sftp, signal, 'write', handle, data, offset, length, bytes)
        offset += length
        bytes += length
      }
    }
    if (bytes !== ref.bytes) fail('attachment_changed')
    await request(sftp, signal, 'close', handle)
    handle = undefined
    await verifyDirectory(sftp, signal, directory)
    // SFTP v3 的 rename 在不同实现上覆盖行为不同。OpenSSH hardlink 原子地拒绝同名目标。
    try { await request(sftp, signal, 'ext_openssh_hardlink', staging, target) }
    catch (error) {
      signal.throwIfAborted()
      if (await lookup(sftp, signal, target)) fail('remote_exists')
      if (error?.code === 8 || error?.message === 'Server does not support this extended request') fail('upload_unsupported')
      fail('upload_commit_unknown')
    }
    published = true
  } finally {
    if (handle && !signal.aborted) await request(sftp, signal, 'close', handle).catch(() => {})
    if (created && !signal.aborted) {
      try {
        await verifyDirectory(sftp, signal, directory)
        await request(sftp, signal, 'unlink', staging)
      } catch { if (published && !signal.aborted) fail('uploaded_cleanup_pending') }
    }
  }
  return bytes
}

function checkedSize(attrs) {
  if (!attrs?.isFile()) fail('remote_not_regular_file')
  if (!Number.isSafeInteger(attrs.size) || attrs.size < 0 || attrs.size > TRANSFER_BYTES) fail('file_too_large')
  return attrs.size
}

export async function downloadFile(sftp, signal, directory, name, attachments) {
  await verifyDirectory(sftp, signal, directory)
  const path = posix.join(directory, name)
  const attrs = await lookup(sftp, signal, path)
  if (!attrs) fail('remote_not_found')
  const size = checkedSize(attrs)
  if (await request(sftp, signal, 'realpath', path) !== path) fail('remote_not_regular_file')
  const handle = await request(sftp, signal, 'open', path, 'r')
  let open = true
  try {
    if (checkedSize(await request(sftp, signal, 'fstat', handle)) !== size) fail('remote_file_changed')
    async function* read() {
      let position = 0
      while (position < size) {
        const data = Buffer.alloc(Math.min(CHUNK_BYTES, size - position))
        const count = await request(sftp, signal, 'read', handle, data, 0, data.length, position)
        if (!Number.isSafeInteger(count) || count <= 0 || count > data.length) fail('remote_file_changed')
        position += count
        yield data.subarray(0, count)
      }
      if (checkedSize(await request(sftp, signal, 'fstat', handle)) !== size) fail('remote_file_changed')
      await request(sftp, signal, 'close', handle)
      open = false
      signal.throwIfAborted()
    }
    return await attachments.saveFileStream({ data: read(), signal, name })
  } finally {
    if (open && !signal.aborted) await request(sftp, signal, 'close', handle).catch(() => {})
  }
}
