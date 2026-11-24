import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire, registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { commandName, toolNames } from './bundle/composer.js'

const { DSH_TEST_ROOT, DSH_TEST_SSH_PACKAGE } = process.env

test('SSH composer confines task admission to the live receiving session and selected grant', {
  skip: !DSH_TEST_ROOT || !DSH_TEST_SSH_PACKAGE ? 'Set DSH_TEST_ROOT and DSH_TEST_SSH_PACKAGE to run the Host integration test.' : false,
}, async (t) => {
  const hostRequire = createRequire(resolve(DSH_TEST_ROOT, 'package.json'))
  const sshRequire = createRequire(resolve(DSH_TEST_SSH_PACKAGE, 'package.json'))
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
    tools: { register: (tool, options) => { tools.set(tool.name, options); return () => tools.delete(tool.name) } },
    inject: (deps, fn) => { assert.deepEqual(deps, ['commands']); fn({ commands: { register: (definition) => { command = definition } } }) },
    effect: (fn) => { dispose = fn() }, on: (name, fn) => events.set(name, fn),
  }
  const send = async (body, status = 200) => {
    const response = await route.fetch(new Request('http://localhost/api/dsh-ssh-broker', {
      method: 'POST', headers: { origin: 'http://localhost', host: 'localhost', 'content-type': 'application/json' },
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
    assert.deepEqual([...tools.keys()], Object.values(toolNames))
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
    assert.match(messages[1].content[1].text, /dsh_ssh_broker_upload/)
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
  } finally {
    await dispose?.()
    assert(directory.startsWith(join(tmpdir(), 'ssh-composer-test-')))
    await rm(directory, { recursive: true, force: true })
  }
})
