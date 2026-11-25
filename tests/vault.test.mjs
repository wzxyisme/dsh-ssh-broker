import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Vault } from '../bundle/vault.js'

const passphrase = 'local fixture passphrase'
const backupPassphrase = 'separate backup fixture passphrase'
const device = { label: 'fixture', credential: { value: 'fixture-password-never-in-ciphertext' } }
function validate(devices) {
  assert(Array.isArray(devices))
  for (const entry of devices) assert.equal(typeof entry.credential.value, 'string')
}

test('encrypted snapshots, cross-instance lease, restore, and lock invalidation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ssh-vault-unit-'))
  const path = join(root, 'source', 'vault.json')
  const destination = join(root, 'destination', 'vault.json')
  const source = new Vault(path, validate)
  const second = new Vault(path, validate)
  const target = new Vault(destination, validate)
  try {
    assert.equal(await source.status(), 'uninitialized')
    await source.initialize(passphrase)
    const empty = source.devices()
    await source.replace(empty, [device])
    await assert.rejects(source.replace(empty, []), { code: 'vault_conflict' })
    const ciphertext = await readFile(path, 'utf8')
    assert(!ciphertext.includes(device.credential.value))
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    await assert.rejects(second.unlock(passphrase), { code: 'vault_conflict' })
    assert.throws(() => { source.devices()[0].credential.value = 'mutated' }, TypeError)

    const archive = await source.backup(backupPassphrase)
    assert(!archive.includes(device.credential.value))
    await target.initialize(passphrase)
    const broken = JSON.parse(archive)
    broken.tag = broken.tag.replace(/^./, (ch) => ch === 'A' ? 'B' : 'A')
    await assert.rejects(target.restore(JSON.stringify(broken), backupPassphrase), { code: 'backup_invalid' })
    assert.deepEqual(target.devices(), [])
    await target.restore(archive, backupPassphrase, (entries) => entries.map((entry) => ({ ...entry, label: 'restored' })))
    assert.equal(await target.status(), 'locked')
    await target.unlock(passphrase)
    assert.deepEqual(target.devices(), [{ ...device, label: 'restored' }])

    await source.lock()
    await assert.rejects(second.unlock('wrong fixture passphrase'), { code: 'vault_invalid' })
    const interrupted = second.unlock(passphrase)
    const locking = second.lock()
    await assert.rejects(interrupted, { code: 'vault_locked' })
    await locking
    await second.unlock(passphrase)
    assert.deepEqual(second.devices(), [device])
    await second.lock()
    await writeFile(path, ciphertext.replace('"version":1', '"version":2'))
    await assert.rejects(source.unlock(passphrase), { code: 'vault_invalid' })
    assert.equal(await source.status(), 'locked')
  } finally {
    await Promise.allSettled([source.lock(), second.lock(), target.lock()])
    assert(root.startsWith(join(tmpdir(), 'ssh-vault-unit-')))
    await rm(root, { recursive: true, force: true })
  }
})
