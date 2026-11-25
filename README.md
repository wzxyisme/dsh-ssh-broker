# SSH Broker · SSH 设备

简体中文 | [English](README.en.md)

SSH Broker 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 的非官方插件。它在当前 Profile 中保存加密的 SSH 凭据，你可以按设备、会话和权限范围，授权助手执行非交互式命令或进行 SFTP 文件操作。

## 兼容性

| 项目 | 要求 |
| --- | --- |
| DeepSeek Harness | **Web `0.2.2-rc.5`**；安装清单锁定该版本 |
| Node.js | `>=24`；在 Linux、Node.js `24.22.1` 上验证 |
| 远端 | 可从 DSH Host 访问的 SSH 服务；文件操作另需 SFTP 支持 |

原生桌面客户端及非 Linux Host 未验证。工作区文件上传、校验和替换需要 Host 可访问本机工作区并提供 Linux `/proc/self/fd`。

## 安装或升级

```sh
dsh plugin --profile web add dsh-ssh-broker
```

如果使用其他 Web Profile，把 `web` 替换为对应名称。安装后重启对应的 DSH 服务，再打开「设置 → SSH 设备」。插件随包提供 SSH 的纯 JavaScript 依赖，不需要批准原生构建脚本。不要为未验证的 DSH 版本强制豁免兼容性检查。

**如果安装过 0.7.2 或更早的测试包**：新版的包名与插件条目 ID 均为 `dsh-ssh-broker`，不会读取或删除旧 ID 的凭据库。若需保留设备，在卸载前从旧版导出加密备份，运行 `dsh plugin --profile web remove @local/dsh-ssh-broker`，再安装新版。启动后可将备份恢复到空凭据库，并重新核验各设备的主机指纹。不要同时安装两个版本。

## 快速开始

1. 在「设置 → SSH 设备」创建或解锁该 Profile 的凭据库。
2. 添加设备。从可信的远端控制台核对 SSH 主机公钥的 SHA-256 指纹，再保存设备。建议使用独立、低权限的 SSH 账号。
3. 选择当前会话并授权。先选最小范围：仅 Shell、仅文件传输，或两者都开。文件传输要额外指定远端目录；需要访问子目录时再单独开启。
4. 在会话输入框的「＋」菜单选择 `/ssh-broker`，也可以直接输入。只读命令示例：`/ssh-broker 在获授权的设备上执行 pwd`。结束后可在设置中撤销授权。

| 能力 | 行为 |
| --- | --- |
| Shell | 非交互式命令；返回退出状态及有长度上限的 stdout / stderr |
| SFTP 列目录与下载 | 列出一层授权目录；下载到当前会话附件 |
| SFTP 上传 | 单文件，不覆盖同名文件；工作区文件每次单独审批 |
| SFTP 校验与替换 | 只读比较 SHA-256；覆盖只在明确请求、单次审批及服务端支持时执行 |

单文件操作最多 **8 MiB**。普通上传和原子替换分别需要服务端支持 OpenSSH 的 `hardlink@openssh.com`、`posix-rename@openssh.com` 扩展。更多用法、超时结果及备份恢复见[详细操作手册](bundle/README.md)。

## 安全边界

- Shell 以远端 SSH 账号的权限运行，**不受 SFTP 目录范围限制**。需要隔离时由远端配置文件权限或 SFTP chroot，不要依赖插件替代远端权限控制。
- 凭据库保存在本地并加密，但无法保护已被攻陷的 Host 或同用户恶意进程。不要把密码、私钥、库口令或明文备份放进会话。命令、输出和附件可能保存在会话历史中。
- 授权会随撤销、库上锁或会话关闭而结束；已经在远端运行的独立进程或提交的文件不保证回滚。遇到提交结果不确定，先校验目标，不要直接重试。

安全问题请按[安全政策](SECURITY.md)私下报告。

## 仓库与开发

| 路径 | 内容 |
| --- | --- |
| [`bundle/`](bundle/) | 可安装插件：Host、Web UI、资源和使用手册 |
| [`tests/`](tests/) | 凭据库与 SSH/SFTP 回归测试 |
| [`docs/`](docs/) | 开发、发布和市场提交说明 |

参见[开发与发布](docs/development.md)、[变更日志](CHANGELOG.md)和 [MIT 许可证](LICENSE)。
