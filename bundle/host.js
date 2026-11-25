import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { isAbsolute, join, posix } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { composeSshTask, commandName, toolNames } from './composer.js'
import { authOptions, EXEC_MS, executeSsh, pinBytes, remoteCommand, result, sshError, withSftp } from './ssh.js'
import { downloadFile, hashRemoteFile, listDirectory, replaceFile, TRANSFER_BYTES, TRANSFER_MS, uploadFile, validFileName, validTransferDirectory, validTransferPath } from './sftp.js'
import { MAX_ARCHIVE, Vault, vaultError } from './vault.js'
import { inspectWorkspaceFile, localWorkspaceRoot, readWorkspaceFile, workspaceSourcePath } from './workspace-upload.js'

export const inject = ['agents', 'credentials', 'tools', 'connection', 'configEditor', 'profileContext', 'attachments', 'sessionQuery']
const route = '/api/dsh-ssh-broker'
const MAX_DEVICES = 16
const MAX_GRANTS = 32
const IDLE_MS = 10 * 60_000
const LIST_MS = 10_000
const APPROVAL_MS = 120_000
const MAX_BODY = MAX_ARCHIVE + 8192
const deviceId = /^device-[0-9a-f-]{36}$/
const revisionId = /^[0-9a-f-]{36}$/
const grantId = /^ssh-[0-9a-f-]{36}$/
const transferFailures = new Set(['file_too_large', 'remote_directory_changed', 'remote_exists', 'attachment_changed',
  'remote_not_regular_file', 'remote_not_found', 'remote_file_changed', 'upload_unsupported', 'upload_commit_failed', 'upload_commit_unknown',
  'uploaded_cleanup_pending', 'invalid_pin', 'host_key_mismatch', 'transport_error', 'connection_error', 'sftp_unavailable',
  'workspace_unavailable', 'workspace_file_not_found', 'workspace_not_regular_file', 'workspace_file_changed',
  'replace_unsupported', 'replace_commit_unknown', 'replace_metadata_mismatch'])
const labelValid = (label) => typeof label === 'string' && label === label.trim() && label.length > 0 && label.length <= 64 && !/[\x00-\x1f\x7f]/.test(label)
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
const fail = (code, status = 400) => reply({ error: code }, status)
const invalid = (code) => { throw vaultError(code) }
const endpoint = ({ host, port, username, fingerprint }) => ({ host, port, username, fingerprint })
const sameEndpoint = (a, b) => !!a && !!b && a.host === b.host && a.port === b.port && a.username === b.username && a.fingerprint === b.fingerprint

// Phase 1 配置仅用于识别待迁移记录。Phase 2 设备和凭据在同一份认证快照中提交。
export const Config = z.object({
  device: z.object({
    host: z.string().default(''), port: z.number().step(1).min(1).max(65535).default(22),
    username: z.string().default(''), fingerprint: z.string().default(''), id: z.string().default(''),
  }).volatile(),
})

function validEndpoint(value) {
  return value && typeof value.host === 'string' && value.host.length <= 253 &&
    (isIP(value.host) !== 0 || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(value.host)) &&
    Number.isInteger(value.port) && value.port >= 1 && value.port <= 65535 &&
    typeof value.username === 'string' && /^[a-z_][a-z0-9_.-]{0,63}$/i.test(value.username) && Boolean(pinBytes(value.fingerprint))
}

function cleanCredential(raw) {
  if (!raw || typeof raw !== 'object') invalid('invalid_credential')
  const { kind, value, passphrase } = raw
  const credential = kind === 'key' ? { kind, value, passphrase: passphrase ?? '' } : { kind, value }
  if (typeof value !== 'string' || Buffer.byteLength(value) > 32_768 ||
      (typeof passphrase === 'string' && Buffer.byteLength(passphrase) > 4096) || !authOptions(credential)) invalid('invalid_credential')
  return credential
}

function validateDevices(devices) {
  if (!Array.isArray(devices) || devices.length > MAX_DEVICES) invalid('device_limit')
  const ids = new Set()
  for (const value of devices) {
    if (!validEndpoint(value) || typeof value.id !== 'string' || !deviceId.test(value.id) || ids.has(value.id) ||
        typeof value.revision !== 'string' || !revisionId.test(value.revision) || !labelValid(value.label) ||
        typeof value.verified !== 'boolean' || (value.migrated !== undefined && value.migrated !== true)) invalid('invalid_device')
    const credential = cleanCredential(value.credential)
    if (Object.keys(value.credential).length !== Object.keys(credential).length ||
        !Object.keys(credential).every((key) => Object.hasOwn(value.credential, key))) invalid('invalid_credential')
    const fields = Object.keys(value)
    if (fields.some((key) => !['id', 'revision', 'label', 'host', 'port', 'username', 'fingerprint', 'verified', 'credential', 'migrated'].includes(key))) invalid('invalid_device')
    ids.add(value.id)
  }
}

function sameOrigin(request) {
  try {
    const origin = request.headers.get('origin')
    const url = new URL(origin)
    return url.origin === origin && /^https?:$/.test(url.protocol) &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.host === new URL(`${url.protocol}//${request.headers.get('host')}`).host &&
      request.headers.get('sec-fetch-site') !== 'cross-site'
  } catch { return false }
}

async function readAction(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) return fail('invalid_request', 415)
  if (!request.body) return fail('invalid_request')
  if (Number(request.headers.get('content-length')) > MAX_BODY) return fail('too_large', 413)
  const reader = request.body.getReader()
  const chunks = []
  let size = 0
  let body
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BODY) return fail('too_large', 413)
      chunks.push(value)
    }
    body = Buffer.concat(chunks, size)
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fail('invalid_request')
  } catch { return fail('invalid_request') }
  finally {
    body?.fill(0)
    reader.releaseLock()
  }
}

const publicDevice = ({ id, revision, label, verified, ...device }) => ({ id, revision, label, verified, ...endpoint(device) })
const publicFailures = new Set(['vault_locked', 'vault_exists', 'vault_uninitialized', 'vault_invalid', 'vault_conflict', 'vault_io',
  'invalid_passphrase', 'backup_invalid', 'vault_limit', 'invalid_request', 'stale_device', 'device_limit', 'invalid_device',
  'invalid_credential', 'invalid_grant', 'invalid_transfer_directory', 'not_ready', 'busy', 'legacy_invalid', 'cleanup_failed', 'configuration_failed'])

export function apply(ctx, config) {
  const entry = ctx.fiber.entry
  const directory = ctx.profileContext.dir
  if (!entry?.id || !isAbsolute(directory)) throw Error('SSH vault requires an addressable Profile entry')
  const instance = createHash('sha256').update(entry.id).digest('hex')
  const vault = new Vault(join(directory, 'ssh-broker-vaults', `${instance}.json`), validateDevices)
  const grants = new Map()
  const operations = new Map()
  const audit = []
  let closed = false
  let management
  let idle
  let lockGeneration = 0

  function addAudit(status, deviceId, elapsedMs) {
    audit.unshift({ time: Date.now(), status, ...(deviceId === undefined ? {} : { deviceId }), ...(elapsedMs === undefined ? {} : { elapsedMs }) })
    if (audit.length > 32) audit.pop()
  }

  function end(grant, status) {
    if (grant.status !== 'active') return
    clearTimeout(grant.timer)
    grant.status = status
    grant.agent = undefined
    const operation = operations.get(grant.deviceId)
    if (operation?.grant === grant) operation.controller.abort(status)
    addAudit(status, grant.deviceId)
    if (grant.deadline === null) touch()
  }

  const holdsVaultOpen = (grant) => grant.deadline === null && grant.status === 'active'

  function endForDevice(id, status) {
    for (const grant of grants.values()) if (grant.deviceId === id) end(grant, status)
  }

  function lock(status = 'vault_locked') {
    ++lockGeneration
    for (const grant of grants.values()) end(grant, status)
    clearTimeout(idle)
    return vault.lock()
  }

  function touch() {
    clearTimeout(idle)
    // 会话授权需要跨越两次远端操作之间的空闲期。最后一条结束后恢复空闲计时。
    if (closed || [...grants.values()].some(holdsVaultOpen)) return
    idle = setTimeout(() => { void lock().catch(() => addAudit('vault_io')) }, IDLE_MS)
    idle.unref?.()
  }

  function current(grant) {
    if (!grant || grant.status !== 'active' || closed) return false
    if (grant.deadline !== null && performance.now() >= grant.deadline) end(grant, 'expired')
    else if (ctx.agents.get(grant.agentId) !== grant.agent) end(grant, 'session_closed')
    return grant.status === 'active'
  }

  function legacyDevice() {
    const old = config.device.get()
    return validEndpoint(old) && typeof old.id === 'string' && deviceId.test(old.id) ? { id: old.id, ...endpoint(old) } : null
  }

  function legacyCredential(record, old) {
    if (record?.kind !== 'grant' || record.payload?.device?.id !== old.id || !sameEndpoint(record.payload.device, old)) invalid('legacy_invalid')
    return cleanCredential(record.payload)
  }

  async function snapshot() {
    for (const grant of grants.values()) current(grant)
    const old = legacyDevice()
    const credentialConfigured = old ? (await ctx.credentials.describeRecord(`ssh-broker/${old.id}`)).configured : false
    const state = await vault.status()
    let unlocked = []
    let visibleState = state
    if (state === 'unlocked') {
      try { unlocked = vault.devices() }
      catch { visibleState = 'locked' }
    }
    return {
      vault: visibleState,
      devices: unlocked.map(publicDevice),
      legacy: old ? { ...old, credentialConfigured } : null,
      cleanupPending: Boolean(old && unlocked.some((device) => device.id === old.id && device.migrated === true)),
      sessions: ctx.agents.list().slice(-100).map(({ id }) => id),
      grants: [...grants.values()].reverse().map(({ id, deviceId, deviceLabel, agentId, status, deadline, shell, transferDirectory, includeSubdirectories }) => ({
        id, deviceId, deviceLabel, agentId, status, shell, transferDirectory, includeSubdirectories,
        duration: deadline === null ? 'session' : 'timed',
        remainingMs: deadline === null ? null : status === 'active' ? Math.max(0, Math.ceil(deadline - performance.now())) : 0,
        busy: operations.get(deviceId)?.grant.id === id,
      })),
      audit: audit.slice(), busy: Boolean(management),
    }
  }

  async function configure(action) {
    const devices = vault.devices()
    const previous = action.id === undefined ? undefined : devices.find(({ id }) => id === action.id)
    if (action.id !== undefined && (!previous || previous.revision !== action.revision)) invalid('stale_device')
    if (!previous && devices.length >= MAX_DEVICES) invalid('device_limit')
    if (!validEndpoint(action) || !labelValid(action.label) || action.confirmFingerprint !== true) invalid('invalid_device')
    const bindingChanged = !sameEndpoint(action, previous)
    if (previous && legacyDevice()?.id === previous.id && (bindingChanged || action.credential !== undefined)) invalid('cleanup_failed')
    const credential = action.credential === undefined && !bindingChanged ? previous.credential : cleanCredential(action.credential)
    const rotate = bindingChanged || action.credential !== undefined || !previous?.verified
    const next = {
      id: previous?.id ?? `device-${randomUUID()}`, ...endpoint(action), label: action.label,
      revision: rotate ? randomUUID() : previous.revision, verified: true, credential,
      ...(previous?.migrated ? { migrated: true } : {}),
    }
    if (rotate) endForDevice(next.id, bindingChanged ? 'device_changed' : 'credential_changed')
    await vault.replace(devices, previous ? devices.map((device) => device === previous ? next : device) : [...devices, next])
    addAudit('device_saved', next.id)
    return { saved: true }
  }

  async function remove(action) {
    const devices = vault.devices()
    const candidate = devices.find((device) => device.id === action.id && device.revision === action.revision)
    if (!candidate) invalid('stale_device')
    if (action.confirm !== true) invalid('invalid_request')
    if (legacyDevice()?.id === candidate.id) invalid('cleanup_failed')
    endForDevice(candidate.id, 'device_changed')
    await vault.replace(devices, devices.filter((device) => device !== candidate))
    addAudit('device_deleted', candidate.id)
    return { deleted: true }
  }

  async function migrate(action, cleanupOnly, assertAllowed) {
    if (action.confirm !== true) invalid('invalid_request')
    const old = legacyDevice()
    if (!old) invalid('legacy_invalid')
    const devices = vault.devices()
    const key = `ssh-broker/${old.id}`
    const record = await ctx.credentials.readRecord(key)
    assertAllowed()
    let existing = devices.find((device) => device.id === old.id)
    if (!existing) {
      if (cleanupOnly) invalid('legacy_invalid')
      if (devices.length >= MAX_DEVICES) invalid('device_limit')
      const credential = legacyCredential(record, old)
      existing = { ...old, revision: randomUUID(), label: old.host.slice(0, 64), verified: true, migrated: true, credential }
      endForDevice(old.id, 'credential_changed')
      await vault.replace(devices, [...devices, existing])
      addAudit('device_migrated', old.id)
    }
    if (existing.migrated !== true || !sameEndpoint(existing, old)) invalid('legacy_invalid')
    await vault.verify()
    assertAllowed()
    if (record) {
      // 中断后旧记录可能已被别的实例轮换，只清理与已提交密文一致的副本。
      const beforeDelete = await ctx.credentials.readRecord(key)
      if (beforeDelete) {
        if (JSON.stringify(beforeDelete) !== JSON.stringify(record) ||
            !matchesMigratedCredential(beforeDelete, old, existing.credential)) invalid('cleanup_failed')
        assertAllowed()
        try { await ctx.credentials.deleteRecord(key) }
        catch { invalid('cleanup_failed') }
      }
    }
    assertAllowed()
    if (legacyDevice()?.id !== old.id || !sameEndpoint(legacyDevice(), old)) invalid('cleanup_failed')
    try {
      await ctx.configEditor.edit(entry, (raw) => {
        if (raw.device?.id !== old.id || !sameEndpoint(raw.device, old)) invalid('cleanup_failed')
        const next = { ...raw }
        delete next.device
        return next
      })
    } catch { invalid('cleanup_failed') }
    addAudit('legacy_cleaned', old.id)
    return { migrated: true }
  }

  function matchesMigratedCredential(record, old, credential) {
    try {
      const candidate = legacyCredential(record, old)
      return candidate.kind === credential.kind && candidate.value === credential.value && candidate.passphrase === credential.passphrase
    } catch { return false }
  }

  function authorize(action) {
    const device = vault.devices().find(({ id }) => id === action.deviceId)
    if (!device?.verified) invalid('not_ready')
    if (typeof action.agentId !== 'string' || action.agentId.length > 256 || action.confirm !== true) invalid('invalid_grant')
    const sessionDuration = action.duration === 'session'
    if (sessionDuration) {
      if (action.confirmSession !== true || action.ttlSeconds !== undefined) invalid('invalid_grant')
      if (device.revision !== action.deviceRevision) invalid('stale_device')
    } else if ((action.duration !== undefined && action.duration !== 'timed') ||
        !Number.isInteger(action.ttlSeconds) || action.ttlSeconds < 1 || action.ttlSeconds > 900) invalid('invalid_grant')
    const shell = action.shell ?? true
    const { transferDirectory, includeSubdirectories = false } = action
    if (typeof shell !== 'boolean' || (!shell && transferDirectory === undefined) ||
        typeof includeSubdirectories !== 'boolean' || (includeSubdirectories && transferDirectory === undefined)) invalid('invalid_grant')
    if (transferDirectory !== undefined && !validTransferDirectory(transferDirectory)) invalid('invalid_transfer_directory')
    const agent = ctx.agents.get(action.agentId)
    if (!agent) invalid('not_ready')
    for (const grant of grants.values()) current(grant)
    if ([...grants.values()].some((grant) => grant.deviceId === device.id && grant.status === 'active') || operations.has(device.id)) invalid('busy')
    for (const [id, grant] of grants) {
      if (grants.size < MAX_GRANTS) break
      if (grant.status !== 'active') grants.delete(id)
    }
    if (grants.size >= MAX_GRANTS) invalid('busy')
    const deadline = sessionDuration ? null : performance.now() + action.ttlSeconds * 1000
    const id = `ssh-${randomUUID()}`
    const grant = {
      id, selection: randomUUID().replaceAll('-', ''), agentId: agent.id, agent, deviceId: device.id,
      deviceLabel: device.label, revision: device.revision, deadline, status: 'active', shell, transferDirectory, includeSubdirectories,
    }
    if (!sessionDuration) grant.timer = setTimeout(() => end(grant, 'expired'), action.ttlSeconds * 1000)
    grants.set(id, grant)
    if (sessionDuration) touch()
    addAudit('granted', device.id)
    return { granted: true }
  }

  function composerChoices(agent) {
    if (!agent || closed || management || ctx.agents.get(agent.id) !== agent) return []
    let devices
    try { devices = vault.devices() }
    catch { return [] }
    return [...grants.values()].flatMap((grant) => {
      if (grant.agent !== agent || !current(grant)) return []
      const device = devices.find(({ id }) => id === grant.deviceId)
      if (!device?.verified || device.revision !== grant.revision) return []
      return [{ selection: grant.selection, label: device.label, deviceId: device.id, grantId: grant.id, shell: grant.shell, transfer: canTransfer(grant) }]
    })
  }

  ctx.inject(['commands'], (scope) => {
    scope.commands.register({
      name: commandName,
      description: 'SSH 设备 · 通过当前会话的授权提交任务',
      input: { hint: '描述要在 SSH 设备上完成的任务', attachments: true },
      recordInput: false,
      handler({ agent, rawInput, attachments, signal }) {
        signal.throwIfAborted()
        const task = composeSshTask(rawInput, composerChoices(agent))
        // 当前版本只有在带附件时才保留返回 kind:error 的草稿；抛出错误也能保留纯文本草稿。
        if (task.error) throw Error(task.error)
        agent.followup(createUserMessage({
          content: [...attachments, { type: 'text', text: task.text }],
          source: { kind: 'user' },
        }))
        return { kind: 'success', text: `SSH 任务已提交 · ${task.label}` }
      },
    })
  })

  async function perform(args, exec, enabled, timeLimit, outcome, task) {
    const start = performance.now()
    const grant = grants.get(args.session)
    if (!exec.agent || !grant || grant.agentId !== exec.agent.id || !enabled(grant)) return outcome('not_authorized', start)
    if (!current(grant)) return outcome(grant.status, start)
    if (grant.agent !== exec.agent) return outcome('not_authorized', start)
    if (operations.has(grant.deviceId)) return outcome('busy', start)
    let device
    try { device = vault.devices().find(({ id }) => id === grant.deviceId) }
    catch { return outcome('vault_locked', start) }
    if (!device?.verified || device.revision !== grant.revision) return outcome('credential_changed', start)
    const auth = authOptions(device.credential)
    if (!auth) return outcome('credential_unavailable', start)
    const controller = new AbortController()
    const cancel = () => controller.abort('cancelled')
    let timer
    const setDeadline = (ms, reason = 'timed_out') => {
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(reason), ms)
    }
    setDeadline(timeLimit)
    exec.signal.addEventListener('abort', cancel, { once: true })
    if (exec.signal.aborted) cancel()
    touch()
    const operation = { controller, grant, setDeadline }
    const settle = (output) => {
      if (operation.upload) output = settleUpload(output, start, operation.upload)
      addAudit(output.status, grant.deviceId, output.elapsedMs)
      return output
    }
    operations.set(grant.deviceId, operation)
    try {
      operation.done = Promise.resolve().then(() => task(device, auth, controller.signal, grant, start, operation))
      const output = await operation.done
      // Shell 超时时保留已接收的诊断输出。撤销或取消时仍返回空结果。
      const timedOutShell = enabled === canShell && controller.signal.reason === 'timed_out' && output.status === 'timed_out'
      return settle(operation.replacementResult ?? (controller.signal.aborted && !timedOutShell ? outcome(controller.signal.reason, start) : output))
    } catch (error) {
      return settle(operation.replacementResult ?? outcome(operation.replacementState === 'pending' ? 'replace_commit_unknown' :
        controller.signal.aborted ? controller.signal.reason :
        transferFailures.has(error?.code) ? error.code : enabled === canTransfer ? 'transfer_failed' : 'internal_error', start))
    } finally {
      clearTimeout(timer)
      exec.signal.removeEventListener('abort', cancel)
      operations.delete(grant.deviceId)
    }
  }

  const canShell = (grant) => grant.shell
  const canTransfer = (grant) => grant.transferDirectory !== undefined
  const transferOutcome = (status, start = performance.now(), bytes = null, attachment = null) => ({
    status, elapsedMs: Math.max(0, Math.round(performance.now() - start)), bytes, attachment,
  })
  const uploadOutcome = (status, start) => ({
    ...transferOutcome(status, start), phase: null, acknowledgedBytes: null,
  })
  function settleUpload(output, start, { phase, acknowledgedBytes, commit }) {
    // 正式文件的提交结果优先于 SSH 连接和临时文件清理的结果。
    if (commit === 'pending') output = transferOutcome('upload_commit_unknown', start)
    else if (commit === 'confirmed' || commit === 'cleaned') {
      output = transferOutcome(commit === 'cleaned' ? 'uploaded' : 'uploaded_cleanup_pending', start, acknowledgedBytes)
    }
    return { ...output, phase, acknowledgedBytes }
  }
  const directoryOutcome = (status, start = performance.now(), { entries = [], truncated = false } = {}) => ({
    status, elapsedMs: Math.max(0, Math.round(performance.now() - start)), entries, truncated,
  })

  function runDirectoryList(args, exec) {
    const { session, path = '' } = args
    if (Object.keys(args).some((key) => key !== 'session' && key !== 'path') || typeof session !== 'string' || !grantId.test(session) ||
        (path !== '' && !validTransferPath(path))) return directoryOutcome('invalid_arguments')
    return perform(args, exec, canTransfer, LIST_MS, directoryOutcome, (device, auth, signal, grant, start) => {
      if (path && !grant.includeSubdirectories) return directoryOutcome('subdirectories_not_allowed', start)
      return withSftp(device, auth, signal, async (sftp) => {
        const listing = await listDirectory(sftp, signal, grant.transferDirectory, path)
        return directoryOutcome('listed', start, listing)
      })
    })
  }

  async function findUpload(session, name, signal) {
    using observation = await ctx.sessionQuery.observeSession(session.id, { signal, projectionMode: 'none' })
    const matches = new Map()
    const events = observation.events
    for (let index = observation.inheritedEventCount; index < events.length; index++) {
      const event = events[index]
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
      for (const block of event.data.content) {
        if (block.type === 'file' && block.attachment.name === name) matches.set(block.attachment.attachmentId, block.attachment)
      }
    }
    return matches
  }

  async function workspaceInput(path, exec, signal) {
    const root = await localWorkspaceRoot(ctx.get('fs'), exec.agent.session?.header?.cwd, signal)
    return { root, path, file: await inspectWorkspaceFile(root, path, signal) }
  }

  async function confirmTransfer(approval, exec, signal, operation, toolName, en, zh) {
    signal.throwIfAborted()
    if (operation.upload) operation.upload.phase = 'approval'
    operation.setDeadline(APPROVAL_MS, 'approval_timed_out')
    const decision = await approval.request({
      agent: exec.agent, toolName, callId: exec.callId, signal, reason: en,
      displayReason: { en, 'zh-CN': zh },
    })
    signal.throwIfAborted()
    if (decision !== 'allowed-once') return decision === 'rejected' ? 'approval_rejected' :
      decision === 'cancelled' ? 'approval_cancelled' : 'approval_unavailable'
    operation.setDeadline(TRANSFER_MS)
  }

  function describeTarget(device, grant, name) {
    const label = JSON.stringify(device.label.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '�'))
    const host = isIP(device.host) === 6 ? `[${device.host}]` : device.host
    return `${label} (${device.username}@${host}:${device.port}), ${JSON.stringify(posix.join(grant.transferDirectory, name))}`
  }

  async function uploadRemote(name, device, auth, signal, grant, start, progress, source) {
    progress.phase = 'connecting'
    return withSftp(device, auth, signal, async (sftp) => {
      const bytes = await uploadFile(sftp, signal, grant.transferDirectory, name, source, progress, () => {
        if (!current(grant)) throw sshError(grant.status)
      })
      return transferOutcome('uploaded', start, bytes)
    })
  }

  async function uploadWorkspace(path, name, exec, device, auth, signal, grant, start, operation) {
    const approval = ctx.get('approval')
    if (!approval) return transferOutcome('approval_unavailable', start)
    const { root, file } = await workspaceInput(path, exec, signal)
    const target = describeTarget(device, grant, name)
    const source = JSON.stringify(posix.join(root, path))
    const denied = await confirmTransfer(approval, exec, signal, operation, toolNames.upload,
      `Upload workspace file ${source} (${file.size} bytes) to ${target}. This sends the file contents to the remote host. Allow this upload only?`,
      `将工作区文件 ${source}（${file.size} 字节）上传到 ${target}。文件内容将发送到远端。是否仅允许这一次上传？`)
    if (denied) return transferOutcome(denied, start)
    if (!current(grant)) return transferOutcome(grant.status, start)
    operation.upload.phase = 'reading_source'
    const data = await readWorkspaceFile(root, path, file, signal)
    try {
      signal.throwIfAborted()
      if (!current(grant)) return transferOutcome(grant.status, start)
      return await uploadRemote(name, device, auth, signal, grant, start, operation.upload, { bytes: data.length, read: () => [data] })
    } finally { data.fill(0) }
  }

  const verifyOutcome = (status, start = performance.now(), local = null, remote = null) => ({
    status, elapsedMs: Math.max(0, Math.round(performance.now() - start)),
    localSha256: local?.sha256 ?? null, remoteSha256: remote?.sha256 ?? null,
    localBytes: local?.bytes ?? null, remoteBytes: remote?.bytes ?? null,
  })
  const validFileTarget = ({ session, name }) => typeof session === 'string' && grantId.test(session) && validTransferPath(name)

  function runVerify(args, exec) {
    const path = workspaceSourcePath(args.workspacePath)
    if (!validFileTarget(args) || !path || Object.keys(args).some((key) => !['session', 'name', 'workspacePath'].includes(key))) {
      return verifyOutcome('invalid_arguments')
    }
    return perform(args, exec, canTransfer, TRANSFER_MS, verifyOutcome, async (device, auth, signal, grant, start) => {
      if (!grant.includeSubdirectories && args.name.includes('/')) return verifyOutcome('subdirectories_not_allowed', start)
      const { root, file } = await workspaceInput(path, exec, signal)
      const data = await readWorkspaceFile(root, path, file, signal)
      let local
      try { local = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') } }
      finally { data.fill(0) }
      if (!current(grant)) return verifyOutcome(grant.status, start)
      return withSftp(device, auth, signal, async (sftp) => {
        let remote
        try { remote = await hashRemoteFile(sftp, signal, grant.transferDirectory, args.name) }
        catch (error) {
          if (error?.code === 'remote_not_found') return verifyOutcome('remote_not_found', start, local)
          throw error
        }
        return verifyOutcome(local.sha256 === remote.sha256 && local.bytes === remote.bytes ? 'matched' : 'mismatched', start, local, remote)
      })
    })
  }

  async function replaceTransfer(name, exec, device, auth, signal, grant, start, operation, workspace, attachment) {
    const approval = ctx.get('approval')
    if (!approval) return transferOutcome('approval_unavailable', start)
    const size = workspace ? Number(workspace.file.size) : attachment.bytes
    if (!Number.isSafeInteger(size) || size < 0 || size > TRANSFER_BYTES) return transferOutcome('file_too_large', start)
    const previous = await withSftp(device, auth, signal, (sftp) => hashRemoteFile(sftp, signal, grant.transferDirectory, name))
    if ((previous.attrs.mode & 0o7000) || !Number.isInteger(previous.attrs.uid) || !Number.isInteger(previous.attrs.gid)) {
      return transferOutcome('replace_metadata_mismatch', start)
    }
    const target = describeTarget(device, grant, name)
    const source = JSON.stringify(workspace ? posix.join(workspace.root, workspace.path) : attachment.name)
    const denied = await confirmTransfer(approval, exec, signal, operation, toolNames.replace,
      `Replace existing file at ${target} (old SHA-256: ${previous.sha256}) with ${workspace ? 'workspace file' : 'session attachment'} ${source} (${size} bytes). Allow this overwrite only?`,
      `用${workspace ? '工作区文件' : '会话附件'} ${source}（${size} 字节）替换 ${target} 的现有文件（旧 SHA-256：${previous.sha256}）。是否仅允许这一次覆盖？`)
    if (denied) return transferOutcome(denied, start)
    if (!current(grant)) return transferOutcome(grant.status, start)
    const data = workspace && await readWorkspaceFile(workspace.root, workspace.path, workspace.file, signal)
    try {
      signal.throwIfAborted()
      if (!current(grant)) return transferOutcome(grant.status, start)
      return await withSftp(device, auth, signal, async (sftp) => {
        const bytes = await replaceFile(sftp, signal, grant.transferDirectory, name, {
          bytes: size, read: () => data ? [data] : ctx.attachments.readFileStream(attachment, signal),
        }, previous, (state, bytes) => {
          // 已收到 rename 成功响应时，断线或撤销不能回滚改动。
          if (state === 'pending' && !current(grant)) throw sshError(grant.status)
          operation.replacementState = state
          if (state === 'confirmed') operation.replacementResult = transferOutcome('replaced', start, bytes)
        })
        return transferOutcome('replaced', start, bytes)
      })
    } finally { data?.fill(0) }
  }

  function runTransfer(args, exec, direction) {
    const replace = direction === 'replace'
    const upload = direction !== 'download'
    const outcome = direction === 'upload' ? uploadOutcome : transferOutcome
    const fields = upload ? ['session', 'name', 'attachment', 'workspacePath'] : ['session', 'name']
    // 部分工具调用会把未填写的可选字符串序列化成空字符串。
    const attachment = args.attachment === '' ? undefined : args.attachment
    const fromWorkspace = args.workspacePath !== undefined && args.workspacePath !== ''
    const workspacePath = fromWorkspace ? workspaceSourcePath(args.workspacePath) : undefined
    if (Object.keys(args).some((key) => !fields.includes(key)) || !validFileTarget(args) || (upload && (fromWorkspace
          ? attachment !== undefined || workspacePath === undefined
          : !validFileName(attachment)))) return outcome('invalid_arguments')
    return perform(args, exec, canTransfer, TRANSFER_MS, outcome, async (device, auth, signal, grant, start, operation) => {
      if (!grant.includeSubdirectories && args.name.includes('/')) return outcome('subdirectories_not_allowed', start)
      if (direction === 'upload') operation.upload = { phase: 'preparing_source', acknowledgedBytes: 0 }
      if (fromWorkspace) {
        if (!replace) return uploadWorkspace(workspacePath, args.name, exec, device, auth, signal, grant, start, operation)
        const workspace = await workspaceInput(workspacePath, exec, signal)
        return replaceTransfer(args.name, exec, device, auth, signal, grant, start, operation, workspace)
      }
      if (upload) {
        const matches = await findUpload(exec.agent.session, attachment, signal)
        signal.throwIfAborted()
        if (matches.size === 0) return outcome('attachment_not_found', start)
        if (matches.size > 1) return outcome('attachment_ambiguous', start)
        const source = matches.values().next().value
        if (replace) return replaceTransfer(args.name, exec, device, auth, signal, grant, start, operation, undefined, source)
        return uploadRemote(args.name, device, auth, signal, grant, start, operation.upload, {
          bytes: source.bytes, read: () => ctx.attachments.readFileStream(source, signal),
        })
      }
      return withSftp(device, auth, signal, async (sftp) => {
        const ref = await downloadFile(sftp, signal, grant.transferDirectory, args.name, ctx.attachments)
        return transferOutcome('downloaded', start, ref.bytes, ref)
      })
    })
  }

  async function manage(action, assertAllowed) {
    switch (action.action) {
      case 'initialize': await vault.initialize(action.passphrase); return { initialized: true }
      case 'unlock': await vault.unlock(action.passphrase); return { unlocked: true }
      case 'backup': return { archive: await vault.backup(action.passphrase) }
      case 'restore':
        if (action.confirm !== true) invalid('invalid_request')
        for (const grant of grants.values()) end(grant, 'vault_locked')
        await vault.restore(action.archive, action.passphrase, (devices) => devices.map(({ migrated: _migrated, ...device }) => ({ ...device, revision: randomUUID(), verified: false })))
        clearTimeout(idle)
        addAudit('vault_restored')
        return { restored: true }
      case 'configure': return configure(action)
      case 'delete': return remove(action)
      case 'migrate': return migrate(action, false, assertAllowed)
      case 'cleanup': return migrate(action, true, assertAllowed)
      case 'grant': return authorize(action)
      default: invalid('invalid_request')
    }
  }

  ctx.on('agent/disposed', ({ agent }) => {
    for (const grant of grants.values()) if (grant.agent === agent) end(grant, 'session_closed')
  })

  ctx.effect(() => {
    const text = { type: 'string' }
    const sessionId = { ...text, description: 'SSH Broker authorization ID issued for this conversation.' }
    const integer = { type: 'integer' }
    const flag = { type: 'boolean' }
    const required = (type) => ({ ...type, required: true })
    const nullable = (type) => ({ oneOf: [type, { type: 'null' }] })
    const visible = (enabled) => ({ agent }) => !closed && agent !== undefined &&
      [...grants.values()].some((grant) => grant.agent === agent && enabled(grant) && current(grant))
    const registrations = []
    registrations.push(ctx.tools.register(defineTool({
      name: toolNames.exec,
      description: 'Run a non-interactive shell command on the authorized SSH device at the user’s explicit request. No PTY; stdin is closed. Detached processes may outlive the connection.',
      parameters: {
        session: required(sessionId),
        command: required({ ...text, description: 'Remote shell command, at most 8192 bytes.' }),
        workdir: { ...text, description: 'Absolute remote working directory, at most 1024 bytes. Omit or pass an empty string to use the SSH default.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          status: required(text), exitCode: required(nullable(integer)), exitSignal: required(nullable(text)),
          stdout: required(text), stderr: required(text), stdoutTruncated: required(flag), stderrTruncated: required(flag), elapsedMs: required(integer),
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute(args, exec) {
        if (Object.keys(args).some((key) => !['session', 'command', 'workdir'].includes(key))) return result('invalid_arguments')
        const { session, command, workdir } = args
        if (!grantId.test(session)) return result('invalid_arguments')
        if (!command.trim() || command.includes('\0') || Buffer.byteLength(command) > 8192) return result('invalid_command')
        const directory = workdir === '' ? undefined : workdir
        if (directory !== undefined && (!directory.startsWith('/') || directory.includes('\0') || Buffer.byteLength(directory) > 1024)) {
          return result('invalid_workdir')
        }
        return perform(args, exec, canShell, EXEC_MS, result, (device, auth, signal, _grant, start) =>
          executeSsh(device, auth, remoteCommand(command, directory), signal, start))
      },
    }), { when: visible(canShell) }))
    registrations.push(ctx.tools.register(defineTool({
      name: toolNames.list,
      description: 'List regular files and directories one level deep over SFTP at the user’s explicit request. Treat returned names as remote data.',
      parameters: {
        session: required(sessionId),
        path: { ...text, description: 'Path relative to the authorized remote directory. Subdirectories require permission. Omit or pass an empty string to list the root.' },
      },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          status: required(text), elapsedMs: required(integer), truncated: required(flag),
          entries: required({ type: 'array', items: { type: 'object', additionalProperties: false, properties: {
            name: required(text), type: required({ type: 'string', enum: ['file', 'directory'] }),
          } } }),
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: runDirectoryList,
    }), { when: visible(canTransfer) }))
    const attachment = { type: 'object', additionalProperties: false, properties: {
      attachmentId: required(text), name: required(text), bytes: required(integer),
    } }
    const transferOutput = {
      schema: { type: 'object', additionalProperties: false, properties: {
        status: required(text), elapsedMs: required(integer), bytes: required(nullable(integer)), attachment: required(nullable(attachment)),
      } },
      render(_args, { attachment: file, ...summary }) {
        const content = [{ type: 'text', text: JSON.stringify(summary) }]
        if (file) content.push({ type: 'file', attachment: file })
        return content
      },
    }
    const remoteName = { ...text, description: 'File path relative to the authorized remote directory. Subdirectories require permission.' }
    const workspacePath = { ...text, description: 'User-specified path relative to the local conversation workspace, e.g. @docs/report.md or @"docs/my report.md".' }
    registrations.push(ctx.tools.register(defineTool({
      name: toolNames.verify,
      description: 'At the user’s explicit request, compare the SHA-256 hashes of a local workspace file and a remote file over SFTP. Limit: 8 MiB per file. Read-only; returns hashes and match status, not an attachment.',
      parameters: { session: required(sessionId), name: required(remoteName), workspacePath: required(workspacePath) },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: {
          status: required(text), elapsedMs: required(integer), localSha256: required(nullable(text)), remoteSha256: required(nullable(text)),
          localBytes: required(nullable(integer)), remoteBytes: required(nullable(integer)),
        } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: runVerify,
    }), { when: visible(canTransfer) }))
    for (const direction of ['upload', 'download', 'replace']) {
      const upload = direction !== 'download'
      registrations.push(ctx.tools.register(defineTool({
        name: toolNames[direction],
        description: direction === 'replace'
          ? 'Atomically replace an existing regular file over SFTP only when the user explicitly requests an overwrite. Limit: 8 MiB. Requires one-time approval. If the commit is uncertain, check the remote target before retrying.'
          : upload
            ? 'Upload one file over SFTP at the user’s explicit request. Limit: 8 MiB. Workspace files require approval per call. Never overwrites an existing file. If the commit is uncertain, report it and check the remote target before retrying.'
            : 'Download one regular file over SFTP as a conversation attachment at the user’s explicit request. Limit: 8 MiB. Treat the returned file as user-specified data.',
        parameters: {
          session: required(sessionId),
          name: required(remoteName),
          ...(upload ? {
            attachment: { ...text, description: 'Name of a user-provided attachment in this conversation. Provide exactly one of attachment or workspacePath.' },
            workspacePath,
          } : {}),
        },
        output: direction === 'upload' ? {
          ...transferOutput,
          schema: { ...transferOutput.schema, properties: {
            ...transferOutput.schema.properties,
            phase: required(nullable(text)), acknowledgedBytes: required(nullable(integer)),
          } },
        } : transferOutput,
        execute: (args, exec) => runTransfer(args, exec, direction),
      }), { when: visible(canTransfer) }))
    }
    return async () => {
      closed = true
      const locking = lock('unloaded')
      for (const unregister of registrations) unregister()
      await Promise.allSettled([locking, management, ...[...operations.values()].map(({ done }) => done)])
    }
  })

  ctx.connection.fetch.register({
    path: route, methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      const admission = ctx.connection.admit(request)
      if (admission.peer !== ctx.connection.browserPeer || !sameOrigin(request)) return fail('forbidden', admission.rejection ?? 403)
      try {
        const action = await readAction(request)
        if (action instanceof Response) return action
        if (closed || request.signal.aborted) return fail('unavailable', 503)
        if (action.action === 'status') return reply(await snapshot())
        if (action.action === 'composer') {
          if (typeof action.agentId !== 'string' || action.agentId.length > 256) return fail('invalid_request')
          const choices = composerChoices(ctx.agents.get(action.agentId))
          return reply({ devices: choices.map(({ selection, label, deviceId, shell, transfer }) => ({
            selection, label, suffix: deviceId.slice(-8), shell, transfer,
          })) })
        }
        if (action.action === 'previewDirectory') {
          const grant = typeof action.id === 'string' && grants.get(action.id)
          const agent = grant ? ctx.agents.get(grant.agentId) : undefined
          return reply(await runDirectoryList({ session: action.id }, { agent, signal: request.signal }))
        }
        if (action.action === 'lock') { await lock(); return reply({ locked: true }) }
        if (action.action === 'revoke') {
          const grant = grants.get(action.id)
          if (!current(grant)) return fail('invalid_grant', 409)
          end(grant, 'revoked')
          return reply({ revoked: true })
        }
        if (management) return fail('busy', 409)
        const generation = lockGeneration
        const assertAllowed = () => {
          if (closed || generation !== lockGeneration || request.signal.aborted) invalid('vault_locked')
        }
        management = Promise.resolve().then(async () => {
          assertAllowed()
          const output = await manage(action, assertAllowed)
          if (generation === lockGeneration && await vault.status() === 'unlocked' && generation === lockGeneration) touch()
          return output
        })
        try { return reply(await management) }
        finally { management = undefined }
      } catch (error) {
        const code = publicFailures.has(error?.code) ? error.code : 'vault_io'
        return fail(code, ['vault_io', 'configuration_failed', 'cleanup_failed'].includes(code) ? 503 : 409)
      }
    },
  })
}
