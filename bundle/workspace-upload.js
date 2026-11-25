import { constants } from 'node:fs'
import { open, readlink, realpath } from 'node:fs/promises'
import { isAbsolute, posix, resolve } from 'node:path'
import { TRANSFER_BYTES, validTransferPath } from './sftp.js'
import { sshError } from './ssh.js'

// Linux O_PATH 只打开身份句柄，不会实际打开设备、FIFO 或符号链接的目标。
const O_PATH = 0o10000000
const pathFlags = O_PATH | constants.O_NOFOLLOW
const directoryFlags = pathFlags | constants.O_DIRECTORY
const unsafe = /[\p{Cc}\p{Cf}\p{Cs}]/u
const fdPath = (handle) => `/proc/self/fd/${handle.fd}`
const fail = (code) => { throw sshError(code) }
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
  a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink

export function workspaceSourcePath(value) {
  if (typeof value !== 'string') return
  let path = value
  if (path.startsWith('@"') && path.endsWith('"')) path = path.slice(2, -1)
  else if (path.startsWith('@')) path = path.slice(1)
  if (path.startsWith('./')) path = path.slice(2)
  if (validTransferPath(path) && !/^[A-Za-z]:/.test(path)) return path
}

export async function localWorkspaceRoot(fs, cwd, signal) {
  if (process.platform !== 'linux' || typeof cwd !== 'string' || !isAbsolute(cwd) || unsafe.test(cwd) ||
      !fs?.processPathFromHostPath?.(cwd)) fail('workspace_unavailable')
  try {
    const root = await realpath(cwd)
    const target = await fs.resolve('.', { cwd, signal })
    if (root === '/' || root !== resolve(cwd) || unsafe.test(root) ||
        fs.processPathFromHostPath(root) !== fs.processPath(target)) fail('workspace_unavailable')
    signal.throwIfAborted()
    return root
  } catch (error) {
    signal.throwIfAborted()
    if (error?.code === 'workspace_unavailable') throw error
    fail('workspace_unavailable')
  }
}

// 每次仅打开已固定父目录下的一个段，避免先检查路径、再从路径重新打开时跟随被替换的链接。
async function withWorkspaceFile(root, path, signal, use) {
  const expected = posix.join(root, path)
  const segments = expected.slice(1).split('/')
  const basename = segments.pop()
  let directory
  let file
  try {
    directory = await open('/', directoryFlags)
    for (const segment of segments) {
      signal.throwIfAborted()
      const child = await open(`${fdPath(directory)}/${segment}`, directoryFlags)
      const parent = directory
      directory = child
      await parent.close()
    }
    signal.throwIfAborted()
    file = await open(`${fdPath(directory)}/${basename}`, pathFlags)
    const stat = await file.stat({ bigint: true })
    if (!stat.isFile() || stat.nlink !== 1n) fail('workspace_not_regular_file')
    if (stat.size > BigInt(TRANSFER_BYTES)) fail('file_too_large')
    if (await readlink(fdPath(file)) !== expected) fail('workspace_file_changed')
    signal.throwIfAborted()
    return await use(file, stat, expected)
  } catch (error) {
    signal.throwIfAborted()
    if (error?.code === 'ENOENT') fail('workspace_file_not_found')
    if (error?.code === 'ELOOP' || error?.code === 'ENOTDIR') fail('workspace_not_regular_file')
    throw error
  } finally {
    await file?.close().catch(() => {})
    await directory?.close().catch(() => {})
  }
}

export function inspectWorkspaceFile(root, path, signal) {
  return withWorkspaceFile(root, path, signal, (_file, stat) => stat)
}

export function readWorkspaceFile(root, path, approved, signal) {
  return withWorkspaceFile(root, path, signal, async (identity, stat, expected) => {
    if (!sameFile(approved, stat)) fail('workspace_file_changed')
    const file = await open(fdPath(identity), constants.O_RDONLY | constants.O_NONBLOCK)
    // 先取得最多 8 MiB 的快照并复查，再连接远端；变化的文件连临时内容都不会发出。
    const data = Buffer.alloc(Number(stat.size) + 1)
    try {
      if (!sameFile(stat, await file.stat({ bigint: true }))) fail('workspace_file_changed')
      let offset = 0
      while (offset < data.length) {
        signal.throwIfAborted()
        const { bytesRead } = await file.read(data, offset, data.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset !== Number(stat.size) || !sameFile(stat, await file.stat({ bigint: true })) ||
          await readlink(fdPath(file)) !== expected) fail('workspace_file_changed')
      signal.throwIfAborted()
      return data.subarray(0, offset)
    } catch (error) {
      data.fill(0)
      throw error
    } finally { await file.close().catch(() => {}) }
  })
}
