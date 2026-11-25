window.__ModuleLoader__.load({
  id: '@local/dsh-ssh-broker',
  factory(require) {
    const { createElement: h, Fragment: ReactFragment, useEffect, useRef, useState } = require('react')
    const ns = 'ssh-broker-settings'
    const labels = {
      title: ['SSH devices', 'SSH 设备'], uninitialized: ['Vault not initialized', '凭据库未初始化'], locked: ['Vault locked', '凭据库已上锁'], unlocked: ['Vault unlocked', '凭据库已解锁'],
      initialize: ['Create vault', '创建凭据库'], unlock: ['Unlock', '解锁'], lock: ['Lock and revoke access', '上锁并撤销授权'],
      passphrase: ['Vault passphrase', '凭据库口令'], backupPassphrase: ['Backup passphrase', '备份口令'],
      vaultHelp: ['Use a strong passphrase (at least 12 bytes). Keep it separately from the encrypted backup.', '使用至少 12 字节的强口令，并和加密备份分开保存。'],
      backup: ['Download encrypted backup', '下载加密备份'], restore: ['Restore encrypted backup', '恢复加密备份'], archive: ['Encrypted backup file', '加密备份文件'],
      confirmRestore: ['Restore into the empty vault and verify each host key again before granting access.', '恢复到空库，并在授权前重新核验每台设备的 Host Key。'],
      vault: ['Credential vault', '凭据库'], loading: ['Checking vault status…', '正在读取凭据库状态…'],
      vaultDescription: ['SSH credentials are encrypted and stored locally in this profile.', 'SSH 凭据加密保存在当前配置的本机凭据库中。'],
      devices: ['Devices', '设备'], emptyDevices: ['Add a device to start granting access to a conversation.', '添加设备后，即可为会话授予连接权限。'],
      verifyHost: ['Verify host key', '核验主机指纹'],
      lastKnown: ['Last known active', '上次确认时生效'],
      edit: ['Edit', '编辑'], cancel: ['Cancel', '取消'], editDevice: ['Edit device', '编辑设备'],
      hostKey: ['Host identity', '主机身份'], hostKeyHelp: ['Run this command on the target server using a trusted console, such as your cloud console.', '请在目标服务器的可信控制台执行下面的命令，例如云厂商提供的控制台。'],
      hostKeyPaste: ['Paste the part starting with SHA256:. If the SSH server uses another host key, use its .pub file in the command.', '把输出中以 SHA256: 开头的那一段填到上方。如果 SSH 服务使用另一把主机密钥，请将命令中的路径换成对应的公钥文件。'],
      copyCommand: ['Copy command', '复制命令'], copiedCommand: ['Command copied', '命令已复制'],
      copyCommandFailed: ['Clipboard unavailable. Select the command and copy it manually.', '无法写入剪贴板，请选中命令手动复制。'],
      backupTools: ['Backup and restore', '备份与恢复'], restoreUnavailable: ['Restoring a backup requires an empty, unlocked vault.', '恢复备份需要一个已解锁的空凭据库。'],
      newGrant: ['Grant access to a conversation', '为会话授权'], noVerifiedDevices: ['Add a device and verify its host key to grant access.', '请先添加设备并核验主机指纹。'],
      noSessions: ['Open a conversation before granting access.', '请先打开一个会话，再授予权限。'],
      add: ['Add device', '添加设备'], select: ['Select device', '选择设备'], name: ['Device name', '设备名称'],
      host: ['Host', '主机'], port: ['Port', '端口'], user: ['SSH user', 'SSH 用户'], fingerprint: ['Host Key SHA256 fingerprint', 'Host Key SHA256 指纹'],
      pin: ['I checked this fingerprint through a trusted channel.', '我已通过可信渠道核对该指纹。'],
      keep: ['Keep current credential', '保留现有凭据'], password: ['SSH password', 'SSH 密码'], key: ['OpenSSH private key', 'OpenSSH 私钥'], keyPassphrase: ['Private key passphrase', '私钥口令'],
      credential: ['Credential', '凭据'], save: ['Save device', '保存设备'], delete: ['Delete device', '删除设备'], checkDelete: ['Delete this device and its stored credential.', '删除此设备及其已保存的凭据。'],
      unverified: ['Verify the restored host key before granting access.', '授权前请核验恢复设备的 Host Key。'],
      migrate: ['Migrate legacy device', '迁移旧设备'], cleanup: ['Retry legacy cleanup', '重试清理旧记录'], legacy: ['Legacy device', '旧版设备'],
      confirmLegacy: ['Move the matching credential into the vault and remove the old local record.', '将匹配的凭据迁入加密库，并移除本地旧记录。'],
      session: ['Harness conversation', 'Harness 会话'], choose: ['Select conversation', '选择会话'], ttl: ['Duration (seconds)', '有效期（秒）'],
      duration: ['Authorization duration', '授权时限'], timed: ['For a fixed time', '限时有效'], sessionDuration: ['For this conversation', '本次会话有效'],
      reviewSessionGrant: ['Review authorization', '核对会话授权'], confirmSessionGrant: ['Confirm conversation access', '确认会话授权'],
      sessionGrantHelp: ['The vault stays unlocked while any authorization set to “For this conversation” is active. Closing the browser tab can leave access active.', '只要还有「本次会话有效」的授权生效，凭据库就会暂停空闲上锁。关闭浏览器标签页后，授权可能仍然有效。'],
      sessionGrantEnd: ['Ending the conversation, restarting Harness, revoking access, or locking the vault ends this authorization.', '会话关闭、Harness 退出或重启、手动撤销或锁定凭据库都会使授权失效。'],
      sessionGrantChanged: ['The device or conversation changed. Go back and review your selection.', '设备或会话已变更，请返回重新核对。'],
      back: ['Back to edit', '返回修改'],
      confirmGrant: ['Grant the selected access to this conversation and device.', '将所选权限授予此会话，仅限所选设备。'],
      vaultIdlePaused: ['A “For this conversation” authorization is active. Idle locking is paused.', '有「本次会话有效」的授权生效，凭据库已暂停空闲上锁。'],
      grantMode: ['Allowed operations', '允许的操作'], shellOnly: ['Shell only (file transfer off)', '仅 Shell（文件传输关闭）'],
      transferOnly: ['File transfer only', '仅文件传输'], shellAndTransfer: ['Shell and file transfer', 'Shell 和文件传输'],
      transferDirectory: ['Remote directory', '远端目录'],
      transferHelp: ['Use an absolute directory without symlinks, such as /home/ssh-user/inbox. Each file can be up to 8 MiB.', '请输入无符号链接的绝对目录，例如 /home/ssh-user/inbox。每个文件最多 8 MiB。'],
      includeSubdirectories: ['Include subdirectories', '包含子目录'],
      transferScope: ['Directory scope', '目录范围'],
      directChildren: ['Top level only', '仅直属文件'],
      previewDirectory: ['Preview directory', '预览目录'], closePreview: ['Close preview', '关闭预览'],
      directoryLoading: ['Reading the remote directory…', '正在读取远端目录…'],
      directoryLoaded: ['Entries loaded: {count}.', '已读取 {count} 项。'],
      directoryEmpty: ['No files or subdirectories available to display.', '没有可显示的文件或子目录。'],
      directoryTruncated: ['This listing is incomplete because the directory has too many entries.', '目录条目较多，此处仅显示部分结果。'],
      directoryFailed: ['Could not list the remote directory.', '无法读取远端目录。'],
      not_authorized: ['This conversation no longer has file transfer access.', '此会话当前没有文件传输权限。'],
      remote_directory_changed: ['The remote directory is unavailable or its path has changed.', '远端目录不可用或路径已变更。'],
      host_key_mismatch: ['The SSH host key no longer matches the saved fingerprint.', 'SSH 主机密钥与已保存的指纹不匹配。'],
      timed_out: ['The remote operation timed out.', '远端操作超时。'],
      approval_timed_out: ['The approval request timed out.', '等待审批超时。'],
      upload_commit_failed: ['The server refused to publish the file.', '远端拒绝发布文件。'],
      upload_commit_unknown: ['Upload result unknown. Check the remote file before retrying.', '无法确认上传结果，重试前请先核对远端文件。'],
      uploaded_cleanup_pending: ['File published; temporary file cleanup was not confirmed.', '文件已发布，临时文件清理结果未确认。'],
      invalid_transfer_directory: ['Enter an absolute directory other than /. Omit the trailing slash and dot segments.', '请输入非根目录的绝对路径，去掉末尾斜杠和 .、.. 路径段。'],
      grant: ['Grant access', '授予权限'], revoke: ['Revoke access', '撤销权限'], access: ['Authorizations', '会话授权'], audit: ['Recent activity', '近期活动'], refresh: ['Refresh', '刷新'],
      active: ['Active', '生效中'], revoked: ['Revoked', '已撤销'], expired: ['Expired', '已到期'], session_closed: ['Conversation closed', '会话已关闭'],
      device_changed: ['Device changed', '设备已变更'], credential_changed: ['Credential changed', '凭据已变更'], unloaded: ['Plugin unloaded', '插件已卸载'],
      listed: ['Directory listed', '已读取目录'],
      granted: ['Access granted', '已授予权限'], device_saved: ['Device saved', '设备已保存'], device_deleted: ['Device deleted', '设备已删除'],
      device_migrated: ['Device migrated', '设备已迁移'], legacy_cleaned: ['Old credential removed', '旧凭据已清理'], vault_restored: ['Vault restored', '凭据库已恢复'],
      statusUnknown: ['Status is unavailable. An existing authorization may still be active.', '暂时无法确认状态。已有授权可能仍然有效。'],
      composerTarget: ['SSH device', 'SSH 设备'],
      composerChoose: ['Choose a device', '请选择设备'],
      composerNoAccess: ['Grant this conversation access in Settings → SSH devices.', '请在「设置 → SSH 设备」为当前会话授权。'],
      composerExpired: ['Selected authorization is unavailable', '所选设备的授权已失效'],
      composerReauthorize: ['The selected authorization expired. Grant access again in Settings → SSH devices.', '所选设备的授权已失效，请在「设置 → SSH 设备」重新授权。'],
      composerLoading: ['Checking SSH authorizations…', '正在检查 SSH 授权…'],
      composerUnavailable: ['Could not check SSH authorizations.', '暂时无法读取 SSH 授权。'],
      composerDraftChanged: ['The draft changed. Select a device again.', '草稿已变更，请重新选择设备。'],
      composerAutomatic: ['Use the only authorized device at send time', '发送时自动使用唯一获授权的设备'],
      note: ['Use /ssh-broker to attach an authorization automatically. Detached remote processes may continue after disconnect.', '使用 /ssh-broker 自动附带授权。连接断开后，脱离会话的远端进程可能继续运行。'],
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
    const styles = `
      .dsw-ssh-panel {
        display: grid; gap: 18px; max-width: 44rem; min-width: 0; container-type: inline-size;
        color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 1.5;
      }
      .dsw-ssh-panel :is(h2, h3, p, ul) { margin: 0; }
      .dsw-ssh-panel h2 { font-size: 15px; font-weight: 600; }
      .dsw-ssh-panel h3 { font-size: 14px; font-weight: 600; }
      .dsw-ssh-panel :is(.ssh-head, .ssh-row) {
        display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px;
      }
      .dsw-ssh-panel :is(.ssh-stack, .ssh-list, .ssh-field, .ssh-grid) { display: grid; min-width: 0; gap: 12px; }
      .dsw-ssh-panel .ssh-stack[hidden] { display: none; }
      .dsw-ssh-panel .ssh-list { list-style: none; padding: 0; gap: 8px; }
      .dsw-ssh-panel .ssh-group { display: grid; gap: 8px; min-width: 0; }
      .dsw-ssh-panel .ssh-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; padding: 14px; min-width: 0; }
      .dsw-ssh-panel .ssh-inset { border-radius: 11px; background: var(--dsw-alias-bg-layer-1); padding: 14px; }
      .dsw-ssh-panel .ssh-divider { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 12px; }
      .dsw-ssh-panel :is(.ssh-muted, .ssh-field) { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow-wrap: anywhere; }
      .dsw-ssh-panel .ssh-copy { min-width: 0; overflow-wrap: anywhere; }
      .dsw-ssh-panel .ssh-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
      .dsw-ssh-panel .ssh-field { gap: 5px; }
      .dsw-ssh-panel .ssh-control {
        box-sizing: border-box; width: 100%; min-width: 0; min-height: 36px; padding: 7px 10px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 9px;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px;
      }
      .dsw-ssh-panel textarea.ssh-control { resize: vertical; }
      .dsw-ssh-panel .ssh-mono { font-family: ui-monospace, monospace; }
      .dsw-ssh-panel .ssh-command {
        display: block; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
        background: var(--dsw-alias-bg-base); overflow-wrap: anywhere; user-select: text;
      }
      .dsw-ssh-panel .ssh-confirm-details { display: grid; gap: 6px; margin: 0; }
      .dsw-ssh-panel .ssh-confirm-details dt { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dsw-ssh-panel .ssh-confirm-details dd { margin: 0; overflow-wrap: anywhere; }
      .dsw-ssh-panel .ssh-confirm-heading:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsw-ssh-panel .ssh-action {
        display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 5px 11px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent;
        font: inherit; font-size: 13px; color: var(--dsw-alias-label-primary); cursor: pointer; text-align: center;
      }
      .dsw-ssh-panel .ssh-action:hover:enabled { background: var(--dsw-alias-bg-layer-2); }
      .dsw-ssh-panel .ssh-primary { background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); }
      .dsw-ssh-panel .ssh-primary:hover:enabled { background: var(--dsw-alias-label-secondary); }
      .dsw-ssh-panel :disabled { opacity: .55; cursor: not-allowed; }
      .dsw-ssh-panel :is(.ssh-action, .ssh-control, summary, input[type=checkbox]):focus-visible {
        outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px;
      }
      .dsw-ssh-panel .ssh-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
      .dsw-ssh-panel .ssh-check { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; }
      .dsw-ssh-panel .ssh-check input { width: 16px; height: 16px; margin: 2px 0 0; flex: none; accent-color: var(--dsw-alias-brand-primary); }
      .dsw-ssh-panel :is(.ssh-danger, .ssh-error) { color: var(--dsw-alias-state-error-primary); }
      .dsw-ssh-panel .ssh-success { color: var(--dsw-alias-state-success-primary); }
      .dsw-ssh-panel .ssh-warn { color: var(--dsw-alias-state-warn-primary); }
      .dsw-ssh-panel .ssh-state { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .dsw-ssh-panel .ssh-state::before { content: ''; width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
      .dsw-ssh-panel .ssh-state[data-state='active']::before { background: var(--dsw-alias-state-success-primary); }
      .dsw-ssh-panel summary { cursor: pointer; font-weight: 600; }
      .dsw-ssh-panel details[open] > summary { margin-bottom: 12px; }
      @container (min-width: 420px) {
        .dsw-ssh-panel .ssh-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .dsw-ssh-panel .ssh-endpoint { grid-template-columns: minmax(0, 2fr) minmax(0, .8fr) minmax(0, 1.4fr); }
      }
      .dsw-ssh-composer {
        display: flex; flex-wrap: wrap; align-items: center; gap: 7px 10px;
        padding: 6px 10px; font-size: 12px; color: var(--dsw-alias-label-secondary);
      }
      .dsw-ssh-composer label { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
      .dsw-ssh-composer select {
        max-width: 100%; min-width: 0; padding: 4px 8px; border-radius: 7px;
        color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base);
        border: 1px solid var(--dsw-alias-border-l2); font: inherit;
      }
      .dsw-ssh-composer select:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .dsw-ssh-composer select:disabled { opacity: .55; }
      .dsw-ssh-composer .ssh-muted { margin: 0; }
    `
    const input = (name, props = {}) => h('input', { name, autoComplete: 'off', className: props.type === 'checkbox' ? undefined : 'ssh-control', ...props })
    const selectField = (props, ...children) => h('select', { className: 'ssh-control', ...props }, ...children)
    const field = (label, control) => h('label', { className: 'ssh-field' }, h('span', null, label), control)
    const check = (name, label, required = true) => h('label', { className: 'ssh-check' }, input(name, { required, type: 'checkbox' }), h('span', null, label))
    const button = (label, { variant, ...props } = {}) => h('button', { type: 'button', className: `ssh-action${variant ? ` ssh-${variant}` : ''}`, ...props }, label)
    const submit = (label, disabled, variant = 'primary') => button(label, { type: 'submit', disabled, variant })
    const actions = (...children) => h('div', { className: 'ssh-actions' }, ...children)
    const muted = (text, props) => h('p', { className: 'ssh-muted', ...props }, text)
    const badge = (text, active) => h('span', { className: 'ssh-state', 'data-state': active ? 'active' : undefined }, text)
    const secret = (name, maxLength = 1024, required = true) => input(name, { type: 'password', required, maxLength, autoComplete: 'new-password' })
    const choose = (id, label) => h('option', { key: id, value: id }, label)
    const describe = (device) => `${device.username}@${device.host}:${device.port}`

    async function call(body, signal, timeoutMs = 10_000) {
      const response = await fetch('api/dsh-ssh-broker', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
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

    const actionArea = { configure: 'editor', delete: 'editor', migrate: 'legacy', cleanup: 'legacy', grant: 'access', revoke: 'access', backup: 'backup' }
    const successLabels = {
      configure: 'device_saved', delete: 'device_deleted', migrate: 'device_migrated', cleanup: 'legacy_cleaned',
      grant: 'granted', revoke: 'revoked', restore: 'vault_restored',
    }

    const hostKeyCommand = 'ssh-keygen -E sha256 -lf /etc/ssh/ssh_host_ed25519_key.pub'

    function DeviceEditor({ t, editing, disabled, submitForm, mutate, closeEditor, focusOnOpen, result }) {
      const [kind, setKind] = useState(editing ? 'keep' : 'password')
      const [copyStatus, setCopyStatus] = useState(null)
      async function copyCommand() {
        try {
          await navigator.clipboard.writeText(hostKeyCommand)
          setCopyStatus('copiedCommand')
        } catch {
          setCopyStatus('copyCommandFailed')
        }
      }
      const { id, revision } = editing ?? {}
      return h('div', { className: 'ssh-stack ssh-inset' },
        h('h3', null, t(editing ? 'editDevice' : 'add')), result,
        h('form', { className: 'ssh-stack', onSubmit: submitForm((data) => void mutate({
          action: 'configure', id, revision, label: data.get('label').trim(), host: data.get('host').trim(),
          port: Number(data.get('port')), username: data.get('username').trim(), fingerprint: data.get('fingerprint').trim(),
          confirmFingerprint: data.has('pin'),
          credential: kind === 'keep' ? undefined : { kind, value: data.get('value'), passphrase: kind === 'key' ? data.get('keyPassphrase') : undefined },
        }, closeEditor)) },
        field(t('name'), input('label', { required: true, maxLength: 64, defaultValue: editing?.label, ref: editing?.verified !== false ? focusOnOpen : undefined })),
        h('div', { className: 'ssh-grid ssh-endpoint' },
          field(t('host'), input('host', { required: true, maxLength: 253, defaultValue: editing?.host })),
          field(t('port'), input('port', { required: true, type: 'number', min: 1, max: 65535, defaultValue: editing?.port ?? 22 })),
          field(t('user'), input('username', { required: true, maxLength: 64, defaultValue: editing?.username }))),
        h('div', { className: 'ssh-group ssh-divider' },
          h('h3', null, t('hostKey')),
          field(t('fingerprint'), input('fingerprint', {
            className: 'ssh-control ssh-mono', required: true, maxLength: 50, defaultValue: editing?.fingerprint,
            ref: editing?.verified === false ? focusOnOpen : undefined, placeholder: 'SHA256:…', spellCheck: false, 'aria-describedby': 'ssh-broker-host-key-help ssh-broker-host-key-paste',
          })),
          muted(t('hostKeyHelp'), { id: 'ssh-broker-host-key-help' }),
          h('div', { className: 'ssh-row' },
            h('code', { className: 'ssh-mono ssh-command' }, hostKeyCommand),
            button(t('copyCommand'), { onClick: () => void copyCommand() })),
          copyStatus && muted(t(copyStatus), { role: 'status' }),
          muted(t('hostKeyPaste'), { id: 'ssh-broker-host-key-paste' }),
          check('pin', t('pin'))),
        h('div', { className: 'ssh-group ssh-divider' },
          field(t('credential'), selectField({ value: kind, onChange: (event) => setKind(event.target.value) },
            editing && choose('keep', t('keep')), choose('password', t('password')), choose('key', t('key')))),
          kind === 'password' && field(t('password'), secret('value', 4096)),
          kind === 'key' && field(t('key'), h('textarea', {
            className: 'ssh-control ssh-mono', name: 'value', required: true, maxLength: 32768, rows: 4, spellCheck: false, autoComplete: 'off',
          })),
          kind === 'key' && field(t('keyPassphrase'), secret('keyPassphrase', 4096, false))),
        actions(button(t('cancel'), { onClick: closeEditor, disabled }), submit(t('save'), disabled))),
        editing && h('form', { className: 'ssh-stack ssh-divider', onSubmit: submitForm((data) => void mutate({
          action: 'delete', id, revision, confirm: data.has('delete'),
        }, closeEditor)) }, check('delete', t('checkDelete')), actions(submit(t('delete'), disabled, 'danger'))))
    }

    function DirectoryPreview({ t, grant, disabled }) {
      const [preview, setPreview] = useState(null)
      const request = useRef(null)
      useEffect(() => () => request.current?.abort(), [])

      async function toggle() {
        if (preview) {
          request.current?.abort()
          setPreview(null)
          return
        }
        const controller = new AbortController()
        request.current = controller
        setPreview({ status: 'directoryLoading' })
        try {
          const output = await call({ action: 'previewDirectory', id: grant.id }, controller.signal, 15_000)
          if (!controller.signal.aborted) setPreview(output)
        } catch (cause) {
          if (!controller.signal.aborted) {
            const status = cause.name === 'TimeoutError' ? 'timed_out' : cause.message
            setPreview({ status: Object.hasOwn(labels, status) ? status : 'directoryFailed' })
          }
        } finally {
          if (request.current === controller) request.current = null
        }
      }

      const panelId = `ssh-preview-${grant.id}`
      const label = t(preview ? 'closePreview' : 'previewDirectory')
      const listed = preview?.status === 'listed'
      const loading = preview?.status === 'directoryLoading'
      let announcement = ''
      if (loading) announcement = t('directoryLoading')
      if (listed) {
        announcement = preview.entries.length ? t('directoryLoaded').replace('{count}', preview.entries.length) : t('directoryEmpty')
        if (preview.truncated) announcement += ` ${t('directoryTruncated')}`
      }
      return h('div', { className: 'ssh-group' },
        h('div', null, button(label, {
          'aria-label': `${label} · ${grant.deviceLabel}`, 'aria-expanded': Boolean(preview),
          'aria-controls': preview ? panelId : undefined, disabled: !preview && (disabled || grant.busy),
          onClick: () => void toggle(),
        }), h('span', { className: 'ssh-sr-only', role: 'status' }, announcement)),
        preview && h('div', { id: panelId, className: 'ssh-inset ssh-group ssh-copy' },
          loading ? muted(t('directoryLoading')) :
            !listed ? h('p', { className: 'ssh-error', role: 'alert' }, t(Object.hasOwn(labels, preview.status) ? preview.status : 'directoryFailed')) :
              h(ReactFragment, null,
                preview.entries.length ? h('ul', { className: 'ssh-list ssh-mono', 'aria-label': t('previewDirectory') },
                  preview.entries.map(({ name, type }) => h('li', { key: name }, h('bdi', null, type === 'directory' ? `${name}/` : name)))) :
                  muted(t('directoryEmpty')),
                preview.truncated && muted(t('directoryTruncated')))))
    }

    function Panel({ t, useSessions }) {
      const byId = useSessions?.((state) => state.byId)
      const sessionLabel = (id) => byId?.[id]?.displayTitle && byId[id].displayTitle !== id ? `${byId[id].displayTitle} · ${id.slice(-8)}` : id
      const [view, setView] = useState(null)
      const [unknown, setUnknown] = useState(false)
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [editor, setEditor] = useState(null)
      const editorTrigger = useRef(null)
      const editorInput = useRef(null)
      const addDeviceButton = useRef(null)
      const restoreFocus = useRef(false)
      const [grantMode, setGrantMode] = useState('shellOnly')
      const [duration, setDuration] = useState('timed')
      const [grantReview, setGrantReview] = useState(null)
      const grantSubmit = useRef(null)
      const reviewHeading = useRef(null)
      const returnToGrantForm = useRef(false)
      const lifetime = useRef(null)
      const pending = useRef(false)
      const statusRequest = useRef(null)
      async function refresh(signal = lifetime.current?.signal) {
        if (!signal || signal.aborted || statusRequest.current) return
        const request = new AbortController()
        statusRequest.current = request
        const statusSignal = AbortSignal.any([signal, request.signal])
        try {
          const next = await call({ action: 'status' }, statusSignal)
          if (!statusSignal.aborted) { setView(next); setUnknown(false) }
        } catch {
          if (!statusSignal.aborted) setUnknown(true)
        } finally {
          if (statusRequest.current === request) statusRequest.current = null
        }
      }
      useEffect(() => {
        const controller = new AbortController()
        lifetime.current = controller
        void refresh(controller.signal)
        const timer = setInterval(() => { if (!pending.current) void refresh(controller.signal) }, 1000)
        return () => { clearInterval(timer); controller.abort(); statusRequest.current = null }
      }, [])
      async function mutate(body, onSuccess) {
        const signal = lifetime.current?.signal
        if (pending.current || !signal || signal.aborted) return
        pending.current = true
        statusRequest.current?.abort()
        statusRequest.current = null
        setBusy(true)
        setNotice(null)
        let action
        try {
          const payload = typeof body === 'function' ? await body() : body
          action = payload.action
          const output = await call(payload, signal)
          if (!signal.aborted) {
            const label = successLabels[action]
            if (label) setNotice({ label, area: actionArea[action] === 'editor' ? 'devices' : actionArea[action] ?? 'vault' })
            onSuccess?.(output)
          }
        } catch (cause) {
          if (!signal.aborted) setNotice({
            label: Object.hasOwn(labels, cause.message) ? cause.message : 'unavailable',
            area: action === 'restore' || !action ? 'backup' : actionArea[action] ?? 'vault', error: true,
          })
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
        for (const node of form.querySelectorAll('input[type="checkbox"][required]')) node.checked = false
        listener(data)
      }
      const disabled = busy || unknown || !view || view.busy
      const unlocked = view?.vault === 'unlocked'
      const devices = view?.devices ?? []
      const sessions = view?.sessions ?? []
      const verified = devices.filter((device) => device.verified)
      const grants = view?.grants ?? []
      useEffect(() => {
        if (!unlocked) {
          setEditor(null)
          setGrantMode('shellOnly')
          setDuration('timed')
          setGrantReview(null)
          returnToGrantForm.current = false
        }
      }, [unlocked])
      const canShowGrantForm = unlocked && verified.length > 0 && sessions.length > 0
      useEffect(() => {
        if (!canShowGrantForm) setGrantReview(null)
      }, [canShowGrantForm])
      useEffect(() => {
        if (grantReview) reviewHeading.current?.focus()
      }, [grantReview])
      useEffect(() => {
        if (!grantReview && !disabled && returnToGrantForm.current) {
          returnToGrantForm.current = false
          grantSubmit.current?.focus()
        }
      }, [grantReview, disabled])
      useEffect(() => { if (editor) editorInput.current?.focus() }, [editor])
      useEffect(() => {
        if (busy || editor || !restoreFocus.current) return
        restoreFocus.current = false
        const trigger = editorTrigger.current
        const target = trigger?.isConnected && !trigger.disabled ? trigger : addDeviceButton.current
        target?.focus()
      }, [busy, editor])
      function openEditor(next, event) {
        editorTrigger.current = event.currentTarget
        if (notice?.area === 'editor' || notice?.area === 'devices') setNotice(null)
        setEditor(next)
      }
      function closeEditor() {
        setEditor(null)
        setNotice((current) => current?.area === 'editor' ? null : current)
        restoreFocus.current = true
      }
      const feedback = (area) => notice?.area === area && h('p', {
        className: notice.error ? 'ssh-error' : 'ssh-success', role: notice.error ? 'alert' : 'status',
      }, t(notice.label))
      const actionForm = (action, passLabel, onSuccess) => h('form', {
        key: action, className: 'ssh-stack',
        onSubmit: submitForm((data) => void mutate({ action, passphrase: data.get('passphrase') }, onSuccess)),
      }, field(t(passLabel), secret('passphrase')), actions(submit(t(action), disabled)))
      const actionLabel = (status) => Object.hasOwn(labels, status) ? t(status) : status
      const editForm = (editing) => h(DeviceEditor, {
        key: editing?.revision ?? 'new', t, editing, disabled, submitForm, mutate, closeEditor, focusOnOpen: editorInput, result: feedback('editor'),
      })
      const vaultCard = h('section', { className: 'ssh-card ssh-stack' },
        h('div', { className: 'ssh-head' },
          h('div', { className: 'ssh-copy' }, h('h2', null, t('vault')), muted(t('vaultDescription'))),
          button(t('refresh'), { disabled: busy, onClick: () => void refresh() })),
        h('div', { className: 'ssh-row ssh-divider' },
          h('div', { role: 'status' }, badge(t(unknown ? 'statusUnknown' : view?.vault ?? 'loading'), unlocked && !unknown)),
          unlocked && button(t('lock'), { disabled: busy, onClick: () => void mutate({ action: 'lock' }) })),
        feedback('vault'),
        unlocked && !unknown && grants.some((grant) => grant.status === 'active' && grant.duration === 'session') && muted(t('vaultIdlePaused')),
        view?.vault === 'uninitialized' && muted(t('vaultHelp')),
        view?.vault === 'uninitialized' && actionForm('initialize', 'passphrase'),
        view?.vault === 'locked' && actionForm('unlock', 'passphrase'))
      const deviceList = h('section', { className: 'ssh-stack' },
        h('div', { className: 'ssh-head' }, h('h2', null, t('devices')),
          button(t('add'), { ref: addDeviceButton, disabled, 'aria-expanded': editor?.id === '', onClick: (event) => openEditor({ id: '' }, event) })),
        feedback('devices'),
        !devices.length && !editor && muted(t('emptyDevices'), { className: 'ssh-muted ssh-card' }),
        editor?.id === '' && h('div', { className: 'ssh-card' }, editForm()),
        devices.length > 0 && h('ul', { className: 'ssh-list' }, ...devices.map((device) => h('li', {
          key: device.id, className: 'ssh-card ssh-stack',
        }, h('div', { className: 'ssh-row' },
          h('div', { className: 'ssh-copy' }, h('h3', null, device.label), muted(describe(device)),
            !device.verified && h('p', { className: 'ssh-warn' }, t('unverified'))),
          button(t(device.verified ? 'edit' : 'verifyHost'), {
            disabled, 'aria-label': `${t(device.verified ? 'edit' : 'verifyHost')} · ${device.label}`, 'aria-expanded': editor?.id === device.id,
            onClick: (event) => openEditor({ id: device.id }, event),
          })), editor?.id === device.id && editForm(device)))),
        feedback('legacy'),
        view?.legacy && h('form', {
          className: 'ssh-card ssh-stack',
          onSubmit: submitForm((data) => void mutate({ action: view.cleanupPending ? 'cleanup' : 'migrate', confirm: data.has('confirmLegacy') })),
        }, h('h3', null, t('legacy')), muted(describe(view.legacy)), check('confirmLegacy', t('confirmLegacy')),
        actions(submit(t(view.cleanupPending ? 'cleanup' : 'migrate'), disabled || (!view.legacy.credentialConfigured && !view.cleanupPending), 'secondary'))))
      function resetGrantForm() {
        setGrantMode('shellOnly')
        setDuration('timed')
        setGrantReview(null)
        returnToGrantForm.current = true
      }
      function prepareGrant(data) {
        const device = verified.find(({ id }) => id === data.get('device'))
        const agentId = data.get('agent')
        if (disabled || !device || !sessions.includes(agentId) || !data.has('grant')) return
        const payload = {
          action: 'grant', deviceId: device.id, agentId, duration,
          shell: grantMode !== 'transferOnly', transferDirectory: grantMode === 'shellOnly' ? undefined : data.get('transferDirectory'),
          includeSubdirectories: grantMode !== 'shellOnly' && data.has('includeSubdirectories'), confirm: true,
        }
        if (duration === 'session') {
          setNotice(null)
          setGrantReview({ payload: { ...payload, deviceRevision: device.revision }, device, mode: grantMode })
        } else {
          void mutate({ ...payload, ttlSeconds: Number(data.get('ttl')) }, resetGrantForm)
        }
      }
      const reviewCurrent = grantReview && sessions.includes(grantReview.payload.agentId) &&
        verified.some(({ id, revision }) => id === grantReview.device.id && revision === grantReview.device.revision)
      const grantForm = h('form', { className: 'ssh-inset ssh-stack', hidden: Boolean(grantReview), onSubmit: submitForm(prepareGrant) },
        h('h3', null, t('newGrant')),
        h('div', { className: 'ssh-grid' },
          field(t('select'), selectField({ name: 'device', required: true, onChange: () => setGrantMode('shellOnly') },
            choose('', t('select')), ...verified.map((device) => choose(device.id, `${device.label} · ${describe(device)} · ${device.id.slice(-8)}`)))),
          field(t('session'), selectField({ name: 'agent', required: true, onChange: () => setGrantMode('shellOnly') },
            choose('', t('choose')), ...sessions.map((id) => choose(id, sessionLabel(id))))),
          field(t('grantMode'), selectField({ name: 'grantMode', value: grantMode, onChange: (event) => setGrantMode(event.target.value) },
            ...['shellOnly', 'transferOnly', 'shellAndTransfer'].map((mode) => choose(mode, t(mode))))),
          field(t('duration'), selectField({ name: 'duration', value: duration, onChange: (event) => setDuration(event.target.value) },
            choose('timed', t('timed')), choose('session', t('sessionDuration')))),
          duration === 'timed' && field(t('ttl'), input('ttl', { type: 'number', min: 1, max: 900, required: true, defaultValue: 300 }))),
        grantMode !== 'shellOnly' && h('div', { className: 'ssh-group' },
          field(t('transferDirectory'), input('transferDirectory', { required: true, maxLength: 1024, spellCheck: false, 'aria-describedby': 'ssh-broker-transfer-help' })),
          muted(t('transferHelp'), { id: 'ssh-broker-transfer-help' }),
          check('includeSubdirectories', t('includeSubdirectories'), false)),
        check('grant', t('confirmGrant')), actions(button(t(duration === 'session' ? 'reviewSessionGrant' : 'grant'), {
          type: 'submit', variant: 'primary', ref: grantSubmit, disabled,
        })))
      const review = grantReview && h('div', { className: 'ssh-inset ssh-stack' },
        h('h3', { className: 'ssh-confirm-heading', tabIndex: -1, ref: reviewHeading }, t('reviewSessionGrant')),
        h('dl', { className: 'ssh-confirm-details' },
          h('dt', null, t('select')), h('dd', null, `${grantReview.device.label} · ${describe(grantReview.device)} · ${grantReview.device.id.slice(-8)}`),
          h('dt', null, t('session')), h('dd', null, sessionLabel(grantReview.payload.agentId)),
          h('dt', null, t('grantMode')), h('dd', null, t(grantReview.mode)),
          grantReview.payload.transferDirectory && h(ReactFragment, null,
            h('dt', null, t('transferDirectory')), h('dd', null, h('code', null, grantReview.payload.transferDirectory)),
            h('dt', null, t('transferScope')), h('dd', null, t(grantReview.payload.includeSubdirectories ? 'includeSubdirectories' : 'directChildren'))),
          h('dt', null, t('duration')), h('dd', null, t('sessionDuration'))),
        muted(t('sessionGrantHelp')), muted(t('sessionGrantEnd')),
        !reviewCurrent && h('p', { className: 'ssh-warn', role: 'status' }, t('sessionGrantChanged')),
        actions(button(t('back'), { disabled: busy, onClick: () => {
          returnToGrantForm.current = true
          setGrantReview(null)
        } }), button(t('confirmSessionGrant'), { variant: 'primary', disabled: disabled || !reviewCurrent,
          onClick: () => {
            if (reviewCurrent && !disabled) void mutate({ ...grantReview.payload, confirmSession: true }, resetGrantForm)
          },
        })))
      const accessCard = h('section', { className: 'ssh-card ssh-stack' },
        h('h2', null, t('access')), muted(t('note')), feedback('access'),
        grants.length > 0 && h('ul', { className: 'ssh-list' }, ...grants.filter((grant) => !unknown || grant.status === 'active').map((grant) => h('li', {
          key: grant.id, className: 'ssh-group ssh-divider',
        }, h('div', { className: 'ssh-row' },
          h('div', { className: 'ssh-copy' },
            h('h3', null, grant.deviceLabel), muted(sessionLabel(grant.agentId)),
            badge(unknown ? t('lastKnown') : actionLabel(grant.status), !unknown && grant.status === 'active'),
            !unknown && muted(h(ReactFragment, null, t(grant.transferDirectory ? (grant.shell ? 'shellAndTransfer' : 'transferOnly') : 'shellOnly'),
              grant.transferDirectory && h(ReactFragment, null, h('code', null, ` · ${grant.transferDirectory}`),
                ` · ${t(grant.includeSubdirectories ? 'includeSubdirectories' : 'directChildren')}`))),
            !unknown && grant.status === 'active' && h('p', null, h('code', null, grant.id), ` · ${grant.duration === 'session' ? t('sessionDuration') : `${Math.ceil(grant.remainingMs / 1000)} s`}`)),
          grant.status === 'active' && button(t('revoke'), {
            'aria-label': `${t('revoke')} · ${grant.deviceLabel} · ${sessionLabel(grant.agentId)}`,
            onClick: () => void mutate({ action: 'revoke', id: grant.id }), disabled: busy,
          })),
        !unknown && unlocked && grant.status === 'active' && grant.transferDirectory && h(DirectoryPreview, { t, grant, disabled })))),
        unlocked && (canShowGrantForm ? h(ReactFragment, null, grantForm, review) : muted(t(verified.length ? 'noSessions' : 'noVerifiedDevices'))))
      const backupCard = h('details', { className: 'ssh-card' }, h('summary', null, t('backupTools')),
        h('div', { className: 'ssh-stack' },
          feedback('backup'),
          actionForm('backup', 'backupPassphrase', ({ archive }) => download(archive)),
          devices.length ? muted(t('restoreUnavailable')) : h('form', {
            className: 'ssh-stack ssh-divider', onSubmit: submitForm((data) => void mutate(async () => {
              const file = data.get('archive')
              if (!file?.size || file.size > 1536 * 1024) throw Error('backup_invalid')
              return { action: 'restore', archive: await file.text(), passphrase: data.get('passphrase'), confirm: data.has('restore') }
            })),
          }, h('h3', null, t('restore')),
          field(t('archive'), input('archive', { type: 'file', accept: '.json,application/json', required: true })),
          field(t('backupPassphrase'), secret('passphrase')), check('restore', t('confirmRestore')), actions(submit(t('restore'), disabled, 'secondary')))))
      return h('div', { className: 'dsw-ssh-panel' },
        h('style', null, styles), vaultCard,
        unlocked && deviceList,
        (unlocked || grants.length > 0) && accessCard,
        unlocked && backupCard,
        Boolean(view?.audit.length) && h('details', { className: 'ssh-card' }, h('summary', null, t('audit')),
          h('ul', { className: 'ssh-list' }, ...view.audit.map((row, i) => h('li', { key: `${row.time}-${i}`, className: 'ssh-muted' },
            `${new Date(row.time).toLocaleTimeString()} · ${actionLabel(row.status)}${row.deviceId ? ` · ${row.deviceId.slice(-8)}` : ''}${row.elapsedMs === undefined ? '' : ` · ${row.elapsedMs} ms`}`)))))
    }
    const composerCommand = 'ssh-broker'
    const composerToken = /^\s*\/ssh-broker(?=\s|$)/
    const composerSelection = /^\s+--device ([0-9a-f]{32}) --(?=\s|$)/

    function ComposerTarget({ t, sessionId, draft, claim, phase, inputActions }) {
      const [devices, setDevices] = useState(null)
      const [error, setError] = useState(null)
      const [draftChanged, setDraftChanged] = useState(false)

      useEffect(() => {
        const lifetime = new AbortController()
        let timer
        async function refresh() {
          try {
            const view = await call({ action: 'composer', agentId: sessionId }, lifetime.signal)
            if (lifetime.signal.aborted) return
            setDevices(view.devices)
            setError(null)
          } catch {
            if (!lifetime.signal.aborted) setError('composerUnavailable')
          } finally {
            if (!lifetime.signal.aborted) timer = setTimeout(refresh, 2000)
          }
        }
        void refresh()
        return () => { clearTimeout(timer); lifetime.abort() }
      }, [sessionId])

      const match = composerToken.exec(draft)
      if (!match) return null
      const tokenEnd = match[0].length
      const selector = composerSelection.exec(draft.slice(tokenEnd))
      const selected = selector?.[1] ?? ''
      const active = devices?.find((device) => device.selection === selected)
      const missing = Boolean(selected && devices && !active)
      const editable = phase === 'plain' || phase === 'claimed'

      function select(event) {
        const id = event.target.value
        const span = inputActions.captureInsertion()
        // 指令 chip 在编辑器的插入坐标里占一个位置，草稿文本里则展开为完整指令。
        const start = claim?.name === composerCommand ? 1 : tokenEnd
        const end = start + (selector?.[0].length ?? 0)
        const separator = /^\s/.test(draft.slice(tokenEnd + (selector?.[0].length ?? 0))) ? '' : ' '
        const text = id ? ` --device ${id} --${separator}` : separator
        setDraftChanged(!inputActions.insertText(text, { ...span, start, end }))
      }

      const mode = (device) => t(device.transfer ? (device.shell ? 'shellAndTransfer' : 'transferOnly') : 'shellOnly')
      const sameLabel = (device) => devices?.some((other) => other !== device && other.label === device.label)
      const optionLabel = (device) => `${device.label}${sameLabel(device) ? ` · ${device.suffix}` : ''} · ${mode(device)}`
      const notice = error ?? (draftChanged ? 'composerDraftChanged' : devices === null ? 'composerLoading' :
        missing && devices.length === 0 ? 'composerReauthorize' : missing ? 'composerExpired' : devices.length === 0 ? 'composerNoAccess' : null)
      const automatic = devices?.length === 1 ? t('composerAutomatic') : t('composerChoose')
      return h('div', { className: 'dsw-ssh-composer' },
        h('style', null, styles),
        Boolean(devices?.length || selected) && h('label', null, t('composerTarget'),
          h('select', { value: selected, onChange: select, disabled: !editable || Boolean(error) || !devices?.length },
            choose('', automatic),
            missing && h('option', { value: selected, disabled: true }, t('composerExpired')),
            ...(devices ?? []).map((device) => choose(device.selection, optionLabel(device))))),
        notice && muted(t(notice), { role: 'status' }))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(ns, { en: translations(0), zh: translations(1) }))
        const t = ctx.locale.bind(ns)
        ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'ssh-broker', label: () => t('title'), order: 95 }, ({ useSessions }) => h(Panel, { t, useSessions })))
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: 'ssh-broker', order: 25 }, ({ sessionId, useAccess, useInput, inputActions }) => {
          const draft = useInput((input) => input.draft)
          const claim = useInput((input) => input.claim)
          const phase = useInput((input) => input.phase)
          const canExecute = useAccess('commands/execute')
          if (!canExecute || !composerToken.test(draft) || (claim && claim.name !== composerCommand)) return null
          return h(ComposerTarget, { key: sessionId, t, sessionId, draft, claim, phase, inputActions })
        }))
      },
    }
  },
})
