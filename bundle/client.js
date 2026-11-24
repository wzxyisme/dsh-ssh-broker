window.__ModuleLoader__.load({
  id: '@local/dsh-ssh-broker',
  factory(require) {
    const { createElement: h, useEffect, useRef, useState } = require('react')
    const ns = 'ssh-broker-settings'
    const labels = {
      title: ['SSH devices', 'SSH 设备'], uninitialized: ['Vault not initialized', '凭据库未初始化'], locked: ['Vault locked', '凭据库已上锁'], unlocked: ['Vault unlocked', '凭据库已解锁'],
      initialize: ['Create vault', '创建凭据库'], unlock: ['Unlock', '解锁'], lock: ['Lock and revoke access', '上锁并撤销授权'],
      passphrase: ['Vault passphrase', '凭据库口令'], backupPassphrase: ['Backup passphrase', '备份口令'],
      vaultHelp: ['Use a strong passphrase (at least 12 bytes). Keep it separately from the encrypted backup.', '使用至少 12 字节的强口令，并和加密备份分开保存。'],
      backup: ['Download encrypted backup', '下载加密备份'], restore: ['Restore encrypted backup', '恢复加密备份'], archive: ['Encrypted backup file', '加密备份文件'],
      confirmRestore: ['Restore into the empty vault and verify each host key again before granting access.', '恢复到空库，并在授权前重新核验每台设备的 Host Key。'],
      add: ['Add device', '添加设备'], select: ['Select device', '选择设备'], name: ['Device name', '设备名称'],
      host: ['Host', '主机'], port: ['Port', '端口'], user: ['SSH user', 'SSH 用户'], fingerprint: ['Host Key SHA256 fingerprint', 'Host Key SHA256 指纹'],
      pin: ['I checked this fingerprint through a trusted channel.', '我已通过可信渠道核对该指纹。'],
      keep: ['Keep current credential', '保留现有凭据'], password: ['SSH password', 'SSH 密码'], key: ['OpenSSH private key', 'OpenSSH 私钥'], keyPassphrase: ['Private key passphrase', '私钥口令'],
      credential: ['Credential', '凭据'], save: ['Save device', '保存设备'], delete: ['Delete device', '删除设备'], checkDelete: ['Delete this device and its stored credential.', '删除此设备及其已保存的凭据。'],
      unverified: ['Verify the restored host key before granting access.', '授权前请核验恢复设备的 Host Key。'],
      migrate: ['Migrate legacy device', '迁移旧设备'], cleanup: ['Retry legacy cleanup', '重试清理旧记录'], legacy: ['Legacy device', '旧版设备'],
      confirmLegacy: ['Move the matching credential into the vault and remove the old local record.', '将匹配的凭据迁入加密库，并移除本地旧记录。'],
      session: ['Harness conversation', 'Harness 会话'], choose: ['Select conversation', '选择会话'], ttl: ['Duration (seconds)', '有效期（秒）'],
      confirmGrant: ['Grant the selected access to this conversation and device.', '将所选权限授予此会话，仅限所选设备。'],
      grantMode: ['Allowed operations', '允许的操作'], shellOnly: ['Shell only (file transfer off)', '仅 Shell（文件传输关闭）'],
      transferOnly: ['File transfer only', '仅文件传输'], shellAndTransfer: ['Shell and file transfer', 'Shell 和文件传输'],
      transferDirectory: ['Remote directory', '远端目录'],
      transferHelp: ['Use an absolute directory without symlinks, such as /home/ssh-user/inbox. Transfers are limited to files directly inside this directory, up to 8 MiB per file.', '输入无符号链接的绝对目录，例如 /home/ssh-user/inbox。只能传输该目录下的文件，每个文件最多 8 MiB。'],
      invalid_transfer_directory: ['Enter an absolute directory other than /. Omit the trailing slash and dot segments.', '请输入非根目录的绝对路径，去掉末尾斜杠和 .、.. 路径段。'],
      grant: ['Grant access', '授予权限'], revoke: ['Revoke access', '撤销权限'], access: ['Authorizations', '会话授权'], audit: ['Recent activity', '近期活动'], refresh: ['Refresh', '刷新'],
      active: ['Active', '生效中'], revoked: ['Revoked', '已撤销'], expired: ['Expired', '已到期'], session_closed: ['Conversation closed', '会话已关闭'],
      device_changed: ['Device changed', '设备已变更'], credential_changed: ['Credential changed', '凭据已变更'], unloaded: ['Plugin unloaded', '插件已卸载'],
      granted: ['Access granted', '已授予权限'], device_saved: ['Device saved', '设备已保存'], device_deleted: ['Device deleted', '设备已删除'],
      device_migrated: ['Device migrated', '设备已迁移'], legacy_cleaned: ['Old credential removed', '旧凭据已清理'], vault_restored: ['Vault restored', '凭据库已恢复'],
      statusUnknown: ['Status is unavailable. An existing authorization may still be active.', '暂时无法确认状态。已有授权可能仍然有效。'],
      note: ['Share an authorization ID only with the chosen conversation. Detached remote processes may continue after disconnect.', '仅将授权 ID 提供给选中的会话。连接断开后，脱离会话的远端进程可能继续运行。'],
      invalid_device: ['Check the device and confirm its fingerprint.', '请检查设备信息并确认指纹。'],
      invalid_credential: ['Enter a valid credential. An endpoint change requires a new credential.', '请输入有效凭据。变更连接信息时需要重新录入凭据。'],
      vault_locked: ['The vault is locked.', '凭据库已上锁。'], vault_exists: ['Vault already exists.', '凭据库已存在。'], vault_uninitialized: ['Create the vault first.', '请先创建凭据库。'],
      vault_invalid: ['Vault unavailable. Check the passphrase or recover from a backup.', '无法打开凭据库。请核对口令，或从备份恢复。'],
      vault_conflict: ['The vault is in use, or the restore target is not empty.', '凭据库正在使用，或恢复目标非空。'], vault_io: ['Could not access the vault.', '无法访问凭据库。'],
      invalid_passphrase: ['Use a passphrase of 12 to 1024 bytes.', '口令长度须为 12 至 1024 字节。'], backup_invalid: ['Check the backup file and its passphrase.', '请检查备份文件及其口令。'],
      legacy_invalid: ['No matching legacy credential was found.', '找不到匹配的旧凭据。'], cleanup_failed: ['Legacy cleanup is pending. Check the old record and retry.', '旧记录待清理，请核对后重试。'],
      stale_device: ['Device changed. Refresh the form and retry.', '设备已变更，请刷新表单后重试。'], not_ready: ['Select a live conversation and a verified device.', '请选择活跃会话和已核验设备。'],
      busy: ['Another operation is active.', '另一操作正在进行。'], device_limit: ['The device limit is 16.', '最多保存 16 台设备。'], vault_limit: ['The vault reached its size limit.', '凭据库已达到大小上限。'],
      invalid_grant: ['Refresh authorization status and retry.', '请刷新授权状态后重试。'], unavailable: ['The action could not be confirmed. Refresh to check the result.', '未能确认操作结果，请刷新后检查。'],
    }
    const translations = (index) => Object.fromEntries(Object.entries(labels).map(([key, names]) => [key, names[index]]))
    const grid = { display: 'grid', gap: '0.65rem', maxWidth: '44rem' }
    const control = { color: 'var(--dsw-alias-label-primary, CanvasText)', backgroundColor: 'var(--dsw-alias-bg-base, Canvas)', borderColor: 'var(--dsw-alias-border-l2, GrayText)' }
    const input = (name, props = {}) => h('input', { name, autoComplete: 'off', ...(props.type === 'checkbox' ? {} : { style: control }), ...props })
    const selectField = (props, ...children) => h('select', { style: control, ...props }, ...children)
    const field = (label, control) => h('label', { style: grid }, label, control)
    const check = (name, label) => h('label', null, input(name, { required: true, type: 'checkbox' }), ' ', label)
    const button = (label, props) => h('button', { type: 'button', ...props }, label)
    const submit = (label, disabled) => button(label, { type: 'submit', disabled })
    const secret = (name, maxLength = 1024, required = true) => input(name, { type: 'password', required, maxLength, autoComplete: 'new-password' })
    const choose = (id, label) => h('option', { key: id, value: id }, label)
    const describe = (device) => `${device.username}@${device.host}:${device.port}`

    async function call(body, signal) {
      const response = await fetch('api/dsh-ssh-broker', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      })
      const data = await response.json()
      if (!response.ok) throw Error(Object.hasOwn(labels, data.error) ? data.error : 'unavailable')
      return data
    }

    function download(archive) {
      const url = URL.createObjectURL(new Blob([archive], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'dsh-ssh-vault-backup.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }

    function Panel({ t, useSessions }) {
      const byId = useSessions?.((state) => state.byId)
      const sessionLabel = (id) => byId?.[id]?.displayTitle && byId[id].displayTitle !== id ? `${byId[id].displayTitle} · ${id.slice(-8)}` : id
      const [view, setView] = useState(null)
      const [unknown, setUnknown] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [selected, select] = useState('')
      const [kind, setKind] = useState('password')
      const [grantMode, setGrantMode] = useState('shellOnly')
      const lifetime = useRef(null)
      const pending = useRef(false)
      const version = useRef(0)
      async function refresh(signal = lifetime.current?.signal) {
        if (!signal || signal.aborted) return
        const sequence = ++version.current
        try {
          const next = await call({ action: 'status' }, signal)
          if (!signal.aborted && sequence === version.current) { setView(next); setUnknown(false) }
        } catch {
          if (!signal.aborted && sequence === version.current) setUnknown(true)
        }
      }
      useEffect(() => {
        const controller = new AbortController()
        lifetime.current = controller
        void refresh(controller.signal)
        const timer = setInterval(() => { if (!pending.current) void refresh(controller.signal) }, 1000)
        return () => { clearInterval(timer); controller.abort() }
      }, [])
      async function mutate(body, onSuccess) {
        const signal = lifetime.current?.signal
        if (pending.current || !signal || signal.aborted) return
        pending.current = true
        ++version.current
        setBusy(true)
        setError('')
        try {
          const output = await call(typeof body === 'function' ? await body() : body, signal)
          if (!signal.aborted) onSuccess?.(output)
        } catch (cause) {
          if (!signal.aborted) setError(Object.hasOwn(labels, cause.message) ? cause.message : 'unavailable')
        } finally {
          await refresh(signal)
          pending.current = false
          if (!signal.aborted) setBusy(false)
        }
      }
      const submitForm = (listener) => (event) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        for (const name of ['passphrase', 'keyPassphrase', 'value', 'archive']) {
          const node = form.elements.namedItem(name)
          if (node) node.value = ''
        }
        for (const node of form.querySelectorAll('input[type="checkbox"]')) node.checked = false
        listener(data)
      }
      const disabled = busy || unknown || !view || view.busy
      const unlocked = view?.vault === 'unlocked'
      const devices = view?.devices ?? []
      const editing = devices.find(({ id }) => id === selected)
      const changeDevice = (id) => { select(id); setKind(id ? 'keep' : 'password') }
      const actionForm = (action, passLabel, onSuccess) => h('form', { key: action, style: grid, onSubmit: submitForm((data) => void mutate({ action, passphrase: data.get('passphrase') }, onSuccess)) },
        field(t(passLabel), secret('passphrase')), submit(t(action), disabled))
      const actionLabel = (status) => Object.hasOwn(labels, status) ? t(status) : status
      return h('div', { style: grid },
        h('p', null, t('note')),
        button(t('refresh'), { disabled: busy, onClick: () => void refresh() }),
        error && h('p', { role: 'alert' }, t(error)),
        unknown && h('p', { role: 'status' }, t('statusUnknown')),
        !unknown && view && h('p', { role: 'status' }, t(view.vault)),
        view?.vault === 'uninitialized' && h('small', null, t('vaultHelp')),
        view?.vault === 'uninitialized' && actionForm('initialize', 'passphrase'),
        view?.vault === 'locked' && actionForm('unlock', 'passphrase'),
        unlocked && button(t('lock'), { disabled: busy, onClick: () => void mutate({ action: 'lock' }) }),
        unlocked && h('section', { style: grid },
          view.legacy && h('form', { style: grid, onSubmit: submitForm((data) => void mutate({ action: view.cleanupPending ? 'cleanup' : 'migrate', confirm: data.has('confirmLegacy') })) },
            h('div', null, `${t('legacy')} · ${describe(view.legacy)}`), check('confirmLegacy', t('confirmLegacy')),
            submit(t(view.cleanupPending ? 'cleanup' : 'migrate'), disabled || (!view.legacy.credentialConfigured && !view.cleanupPending))),
          field(t('select'), selectField({ value: editing?.id ?? '', onChange: (event) => changeDevice(event.target.value), disabled },
            choose('', t('add')), ...devices.map((device) => choose(device.id, `${device.label} · ${describe(device)}`)))),
          editing && !editing.verified && h('p', { role: 'status' }, t('unverified')),
          h('form', { key: editing ? JSON.stringify(editing) : 'new', style: grid, onSubmit: submitForm((data) => {
            const selectedKind = editing ? kind : kind === 'keep' ? 'password' : kind
            void mutate({ action: 'configure', id: editing?.id, revision: editing?.revision, label: data.get('label').trim(),
              host: data.get('host').trim(), port: Number(data.get('port')), username: data.get('username').trim(),
              fingerprint: data.get('fingerprint').trim(), confirmFingerprint: data.has('pin'),
              credential: selectedKind === 'keep' ? undefined : { kind: selectedKind, value: data.get('value'), passphrase: selectedKind === 'key' ? data.get('keyPassphrase') : undefined },
            }, () => { if (!editing) changeDevice('') })
          }) },
          field(t('name'), input('label', { required: true, maxLength: 64, defaultValue: editing?.label })),
          field(t('host'), input('host', { required: true, maxLength: 253, defaultValue: editing?.host })),
          field(t('port'), input('port', { required: true, type: 'number', min: 1, max: 65535, defaultValue: editing?.port ?? 22 })),
          field(t('user'), input('username', { required: true, maxLength: 64, defaultValue: editing?.username })),
          field(t('fingerprint'), input('fingerprint', { required: true, maxLength: 50, defaultValue: editing?.fingerprint, spellCheck: false })),
          check('pin', t('pin')),
          field(t('credential'), selectField({ value: kind === 'keep' && !editing ? 'password' : kind, onChange: (event) => setKind(event.target.value) },
            editing && choose('keep', t('keep')), choose('password', t('password')), choose('key', t('key')))),
          (kind === 'password' || (!editing && kind === 'keep')) && field(t('password'), secret('value', 4096)),
          kind === 'key' && field(t('key'), h('textarea', { name: 'value', required: true, maxLength: 32768, rows: 4, spellCheck: false, autoComplete: 'off' })),
          kind === 'key' && field(t('keyPassphrase'), secret('keyPassphrase', 4096, false)),
          submit(t('save'), disabled)),
          editing && h('form', { key: editing.id, style: grid, onSubmit: submitForm((data) => void mutate({ action: 'delete', id: editing.id, revision: editing.revision, confirm: data.has('delete') }, () => changeDevice(''))) },
            check('delete', t('checkDelete')), submit(t('delete'), disabled)),
          h('form', { style: grid, onSubmit: submitForm((data) => void mutate({
            action: 'grant', deviceId: data.get('device'), agentId: data.get('agent'), ttlSeconds: Number(data.get('ttl')),
            shell: grantMode !== 'transferOnly', transferDirectory: grantMode === 'shellOnly' ? undefined : data.get('transferDirectory'),
            confirm: data.has('grant'),
          }, () => setGrantMode('shellOnly'))) },
            field(t('select'), selectField({ name: 'device', required: true, onChange: () => setGrantMode('shellOnly') }, choose('', t('select')), ...devices.filter((device) => device.verified).map((device) => choose(device.id, `${device.label} · ${describe(device)} · ${device.id.slice(-8)}`)))),
            field(t('session'), selectField({ name: 'agent', required: true, onChange: () => setGrantMode('shellOnly') }, choose('', t('choose')), ...(view.sessions ?? []).map((id) => choose(id, sessionLabel(id))))),
            field(t('grantMode'), selectField({ name: 'grantMode', value: grantMode, onChange: (event) => setGrantMode(event.target.value) },
              ...['shellOnly', 'transferOnly', 'shellAndTransfer'].map((mode) => choose(mode, t(mode))))),
            grantMode !== 'shellOnly' && field(t('transferDirectory'), input('transferDirectory', { required: true, maxLength: 1024, spellCheck: false, 'aria-describedby': 'ssh-broker-transfer-help' })),
            grantMode !== 'shellOnly' && h('small', { id: 'ssh-broker-transfer-help' }, t('transferHelp')),
            field(t('ttl'), input('ttl', { type: 'number', min: 1, max: 900, required: true, defaultValue: 300 })),
            check('grant', t('confirmGrant')), submit(t('grant'), disabled || !devices.some(({ verified }) => verified) || !view.sessions.length)),
          h('details', null, h('summary', null, t('backup')),
            actionForm('backup', 'backupPassphrase', ({ archive }) => download(archive)),
            !devices.length && h('form', { style: grid, onSubmit: submitForm((data) => void mutate(async () => {
              const file = data.get('archive')
              if (!file?.size || file.size > 1536 * 1024) throw Error('backup_invalid')
              return { action: 'restore', archive: await file.text(), passphrase: data.get('passphrase'), confirm: data.has('restore') }
            })) }, field(t('archive'), input('archive', { type: 'file', accept: '.json,application/json', required: true })),
            field(t('backupPassphrase'), secret('passphrase')), check('restore', t('confirmRestore')), submit(t('restore'), disabled))),
        ),
        Boolean(view?.grants.length) && h('section', null, h('strong', null, t('access')),
          h('ul', null, ...view.grants.map((grant) => h('li', { key: grant.id, style: { overflowWrap: 'anywhere' } },
            !unknown && `${grant.deviceLabel} · ${sessionLabel(grant.agentId)} · ${actionLabel(grant.status)}`,
            !unknown && h('div', null, t(grant.transferDirectory ? (grant.shell ? 'shellAndTransfer' : 'transferOnly') : 'shellOnly'), grant.transferDirectory && h('code', null, ` · ${grant.transferDirectory}`)),
            !unknown && grant.status === 'active' && h('div', null, h('code', null, grant.id), ` · ${Math.ceil(grant.remainingMs / 1000)} s`),
            grant.status === 'active' && button(t('revoke'), { onClick: () => void mutate({ action: 'revoke', id: grant.id }), disabled: busy }))))),
        Boolean(view?.audit.length) && h('details', null, h('summary', null, t('audit')),
          h('ul', null, ...view.audit.map((row, i) => h('li', { key: `${row.time}-${i}` },
            `${new Date(row.time).toLocaleTimeString()} · ${actionLabel(row.status)}${row.deviceId ? ` · ${row.deviceId.slice(-8)}` : ''}${row.elapsedMs === undefined ? '' : ` · ${row.elapsedMs} ms`}`)))),
      )
    }
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(ns, { en: translations(0), zh: translations(1) }))
        const t = ctx.locale.bind(ns)
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ssh-broker', label: t('title'), order: 95 }, ({ useSessions }) => h(Panel, { t, useSessions })))
      },
    }
  },
})
