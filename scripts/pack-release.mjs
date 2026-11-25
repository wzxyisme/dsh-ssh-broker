import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const source = join(root, 'bundle')
const dist = join(root, 'dist')
mkdirSync(dist, { recursive: true })
assert.equal(realpathSync(dist), dist)
const stage = mkdtempSync(join(dist, '.pack-'))
const out = join(stage, 'bundle')
const npm = (args, options) => execFileSync('npm', args, { cwd: out, ...options })

try {
  cpSync(source, out, { recursive: true, filter: path => path !== join(source, 'node_modules') })
  npm(['ci', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit' })

  // ssh2 的公开测试夹具包含非运行所需的私钥样本，不应进入插件归档。
  const fixtures = join(out, 'node_modules', 'ssh2', 'test')
  assert.equal(realpathSync(fixtures), fixtures)
  rmSync(fixtures, { recursive: true })

  const result = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', stage], { encoding: 'utf8' }))
  const packed = Array.isArray(result) ? result[0] : result['dsh-ssh-broker']
  assert.equal(packed.name, 'dsh-ssh-broker')
  assert.match(packed.filename, /^dsh-ssh-broker-\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?\.tgz$/)
  const paths = packed.files.map(file => file.path)
  const bundled = new Set(paths.filter(path => path.startsWith('node_modules/')).map(path => path.split('/')[1]))
  assert.deepEqual(bundled, new Set(['asn1', 'bcrypt-pbkdf', 'safer-buffer', 'ssh2', 'tweetnacl']))
  assert(paths.every(path => !path.startsWith('node_modules/ssh2/test/') && !/\.(?:node|pem|key|ppk)$/.test(path)))
  for (const dependency of bundled) assert(paths.includes(`node_modules/${dependency}/LICENSE`))

  const archive = readFileSync(join(stage, packed.filename))
  writeFileSync(join(dist, packed.filename), archive)
  writeFileSync(join(dist, 'SHA256SUMS'), `${createHash('sha256').update(archive).digest('hex')}  ${packed.filename}\n`)
  console.log(`dist/${packed.filename}`)
} finally {
  assert.equal(realpathSync(stage), stage)
  rmSync(stage, { recursive: true })
}
