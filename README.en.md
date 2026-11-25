# SSH Broker

[简体中文](README.md) | English

SSH Broker is an unofficial plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web. It stores SSH credentials in an encrypted vault for the current profile and lets you grant an assistant permission to run non-interactive commands or use SFTP on a specific device in a specific conversation.

## Compatibility

| Component | Requirement |
| --- | --- |
| DeepSeek Harness | **Web `0.2.2-rc.5`**; the bundle manifest pins this version |
| Node.js | `>=24`; tested on Linux with Node.js `24.22.1` |
| Remote device | An SSH service reachable from the DSH Host; file operations also require SFTP |

Native desktop clients and non-Linux hosts have not been verified. Workspace-file uploads, verification, and replacement need access to the local workspace and Linux `/proc/self/fd` on the DSH Host.

## Install or upgrade

```sh
dsh plugin --profile web add dsh-ssh-broker
```

Replace `web` if you use a different Web profile. Restart the corresponding DSH service, then open **Settings → SSH devices**. The package bundles the pure JavaScript SSH dependencies; there are no native build scripts to approve. Do not bypass the compatibility check on unverified DSH versions.

**If you installed a test package at 0.7.2 or earlier:** The new package and plugin entry are both named `dsh-ssh-broker`. The new plugin neither reads nor deletes the old vault. To keep your devices, export an encrypted backup before removing the old package with `dsh plugin --profile web remove @local/dsh-ssh-broker`, then install the new one. After restart, you can restore the backup into the empty vault and reverify each device's host key. Do not install both versions in the same profile.

## Quick start

1. Open **Settings → SSH devices** and create or unlock the vault for this profile.
2. Add a device. Check the SSH host public key's SHA-256 fingerprint from a trusted remote console before saving. Prefer a dedicated, low-privilege SSH account.
3. Grant the current conversation only what it needs: Shell, file transfer, or both. File transfer is opt-in and requires a remote directory. Enable subdirectory access only when needed.
4. Choose `/ssh-broker` from the composer's **+** menu, or type it directly. For a read-only check: `/ssh-broker Run pwd on the authorized device`. Revoke the grant in Settings when you are done.

| Capability | Behavior |
| --- | --- |
| Shell | Runs non-interactive commands and returns exit information and bounded stdout / stderr |
| SFTP listing and download | Lists one level of an authorized directory; downloads are returned as conversation attachments |
| SFTP upload | Uploads one file without overwriting an existing file; workspace files require separate approval each time |
| SFTP verification and replacement | Compares SHA-256 hashes read-only; replacing an existing file requires an explicit overwrite request, one-time approval, and server support |

File operations are limited to **8 MiB per file**. Upload and atomic replacement respectively require the server's OpenSSH `hardlink@openssh.com` and `posix-rename@openssh.com` extensions. See the [detailed manual (Chinese)](bundle/README.md) for usage, timeout results, and backup and recovery.

## Security boundaries

- Shell runs with the remote SSH account's permissions; **SFTP directory restrictions do not constrain Shell**. Use server-side file permissions or an SFTP chroot for isolation.
- The vault is encrypted and stored locally. It cannot protect against a compromised Host or malicious processes running as the same OS user. Keep passwords, keys, vault passphrases, and plaintext backups out of conversations. Commands, output, and attachments may persist in session history.
- Revoking a grant, locking the vault, or closing the conversation ends the grant. This does not guarantee that detached processes stop or committed files roll back. If the commit status is unknown, verify the target before retrying.

Report security issues privately; see the [security policy](SECURITY.md).

## Repository and development

| Path | Contents |
| --- | --- |
| [`bundle/`](bundle/) | Installable plugin: Host, Web UI, resources, and user manual |
| [`tests/`](tests/) | Vault and SSH/SFTP regression tests |
| [`docs/`](docs/) | Development, release, and catalog submission notes |

See [development and releases (Chinese)](docs/development.md), the [changelog](CHANGELOG.md), and the [MIT license](LICENSE).
