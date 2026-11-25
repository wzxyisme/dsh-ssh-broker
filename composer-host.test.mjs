import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { existsSync } from 'node:fs'
import { chmod, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, truncate, utimes, writeFile } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { commandName, toolNames } from './bundle/composer.js'

const { DSH_TEST_ROOT, DSH_TEST_SSH_PACKAGE } = process.env
const sftpServer = ['/usr/lib/openssh/sftp-server', '/usr/libexec/openssh/sftp-server', '/usr/libexec/sftp-server'].find(existsSync)

test('SSH composer confines task admission to the live receiving session and selected grant', {
  skip: !DSH_TEST_ROOT || !DSH_TEST_SSH_PACKAGE ? 'Set DSH_TEST_ROOT and DSH_TEST_SSH_PACKAGE to run the Host integration test.' : false,
}, async (t) => {
  const hostRequire = createRequire(resolve(DSH_TEST_ROOT, 'package.json'))
  const sshRequire = createRequire(resolve(DSH_TEST_SSH_PACKAGE, 'package.json'))
  const { Client, Server, utils } = sshRequire('ssh2')
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.startsWith(new URL('./bundle/', import.meta.url).href)) {
        if (specifier.startsWith('@deepseek-ai/') || specifier === 'ssh2') {
          const require = specifier === 'ssh2' ? sshRequire : hostRequire
          return next(pathToFileURL(require.resolve(specifier)).href, context)
        }
      }
      return next(specifier, context)
    },
  })
  let apply
  try { ({ apply } = await import('./bundle/host.js')) }
  finally { hooks.deregister() }

  const directory = await mkdtemp(join(tmpdir(), 'ssh-composer-test-'))
  const messages = []
  const first = { id: 'first', followup: (message) => messages.push(message) }
  const second = { id: 'second' }
  const agents = new Map([[first.id, first], [second.id, second]])
  const peer = {}
  const tools = new Map()
  let command
  let route
  let dispose
  const events = new Map()
  const ctx = {
    agents: { get: (id) => agents.get(id), list: () => [...agents.values()] },
    fiber: { entry: { id: 'fixture' } }, profileContext: { dir: directory },
    connection: { browserPeer: peer, admit: () => ({ peer }), fetch: { register: (definition) => { route = definition } } },
    tools: { register: (tool, options) => { tools.set(tool.name, { tool, ...options }); return () => tools.delete(tool.name) } },
    inject: (deps, fn) => { assert.deepEqual(deps, ['commands']); fn({ commands: { register: (definition) => { command = definition } } }) },
    effect: (fn) => { dispose = fn() }, on: (name, fn) => events.set(name, fn),
  }
  const send = async (body, status = 200, origin = 'http://localhost') => {
    const response = await route.fetch(new Request('http://localhost/api/dsh-ssh-broker', {
      method: 'POST', headers: { origin, host: 'localhost', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    const data = await response.json()
    assert.equal(response.status, status, JSON.stringify(data))
    return data
  }
  const list = (agentId) => send({ action: 'composer', agentId })
  const authorize = (id, agent, fields = {}) => send({ action: 'grant', deviceId: id, agentId: agent.id, ttlSeconds: 300, confirm: true, ...fields })
  const submit = (rawInput, fields = {}) => command.handler({ agent: first, rawInput, attachments: [], signal: new AbortController().signal, ...fields })
  const choose = (device, task) => ` --device ${device.selection} -- ${task}`
  try {
    apply(ctx, { device: { get: () => ({}) } })
    assert.equal(command.name, commandName)
    assert.equal(command.recordInput, false)
    assert.equal(command.input.attachments, true)
    assert.deepEqual([...tools.keys()].sort(), Object.values(toolNames).sort())
    for (const { tool } of tools.values()) {
      assert.doesNotMatch(tool.description, /\p{Script=Han}/u)
      for (const { description } of Object.values(tool.parameters.properties)) {
        assert(description)
        assert.doesNotMatch(description, /\p{Script=Han}/u)
      }
    }
    assert.match(tools.get(toolNames.exec).tool.parameters.properties.workdir.description, /Absolute.*empty string/)
    assert.match(tools.get(toolNames.upload).tool.parameters.properties.attachment.description, /exactly one of attachment or workspacePath/)
    assert.deepEqual(await list(first.id), { devices: [] })
    assert.throws(() => submit('读取系统信息'), /没有有效的 SSH 授权/)
    await send({ action: 'initialize', passphrase: 'local fixture passphrase' })
    for (const port of [2224, 2225]) {
      await send({ action: 'configure', host: '127.0.0.1', port, username: 'fixture', label: '同名设备',
        fingerprint: `SHA256:${Buffer.alloc(32).toString('base64').slice(0, -1)}`,
        credential: { kind: 'password', value: 'fixture-only-password' }, confirmFingerprint: true })
    }
    const state = () => send({ action: 'status' })
    const [{ id: a }, { id: b }] = (await state()).devices
    await authorize(a, first)
    await authorize(b, second, { shell: false, transferDirectory: '/inbox' })
    const [shell] = (await list(first.id)).devices
    const [other] = (await list(second.id)).devices
    assert.deepEqual(Object.keys(shell).sort(), ['label', 'selection', 'shell', 'suffix', 'transfer'])
    assert.notEqual(shell.suffix, other.suffix)
    assert( tools.get(toolNames.exec).when({ agent: first }))
    assert(!tools.get(toolNames.exec).when({ agent: second }))
    assert.throws(() => submit(choose(other, '读取系统信息')), /授权已失效/)
    assert.throws(() => submit('读取系统信息', { agent: { ...first } }), /没有有效的 SSH 授权/)
    assert.throws(() => submit('读取系统信息', { signal: AbortSignal.abort() }), { name: 'AbortError' })
    assert.equal(messages.length, 0)
    const shellGrant = (await state()).grants.find(({ deviceId }) => deviceId === a)
    assert.equal(submit('读取系统信息').kind, 'success')
    assert.match(messages[0].content[0].text, new RegExp(shellGrant.id))
    assert.match(messages[0].content[0].text, /dsh_ssh_broker_exec/)
    assert.doesNotMatch(messages[0].content[0].text, /dsh_ssh_broker_upload|fixture-only-password/)
    await send({ action: 'revoke', id: (await state()).grants.find(({ deviceId }) => deviceId === b).id })
    await authorize(b, first, { shell: false, transferDirectory: '/inbox' })
    assert.throws(() => submit('读取系统信息'), /多台已授权设备/)
    const transfer = (await list(first.id)).devices.find((device) => device.transfer)
    const attachment = { type: 'file', attachment: { attachmentId: 'fixture', name: 'fixture.txt', bytes: 1 } }
    assert.equal(submit(choose(transfer, '上传附件'), { attachments: [attachment] }).kind, 'success')
    assert.deepEqual(messages[1].content[0], attachment)
    assert.match(messages[1].content[1].text, /dsh_ssh_broker_list/)
    assert.match(messages[1].content[1].text, /dsh_ssh_broker_upload/)
    assert.match(messages[1].content[1].text, /dsh_ssh_broker_verify/)
    assert.match(messages[1].content[1].text, /dsh_ssh_broker_replace/)
    assert.doesNotMatch(messages[1].content[1].text, /dsh_ssh_broker_exec|--device|fixture-only-password/)
    await send({ action: 'revoke', id: shellGrant.id })
    await authorize(a, first)
    assert.throws(() => submit(choose(shell, '读取系统信息')), /授权已失效/)
    await send({ action: 'lock' })
    assert.deepEqual(await list(first.id), { devices: [] })
    assert.throws(() => submit(choose(transfer, '上传附件')), /授权已失效/)
    assert.equal(messages.length, 2)

    await t.test('会话授权跨越空闲期，随撤销、会话关闭或上锁失效', async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] })
      const idleMs = 10 * 60_000
      const passphrase = 'local fixture passphrase'
      await send({ action: 'unlock', passphrase })
      const deviceRevision = (await state()).devices.find(({ id }) => id === a).revision
      const sessionGrant = { action: 'grant', deviceId: a, agentId: first.id, duration: 'session', deviceRevision, confirm: true }
      assert.deepEqual(await send(sessionGrant, 409), { error: 'invalid_grant' })
      assert.deepEqual(await send({ ...sessionGrant, confirmSession: true, deviceRevision: 'old' }, 409), { error: 'stale_device' })
      assert.deepEqual(await send({ ...sessionGrant, confirmSession: true, ttlSeconds: 300 }, 409), { error: 'invalid_grant' })
      assert.deepEqual(await send({ ...sessionGrant, duration: 'timed', ttlSeconds: 901 }, 409), { error: 'invalid_grant' })
      await send({ ...sessionGrant, confirmSession: true })
      const bRevision = (await state()).devices.find(({ id }) => id === b).revision
      await send({ ...sessionGrant, deviceId: b, deviceRevision: bRevision, agentId: second.id, confirmSession: true })
      t.mock.timers.tick(8 * 60 * 60_000)
      assert.equal((await state()).vault, 'unlocked')
      const active = (await state()).grants.filter(({ status }) => status === 'active')
      assert.equal(active.length, 2)
      assert(active.every(({ duration, remainingMs }) => duration === 'session' && remainingMs === null))
      assert.equal(submit('检查系统信息').kind, 'success')
      await send({ action: 'revoke', id: active.find(({ deviceId }) => deviceId === a).id })
      t.mock.timers.tick(idleMs + 1)
      assert.equal((await state()).vault, 'unlocked')
      assert.deepEqual(await list(first.id), { devices: [] })
      events.get('agent/disposed')({ agent: { ...second } })
      assert.equal((await list(second.id)).devices.length, 1)
      events.get('agent/disposed')({ agent: second })
      assert.deepEqual(await list(second.id), { devices: [] })
      assert.equal((await state()).grants.find(({ id }) => id === active.find(({ deviceId }) => deviceId === b).id).status, 'session_closed')
      t.mock.timers.tick(idleMs - 1)
      assert.equal((await state()).vault, 'unlocked')
      t.mock.timers.tick(1)
      assert.equal((await state()).vault, 'locked')
      await send({ action: 'unlock', passphrase })
      await authorize(a, first, { ttlSeconds: 1 })
      t.mock.timers.tick(1000)
      assert.equal((await state()).grants[0].status, 'expired')
      await send({ ...sessionGrant, confirmSession: true })
      await send({ action: 'lock' })
      assert.deepEqual(await list(first.id), { devices: [] })
      assert.equal((await state()).grants[0].status, 'vault_locked')
      await send({ action: 'unlock', passphrase })
      await send({ ...sessionGrant, confirmSession: true })
      await dispose()
      assert.equal(tools.size, 0)
      apply(ctx, { device: { get: () => ({}) } })
      assert.equal((await state()).vault, 'locked')
      assert.deepEqual((await state()).grants, [])
      await send({ action: 'unlock', passphrase })
      assert.deepEqual(await list(first.id), { devices: [] })
    })

    await t.test('Shell 工作目录校验与超时输出', async (t) => {
      const hostKey = utils.generateKeyPairSync('ed25519').private
      const publicKey = utils.parseKey(hostKey).getPublicSSH()
      const fingerprint = `SHA256:${createHash('sha256').update(publicKey).digest('base64').slice(0, -1)}`
      const password = 'loopback-fixture-only'
      const stdout = `stdout marker\n${'x'.repeat(8192)}`
      const stderr = 'stderr marker\n'
      const server = new Server({ hostKeys: [hostKey] }, (client) => {
        client.on('error', () => {})
        client.on('authentication', (auth) => {
          if (auth.method === 'password' && auth.username === 'fixture' && auth.password === password) auth.accept()
          else auth.reject()
        })
        client.on('session', (accept) => {
          accept().once('exec', (acceptExec, rejectExec, { command }) => {
            if (command === 'pwd' || command === "cd '/tmp/my dir' || exit 125\npwd") {
              const stream = acceptExec()
              stream.exit(0)
              stream.end(command === 'pwd' ? '/home/fixture\n' : '/tmp/my dir\n')
              return
            }
            if (command === "cd '/missing-dir' || exit 125\npwd") {
              const stream = acceptExec()
              stream.stderr.write('cd: no such directory\n')
              stream.exit(125)
              stream.end()
              return
            }
            if (command !== 'timeout-test') return rejectExec()
            const stream = acceptExec()
            stream.write(stdout)
            stream.stderr.write(stderr)
            // 保持通道开启，让插件自己的超时结束本次调用。
          })
        })
      })
      const received = new EventEmitter()
      const originalExec = Client.prototype.exec
      t.mock.method(Client.prototype, 'exec', function (command, options, callback) {
        return originalExec.call(this, command, options, (error, stream) => {
          callback(error, stream)
          if (error) return
          let outBytes = 0
          let errBytes = 0
          const check = () => {
            if (outBytes >= stdout.length && errBytes >= stderr.length) received.emit('complete')
          }
          stream.on('data', (chunk) => { outBytes += chunk.length; check() })
          stream.stderr.on('data', (chunk) => { errBytes += chunk.length; check() })
        })
      })
      const controller = new AbortController()
      let execution
      try {
        const listening = once(server, 'listening')
        server.listen(0, '127.0.0.1')
        await listening
        const { port } = server.address()
        await send({ action: 'configure', host: '127.0.0.1', port, username: 'fixture', label: 'Shell 超时测试',
          fingerprint, credential: { kind: 'password', value: password }, confirmFingerprint: true })
        const device = (await state()).devices.find((device) => device.label === 'Shell 超时测试')
        await authorize(device.id, first)
        const session = (await state()).grants.find(({ deviceId }) => deviceId === device.id).id
        const runShell = (args) => tools.get(toolNames.exec).tool.execute({ session, command: 'pwd', ...args }, {
          agent: first, signal: AbortSignal.timeout(5000),
        })
        for (const [args, cwd] of [[{}, '/home/fixture'], [{ workdir: '' }, '/home/fixture'], [{ workdir: '/tmp/my dir' }, '/tmp/my dir']]) {
          const output = await runShell(args)
          assert.equal(output.status, 'exited')
          assert.equal(output.exitCode, 0)
          assert.equal(output.stdout, `${cwd}\n`)
        }
        for (const workdir of ['.', '/bad\0dir', `/${'你'.repeat(342)}`]) {
          assert.equal((await runShell({ workdir })).status, 'invalid_workdir')
        }
        assert.equal((await runShell({ command: ' ' })).status, 'invalid_command')
        assert.equal((await runShell({ session: 'bad-id' })).status, 'invalid_arguments')
        const missing = await runShell({ workdir: '/missing-dir' })
        assert.equal(missing.status, 'exited')
        assert.equal(missing.exitCode, 125)
        assert.match(missing.stderr, /no such directory/)
        const originalSetTimeout = globalThis.setTimeout
        let expire
        // 只手动触发插件的执行超时，SSH 握手和清理仍使用真实计时器。
        t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
          if (delay === 30_000) expire = () => callback(...args)
          return originalSetTimeout(callback, delay, ...args)
        })
        const delivered = once(received, 'complete', { signal: AbortSignal.timeout(5000) })
        execution = tools.get(toolNames.exec).tool.execute({ session, command: 'timeout-test' }, { agent: first, signal: controller.signal })
        await delivered
        expire()
        const output = await execution
        assert.equal(output.status, 'timed_out')
        assert.equal(output.exitCode, null)
        assert.equal(output.exitSignal, null)
        assert.equal(output.stdout.length, 8192)
        assert.equal(output.stdout, stdout.slice(0, 8192))
        assert.equal(output.stderr, stderr)
        assert.equal(output.stdoutTruncated, true)
        assert.equal(output.stderrTruncated, false)
        await send({ action: 'revoke', id: session })
      } finally {
        controller.abort()
        try { await execution }
        finally {
          if (server.address()) await new Promise((resolve) => server.close(resolve))
        }
      }
    })
    await t.test('SFTP 目录预览、子目录授权、SHA-256 校验与审批替换', { skip: !sftpServer && '需要本机 OpenSSH sftp-server' }, async (t) => {
      const root = await realpath(directory)
      const inbox = join(root, 'inbox')
      const reports = join(inbox, 'reports')
      const outside = join(root, 'outside')
      const workspace = join(root, 'work')
      const local = join(workspace, 'docs', 'my report.bin')
      const binary = Buffer.from([0, 13, 10, 255, 80])
      await mkdir(join(workspace, 'docs'), { recursive: true })
      await writeFile(local, binary)
      await writeFile(join(workspace, 'large.bin'), '')
      await truncate(join(workspace, 'large.bin'), 8 * 1024 * 1024 + 1)
      await mkdir(reports, { recursive: true })
      await mkdir(join(outside, 'hidden'), { recursive: true })
      await writeFile(join(inbox, 'root.txt'), 'top level')
      await writeFile(join(reports, 'summary.txt'), 'nested file')
      await writeFile(join(inbox, '.dsh-sftp-fixture'), 'staging file')
      await symlink(outside, join(inbox, 'linked-dir'))
      await symlink(join(inbox, 'root.txt'), join(inbox, 'linked-file'))
      await symlink(outside, join(workspace, 'linked-dir'))
      await symlink(join(inbox, 'root.txt'), join(workspace, 'linked-file'))
      await link(join(inbox, 'root.txt'), join(workspace, 'hard-linked'))

      const { private: hostKey } = utils.generateKeyPairSync('ed25519')
      const fingerprint = `SHA256:${createHash('sha256').update(utils.parseKey(hostKey).getPublicSSH()).digest('base64').slice(0, -1)}`
      const password = 'sftp-fixture-only'
      const subprocesses = []
      const clients = new Set()
      let connections = 0
      const server = new Server({ hostKeys: [hostKey] }, (client) => {
        connections++
        clients.add(client)
        client.once('close', () => clients.delete(client))
        client.on('error', () => {})
        client.on('authentication', (auth) => {
          if (auth.method === 'password' && auth.username === 'fixture' && auth.password === password) auth.accept()
          else auth.reject()
        })
        client.on('session', (accept) => {
          accept().on('subsystem', (acceptSubsystem, rejectSubsystem, { name }) => {
            if (name !== 'sftp') return rejectSubsystem()
            const stream = acceptSubsystem()
            const child = spawn(sftpServer, [], { stdio: ['pipe', 'pipe', 'ignore'] })
            subprocesses.push({ child, closed: once(child, 'close') })
            child.stdin.on('error', () => {})
            stream.once('close', () => child.stdin.end())
            stream.pipe(child.stdin)
            child.stdout.pipe(stream)
          })
        })
      })
      const fixture = Buffer.from('attachment data')
      const source = { attachmentId: 'fixture-source', name: 'source.txt', bytes: fixture.length }
      let downloaded
      let savedAttachments = 0
      const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
      first.session = { id: first.id, header: { cwd: workspace } }
      const approvals = []
      let decision = () => 'allowed-once'
      const fs = {
        processPathFromHostPath: (path) => path,
        resolve: (path, { cwd }) => realpath(resolve(cwd, path)),
        processPath: (path) => path,
      }
      const approval = { request: async (request) => { approvals.push(request); return decision(request) } }
      ctx.get = (service) => ({ approval, fs })[service]
      ctx.sessionQuery = { observeSession: async () => ({
        inheritedEventCount: 0,
        events: [{ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'file', attachment: source }] } }],
        [Symbol.dispose]() {},
      }) }
      ctx.attachments = {
        async *readFileStream(ref) { assert.equal(ref, source); yield fixture },
        async saveFileStream({ data, name }) {
          savedAttachments++
          const chunks = []
          for await (const chunk of data) chunks.push(chunk)
          downloaded = Buffer.concat(chunks)
          return { attachmentId: 'fixture-download', name, bytes: downloaded.length }
        },
      }
      try {
        const listening = once(server, 'listening')
        server.listen(0, '127.0.0.1')
        await listening
        await send({ action: 'configure', host: '127.0.0.1', port: server.address().port, username: 'fixture', label: 'SFTP 测试',
          fingerprint, credential: { kind: 'password', value: password }, confirmFingerprint: true })
        const device = (await state()).devices.find(({ label }) => label === 'SFTP 测试')
        const fields = { shell: false, transferDirectory: inbox }
        const createGrant = async (options) => {
          await authorize(device.id, first, { ...fields, ...options })
          return (await state()).grants.find(({ deviceId, status }) => deviceId === device.id && status === 'active')
        }
        let grant = await createGrant()
        const preview = () => ({ action: 'previewDirectory', id: grant.id })
        const revoke = () => send({ action: 'revoke', id: grant.id })
        const run = (name, args = {}, agent = first, signal = AbortSignal.timeout(20000)) => tools.get(toolNames[name]).tool.execute({ session: grant.id, ...args }, {
          agent, signal, callId: 'fixture-call',
        })
        const expectEntries = (result, entries) => {
          assert.equal(result.status, 'listed')
          assert.equal(result.truncated, false)
          assert.deepEqual(result.entries.toSorted((a, b) => a.name.localeCompare(b.name)), entries)
        }
        assert.equal(grant.includeSubdirectories, false)
        assert(tools.get(toolNames.list).when({ agent: first }))
        assert(!tools.get(toolNames.exec).when({ agent: first }))
        assert(!tools.get(toolNames.list).when({ agent: second }))
        assert.equal((await run('list', {}, second)).status, 'not_authorized')
        const localSource = { workspacePath: '@"docs/my report.bin"' }
        assert(tools.get(toolNames.verify).when({ agent: first }))
        assert(tools.get(toolNames.replace).when({ agent: first }))
        assert(!tools.get(toolNames.verify).when({ agent: second }))
        assert(!tools.get(toolNames.replace).when({ agent: second }))
        assert.equal((await run('verify', { ...localSource, name: 'root.txt' }, second)).status, 'not_authorized')
        assert.equal((await run('replace', { name: 'root.txt', attachment: source.name }, second)).status, 'not_authorized')
        assert.equal((await run('replace', { name: 'reports/summary.txt', attachment: source.name })).status, 'subdirectories_not_allowed')
        if (process.platform === 'linux') {
          assert.equal((await run('verify', { ...localSource, name: 'reports/summary.txt' })).status, 'subdirectories_not_allowed')
          assert.equal((await run('verify', { ...localSource, name: '../outside/hidden/test' })).status, 'invalid_arguments')
          assert.equal((await run('verify', { name: 'root.txt', workspacePath: '../outside/hidden/test' })).status, 'invalid_arguments')
        }
        assert.equal((await run('replace', { name: '../outside/hidden/test', attachment: source.name })).status, 'invalid_arguments')
        assert.equal((await run('list', { path: 'reports' })).status, 'subdirectories_not_allowed')
        assert.equal((await run('download', { name: 'reports/summary.txt' })).status, 'subdirectories_not_allowed')
        assert.equal((await run('upload', { name: 'reports/new.txt', attachment: source.name })).status, 'subdirectories_not_allowed')
        if (process.platform === 'linux') {
          const upload = { name: 'workspace.bin', workspacePath: '@"docs/my report.bin"' }
          assert.equal((await run('upload', upload, second)).status, 'not_authorized')
          assert.equal((await run('upload', { ...upload, name: 'reports/workspace.bin' })).status, 'subdirectories_not_allowed')
          assert.equal((await run('upload', { name: 'workspace.bin' })).status, 'invalid_arguments')
          assert.equal((await run('upload', { ...upload, attachment: '', workspacePath: '' })).status, 'invalid_arguments')
          assert.equal((await run('upload', { ...upload, attachment: source.name })).status, 'invalid_arguments')
          for (const attachment of [null, false, 0]) {
            await assert.rejects(async () => run('upload', { ...upload, attachment }), { code: 'INVALID_ARGS' })
          }
          for (const workspacePath of [local, `@${local}`, 'docs/../large.bin', 'C:/tmp/doc', '././large.bin', 'docs/', '']) {
            assert.equal((await run('upload', { ...upload, workspacePath })).status, 'invalid_arguments')
          }
          for (const [workspacePath, status] of [
            ['docs/absent.bin', 'workspace_file_not_found'], ['large.bin', 'file_too_large'],
            ['linked-dir/hidden/test', 'workspace_not_regular_file'], ['linked-file', 'workspace_not_regular_file'],
            ['hard-linked', 'workspace_not_regular_file'], ['docs', 'workspace_not_regular_file'],
          ]) assert.equal((await run('upload', { ...upload, workspacePath })).status, status)
          ctx.get = (service) => service === 'fs' ? fs : undefined
          assert.equal((await run('upload', upload)).status, 'approval_unavailable')
          ctx.get = (service) => service === 'approval' ? approval : { ...fs, processPathFromHostPath: () => undefined }
          assert.equal((await run('upload', upload)).status, 'workspace_unavailable')
          ctx.get = (service) => ({ approval, fs })[service]
          first.session.header.cwd = join(workspace, 'linked-dir')
          assert.equal((await run('upload', upload)).status, 'workspace_unavailable')
          first.session.header.cwd = workspace
          assert.equal(approvals.length, 0)
          for (const state of ['rejected', 'cancelled', 'unavailable']) {
            decision = () => state
            assert.equal((await run('upload', upload)).status, `approval_${state}`)
          }
          const question = approvals.at(-1)
          assert.equal(question.callId, 'fixture-call')
          assert.equal(question.agent, first)
          assert.equal(question.toolName, toolNames.upload)
          assert(question.reason.includes(local))
          assert(question.reason.includes('fixture@127.0.0.1:'))
          assert(question.reason.includes(join(inbox, upload.name)))
          decision = async () => {
            await writeFile(local, Buffer.alloc(binary.length, 0xff))
            return 'allowed-once'
          }
          assert.equal((await run('upload', upload)).status, 'workspace_file_changed')
          await writeFile(local, binary)
          decision = () => 'allowed-once'
        }
        assert.deepEqual(await send(preview(), 403, 'http://another-origin'), { error: 'forbidden' })
        assert.equal(connections, 0)
        const rootEntries = [{ name: 'reports', type: 'directory' }, { name: 'root.txt', type: 'file' }]
        expectEntries(await send(preview()), rootEntries)
        expectEntries(await run('list'), rootEntries)
        const rootDownload = await run('download', { name: 'root.txt' })
        assert.equal(rootDownload.status, 'downloaded')
        assert.equal(downloaded.toString(), 'top level')
        await revoke()
        assert.equal((await send(preview())).status, 'revoked')
        assert.deepEqual((await run('list')).entries, [])
        assert(!tools.get(toolNames.list).when({ agent: first }))

        grant = await createGrant({ includeSubdirectories: true })
        assert.equal(grant.includeSubdirectories, true)
        expectEntries(await run('list', { path: 'reports' }), [{ name: 'summary.txt', type: 'file' }])
        expectEntries(await send(preview()), rootEntries)
        for (const path of ['/reports', 'reports/../reports', 'reports//nested']) {
          assert.equal((await run('list', { path })).status, 'invalid_arguments')
        }
        assert.equal((await run('list', { path: 'linked-dir/hidden' })).status, 'remote_directory_changed')
        assert.equal((await run('download', { name: 'linked-file' })).status, 'remote_not_regular_file')
        assert.equal((await run('upload', { name: 'linked-dir/hidden/new.txt', attachment: source.name })).status, 'remote_directory_changed')
        const result = await run('download', { name: 'reports/summary.txt' })
        assert.equal(result.status, 'downloaded')
        assert.equal(result.attachment.name, 'summary.txt')
        assert.equal(downloaded.toString(), 'nested file')
        const upload = { name: 'reports/new.txt', attachment: source.name }
        assert.equal((await run('upload', { ...upload, workspacePath: '' })).status, 'uploaded')
        assert.equal((await run('upload', upload)).status, 'remote_exists')
        const replacementPath = join(reports, 'new.txt')
        assert.deepEqual(await readFile(replacementPath), fixture)
        const replacement = { ...upload, workspacePath: '' }
        const earlierApprovals = approvals.length
        const missingReplacement = join(reports, 'missing.txt')
        assert.equal((await run('replace', { ...replacement, name: 'reports/missing.txt' })).status, 'remote_not_found')
        assert.equal((await run('replace', { ...replacement, name: 'linked-file' })).status, 'remote_not_regular_file')
        assert.equal((await run('replace', { ...replacement, name: 'linked-dir/hidden/new.txt' })).status, 'remote_directory_changed')
        assert.equal(approvals.length, earlierApprovals)
        assert(!existsSync(missingReplacement))
        assert(!existsSync(join(outside, 'hidden', 'new.txt')))

        const mode = 0o751
        const oldContents = Buffer.alloc(fixture.length, 0x61)
        const changedContents = Buffer.alloc(fixture.length, 0x62)
        const fixedTime = new Date('2024-01-01T00:00:00Z')
        await writeFile(replacementPath, oldContents)
        await chmod(replacementPath, mode)
        await utimes(replacementPath, fixedTime, fixedTime)
        decision = () => 'rejected'
        assert.equal((await run('replace', replacement)).status, 'approval_rejected')
        assert.deepEqual(await readFile(replacementPath), oldContents)
        const replacementQuestion = approvals.at(-1)
        assert.equal(replacementQuestion.agent, first)
        assert.equal(replacementQuestion.toolName, toolNames.replace)
        assert.equal(replacementQuestion.callId, 'fixture-call')
        assert(replacementQuestion.reason.includes(replacementPath))
        assert(replacementQuestion.reason.includes(sha256(oldContents)))

        decision = async () => {
          // SFTP v3 只能看到秒级 mtime；保持大小、权限和 mtime 不变以验证内容哈希确实参加复核。
          await writeFile(replacementPath, changedContents)
          await utimes(replacementPath, fixedTime, fixedTime)
          return 'allowed-once'
        }
        assert.equal((await run('replace', replacement)).status, 'remote_file_changed')
        assert.deepEqual(await readFile(replacementPath), changedContents)

        decision = () => 'allowed-once'
        const replaced = await run('replace', replacement)
        assert.equal(replaced.status, 'replaced')
        assert.equal(replaced.bytes, fixture.length)
        assert.deepEqual(await readFile(replacementPath), fixture)
        assert.equal((await stat(replacementPath)).mode & 0o777, mode)

        if (process.platform === 'linux') {
          const upload = { name: 'reports/workspace.bin', workspacePath: '@"docs/my report.bin"' }
          const previousApprovals = approvals.length
          const uploaded = await run('upload', { ...upload, attachment: '' })
          assert.equal(uploaded.status, 'uploaded')
          assert.equal(uploaded.bytes, binary.length)
          assert.equal(uploaded.phase, 'cleanup')
          assert.equal(uploaded.acknowledgedBytes, binary.length)
          assert.deepEqual(await readFile(join(reports, 'workspace.bin')), binary)
          assert.equal((await run('upload', upload)).status, 'remote_exists')
          assert.equal(approvals.length, previousApprovals + 2)
          const workspaceTarget = join(reports, 'workspace.bin')
          assert.deepEqual(await readFile(workspaceTarget), binary)

          const expectedLocalHash = sha256(binary)
          const beforeVerify = await stat(workspaceTarget)
          const verifyApprovals = approvals.length
          const verifyAttachments = savedAttachments
          ctx.get = (service) => service === 'fs' ? fs : undefined
          const matched = await run('verify', upload)
          assert.equal(matched.status, 'matched')
          assert.equal(matched.localSha256, expectedLocalHash)
          assert.equal(matched.remoteSha256, expectedLocalHash)
          assert.equal(matched.localBytes, binary.length)
          assert.equal(matched.remoteBytes, binary.length)
          assert.equal(matched.attachment, undefined)
          const mismatched = await run('verify', { ...upload, name: replacement.name })
          assert.equal(mismatched.status, 'mismatched')
          assert.equal(mismatched.localSha256, expectedLocalHash)
          assert.equal(mismatched.remoteSha256, sha256(fixture))
          assert.equal(mismatched.localBytes, binary.length)
          assert.equal(mismatched.remoteBytes, fixture.length)
          assert.equal(mismatched.attachment, undefined)
          const missing = await run('verify', { ...upload, name: 'reports/missing.txt' })
          assert.equal(missing.status, 'remote_not_found')
             assert.equal(missing.localSha256, expectedLocalHash)
           assert.equal(missing.remoteSha256, null)
          assert(!existsSync(missingReplacement))
          assert.deepEqual(await readFile(workspaceTarget), binary)
          assert.deepEqual(await readFile(replacementPath), fixture)
          const afterVerify = await stat(workspaceTarget)
          assert.equal(afterVerify.ino, beforeVerify.ino)
          assert.equal(afterVerify.mtimeMs, beforeVerify.mtimeMs)
          assert.equal(approvals.length, verifyApprovals)
          assert.equal(savedAttachments, verifyAttachments)
          ctx.get = (service) => ({ approval, fs })[service]

          const replacedFromWorkspace = await run('replace', { ...upload, name: replacement.name, attachment: '' })
          assert.equal(replacedFromWorkspace.status, 'replaced')
          assert.equal(replacedFromWorkspace.bytes, binary.length)
          assert.equal(approvals.length, verifyApprovals + 1)
          assert.deepEqual(await readFile(replacementPath), binary)
          assert.equal((await stat(replacementPath)).mode & 0o777, mode)
        }
        const interceptSftp = async (hook, work) => {
          const original = Client.prototype.sftp
          Client.prototype.sftp = function (callback) {
            return original.call(this, (error, sftp) => {
              if (!error) hook(sftp)
              callback(error, sftp)
            })
          }
          try { return await work() }
          finally { Client.prototype.sftp = original }
        }
        const deadlines = new Map()
        const originalSetTimeout = globalThis.setTimeout
        const originalClearTimeout = globalThis.clearTimeout
        const setMock = t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
          const timer = originalSetTimeout(callback, delay, ...args)
          if (delay === 60_000 || delay === 120_000) deadlines.set(timer, { delay, fire: () => callback(...args) })
          return timer
        })
        const clearMock = t.mock.method(globalThis, 'clearTimeout', (timer) => {
          deadlines.delete(timer)
          return originalClearTimeout(timer)
        })
        const activeDeadline = (delay) => {
          assert.equal(deadlines.size, 1)
          const [timer, deadline] = deadlines.entries().next().value
          assert.equal(deadline.delay, delay)
          return { timer, fire: deadline.fire }
        }
        const uploadSummary = ({ status, phase, bytes, acknowledgedBytes }) => [status, phase, bytes, acknowledgedBytes]
        const attachmentUpload = (filename) => run('upload', { name: `reports/${filename}`, attachment: source.name })
        try {
          if (process.platform === 'linux') {
            const before = connections
            let approvalTimer
            decision = ({ signal }) => new Promise((resolve) => {
              signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
              approvalTimer = activeDeadline(120_000).timer
              activeDeadline(120_000).fire()
            })
            const input = { name: 'reports/approval-timeout.bin', workspacePath: '@"docs/my report.bin"' }
            assert.deepEqual(uploadSummary(await run('upload', input)), ['approval_timed_out', 'approval', null, 0])
            assert.equal(connections, before)
            assert(!existsSync(join(inbox, input.name)))
            assert.equal(deadlines.size, 0)

            let transferTimer
            decision = () => {
              const timer = activeDeadline(120_000).timer
              assert.notEqual(timer, approvalTimer)
              approvalTimer = timer
              return 'allowed-once'
            }
            const uploaded = await interceptSftp(() => {
              transferTimer = activeDeadline(60_000).timer
            }, () => run('upload', { ...input, name: 'reports/after-approval.bin' }))
            assert(transferTimer)
            assert.notEqual(transferTimer, approvalTimer)
            assert.deepEqual(uploadSummary(uploaded), ['uploaded', 'cleanup', binary.length, binary.length])
            decision = () => 'allowed-once'
          }

          const writingTimeout = await interceptSftp((sftp) => {
            const write = sftp.write.bind(sftp)
            sftp.write = (...args) => {
              const callback = args.pop()
              return write(...args, (error) => {
                callback(error)
                if (!error) activeDeadline(60_000).fire()
              })
            }
          }, () => attachmentUpload('writing-timeout.txt'))
          assert.deepEqual(uploadSummary(writingTimeout), ['timed_out', 'writing', null, fixture.length])
          assert(!existsSync(join(reports, 'writing-timeout.txt')))

          for (const timeout of [false, true]) {
            const filename = `unconfirmed-${timeout}.txt`
            const unknown = await interceptSftp((sftp) => {
              const hardlink = sftp.ext_openssh_hardlink.bind(sftp)
              sftp.ext_openssh_hardlink = (from, to, callback) => hardlink(from, to, (error) => {
                if (error) return callback(error)
                // 服务端已发布文件，但 Broker 没有收到成功回执。
                if (timeout) activeDeadline(60_000).fire()
                callback(Error('fixture: hardlink acknowledgement lost'))
              })
            }, () => attachmentUpload(filename))
            assert.deepEqual(uploadSummary(unknown), ['upload_commit_unknown', 'committing', null, fixture.length])
            assert.deepEqual(await readFile(join(reports, filename)), fixture)
          }

          const cleanupTimeout = await interceptSftp((sftp) => {
            sftp.unlink = (_path, callback) => {
              activeDeadline(60_000).fire()
              callback(Error('fixture: unlink not acknowledged'))
            }
          }, () => attachmentUpload('cleanup-timeout.txt'))
          assert.deepEqual(uploadSummary(cleanupTimeout), ['uploaded_cleanup_pending', 'cleanup', fixture.length, fixture.length])
          assert.deepEqual(await readFile(join(reports, 'cleanup-timeout.txt')), fixture)

          const raced = await interceptSftp((sftp) => {
            const hardlink = sftp.ext_openssh_hardlink.bind(sftp)
            sftp.ext_openssh_hardlink = (from, to, callback) => {
              writeFile(to, 'competing file', { flag: 'wx' }).then(() => hardlink(from, to, callback), callback)
            }
          }, () => attachmentUpload('raced.txt'))
          assert.deepEqual(uploadSummary(raced), ['remote_exists', 'committing', null, fixture.length])
          assert.equal(await readFile(join(reports, 'raced.txt'), 'utf8'), 'competing file')
          assert.equal(deadlines.size, 0)
        } finally {
          setMock.mock.restore()
          clearMock.mock.restore()
          decision = () => 'allowed-once'
          // 前提交超时或清理未确认的样例可能留下临时文件，后续替换用独立的清理断言。
          for (const name of await readdir(reports)) {
            if (name.startsWith('.dsh-sftp-')) await rm(join(reports, name))
          }
        }
        await writeFile(replacementPath, oldContents)
        await chmod(replacementPath, 0o4751)
        const beforeSpecialMode = approvals.length
        assert.equal((await run('replace', replacement)).status, 'replace_metadata_mismatch')
        assert.equal(approvals.length, beforeSpecialMode)
        await chmod(replacementPath, mode)
        const unsupported = await interceptSftp((sftp) => {
          sftp.ext_openssh_rename = () => { throw Error('Server does not support this extended request') }
        }, () => run('replace', replacement))
        assert.equal(unsupported.status, 'replace_unsupported')
        assert.deepEqual(await readFile(replacementPath), oldContents)
        assert.equal((await readdir(reports)).some((name) => name.startsWith('.dsh-sftp-')), false)

        const beforeCommit = new AbortController()
        let renameAttempted = false
        const cancelled = await interceptSftp((sftp) => {
          const write = sftp.write.bind(sftp)
          sftp.write = (...args) => {
            const callback = args.pop()
            return write(...args, (error) => { if (!error) beforeCommit.abort(); callback(error) })
          }
          const rename = sftp.ext_openssh_rename.bind(sftp)
          sftp.ext_openssh_rename = (...args) => { renameAttempted = true; return rename(...args) }
        }, () => run('replace', replacement, first, beforeCommit.signal))
        assert.equal(cancelled.status, 'cancelled')
        assert.equal(renameAttempted, false)
        assert.deepEqual(await readFile(replacementPath), oldContents)

        const duringCommit = new AbortController()
        const unknown = await interceptSftp((sftp) => {
          const rename = sftp.ext_openssh_rename.bind(sftp)
          sftp.ext_openssh_rename = (from, to, callback) => rename(from, to, (error) => {
            if (error) return callback(error)
            // 目标机确实执行了 rename，但模拟 Broker 未收到成功回复即断开。
            duringCommit.abort()
            callback(Error('fixture: rename acknowledgement lost'))
          })
        }, () => run('replace', replacement, first, duringCommit.signal))
        assert.equal(unknown.status, 'replace_commit_unknown')
        assert.deepEqual(await readFile(replacementPath), fixture)

        await Promise.all(Array.from({ length: 101 }, (_, index) => writeFile(join(reports, `entry-${index}`), '')))
        const limited = await run('list', { path: 'reports' })
        assert.equal(limited.status, 'listed')
        assert.equal(limited.entries.length, 100)
        assert.equal(limited.truncated, true)
        if (process.platform === 'linux') {
          const pending = Promise.withResolvers()
          const answer = Promise.withResolvers()
          decision = (request) => { pending.resolve(request); return answer.promise }
          const before = connections
          const transfer = run('upload', { name: 'revoked.bin', workspacePath: '@docs/my report.bin' })
          try {
            const request = await Promise.race([pending.promise, transfer.then(({ status }) => { throw Error(status) })])
            assert.equal(request.signal.aborted, false)
            await revoke()
            assert.equal(request.signal.aborted, true)
          } finally { answer.resolve('allowed-once') }
          assert.equal((await transfer).status, 'revoked')
          assert.equal(connections, before)
          assert(!existsSync(join(inbox, 'revoked.bin')))
        } else await revoke()
      } finally {
        for (const client of clients) client.end()
        for (const { child } of subprocesses) child.stdin.end()
        if (server.address()) await new Promise((resolve) => server.close(resolve))
        await Promise.all(subprocesses.map(({ closed }) => closed))
      }
    })
  } finally {
    await dispose?.()
    assert(directory.startsWith(join(tmpdir(), 'ssh-composer-test-')))
    await rm(directory, { recursive: true, force: true })
  }
})
