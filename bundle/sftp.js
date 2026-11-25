import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { sshError } from './ssh.js'

export const TRANSFER_BYTES = 8 * 1024 * 1024
export const TRANSFER_MS = 60_000
const CHUNK_BYTES = 32 * 1024
const LIST_ENTRIES = 100
const LIST_SCAN_ENTRIES = 1000
const LIST_READS = 128
const SFTP_EOF = 1
const SFTP_NO_SUCH_FILE = 2
const unsafe = /[\p{Cc}\p{Cf}\p{Cs}\\]/u
const fail = (code) => { throw sshError(code) }

export function validFileName(name) {
  return typeof name === 'string' && Buffer.byteLength(name) > 0 && Buffer.byteLength(name) <= 255 &&
    name !== '.' && name !== '..' && !name.includes('/') && !unsafe.test(name) && !name.startsWith('.dsh-sftp-')
}

export function validTransferPath(path) {
  return typeof path === 'string' && Buffer.byteLength(path) <= 1024 && path.split('/').every(validFileName)
}

export function validTransferDirectory(directory) {
  return typeof directory === 'string' && directory.startsWith('/') && directory !== '/' &&
    Buffer.byteLength(directory) <= 1024 && validTransferPath(directory.slice(1))
}

function request(sftp, signal, method, ...args) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    sftp[method](...args, (error, value) => error ? reject(error) : resolve(value))
  })
}

async function lookup(sftp, signal, path) {
  try { return await request(sftp, signal, 'lstat', path) }
  catch (error) { if (error?.code !== SFTP_NO_SUCH_FILE) throw error }
}

async function verifyDirectory(sftp, signal, directory) {
  if (!(await lookup(sftp, signal, directory))?.isDirectory() ||
      await request(sftp, signal, 'realpath', directory) !== directory) fail('remote_directory_changed')
}

async function verifyDirectoryPath(sftp, signal, directory, path) {
  if (!validTransferDirectory(directory) || (path !== '' && !validTransferPath(path))) fail('invalid_arguments')
  // 逐级检查父目录，避免只检查末级时漏掉中间的符号链接。
  await verifyDirectory(sftp, signal, directory)
  if (path === '') return directory
  for (const segment of path.split('/')) {
    directory = posix.join(directory, segment)
    await verifyDirectory(sftp, signal, directory)
  }
  return directory
}

function parentPath(path) {
  if (!validTransferPath(path)) fail('invalid_arguments')
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}

export async function uploadFile(sftp, signal, directory, name, { bytes: size, read }) {
  if (!Number.isSafeInteger(size) || size < 0 || size > TRANSFER_BYTES) fail('file_too_large')
  const relativeParent = parentPath(name)
  const parent = await verifyDirectoryPath(sftp, signal, directory, relativeParent)
  const target = posix.join(parent, posix.basename(name))
  if (await lookup(sftp, signal, target)) fail('remote_exists')
  const staging = posix.join(parent, `.dsh-sftp-${randomUUID()}`)
  let handle
  let created = false
  let published = false
  let bytes = 0
  try {
    handle = await request(sftp, signal, 'open', staging, 'wx', { mode: 0o600 })
    created = true
    for await (const chunk of read()) {
      if (bytes + chunk.byteLength > size) fail('attachment_changed')
      const data = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      for (let offset = 0; offset < data.length;) {
        const length = Math.min(CHUNK_BYTES, data.length - offset)
        await request(sftp, signal, 'write', handle, data, offset, length, bytes)
        offset += length
        bytes += length
      }
    }
    if (bytes !== size) fail('attachment_changed')
    await request(sftp, signal, 'close', handle)
    handle = undefined
    await verifyDirectoryPath(sftp, signal, directory, relativeParent)
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
        await verifyDirectoryPath(sftp, signal, directory, relativeParent)
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
  const parent = await verifyDirectoryPath(sftp, signal, directory, parentPath(name))
  const basename = posix.basename(name)
  const path = posix.join(parent, basename)
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
    return await attachments.saveFileStream({ data: read(), signal, name: basename })
  } finally {
    if (open && !signal.aborted) await request(sftp, signal, 'close', handle).catch(() => {})
  }
}

export async function listDirectory(sftp, signal, directory, path = '') {
  const target = await verifyDirectoryPath(sftp, signal, directory, path)
  const handle = await request(sftp, signal, 'opendir', target)
  const entries = []
  let scanned = 0
  let truncated = true
  try {
    scan: for (let reads = 0; reads < LIST_READS; reads++) {
      let batch
      try {
        // 使用句柄逐批读取，并把被过滤的条目也计入扫描预算。
        batch = await request(sftp, signal, 'readdir', handle, { full: true })
      } catch (error) {
        if (error?.code !== SFTP_EOF) throw error
        truncated = false
        break
      }
      for (const { filename, attrs } of batch) {
        if (scanned === LIST_SCAN_ENTRIES) break scan
        scanned++
        if (!validFileName(filename)) continue
        const type = attrs?.isFile() ? 'file' : attrs?.isDirectory() ? 'directory' : null
        if (type === null) continue
        if (entries.length === LIST_ENTRIES) break scan
        entries.push({ name: filename, type })
      }
      if (scanned === LIST_SCAN_ENTRIES) break
    }
  } finally {
    // 中止时外层关闭 SSH 连接，由服务端释放句柄。
    if (!signal.aborted) await request(sftp, signal, 'close', handle).catch(() => {})
  }
  signal.throwIfAborted()
  return { entries, truncated }
}
