# SSH 设备 · DeepSeek Harness 插件

这是一个非官方的 DeepSeek Harness Web 插件。在本地加密凭据库中管理 SSH 设备，核对主机指纹后，为选中的会话授予限时或仅本次会话有效的 Shell 或 SFTP 权限。SFTP 默认关闭，不需要时不要开启。

## 安装

此版本只验证了 Linux 上的 **DSH Web `0.2.2-rc.5`** 与 **Node.js `24.22.1`**。清单要求 Node.js `>=24`，并将 DSH 锁定于 `0.2.2-rc.5`。请勿为其他 DSH 版本强制豁免。

如已取得 `local-dsh-ssh-broker-0.5.0.tgz`，从归档所在目录执行（将 `web` 换成你使用的 Profile 名称）：

```sh
dsh plugin --profile web add ./local-dsh-ssh-broker-0.5.0.tgz --ignore-scripts
```

`--ignore-scripts` 不运行依赖的安装脚本；本插件无需为 SSH 依赖启用本机编译。如果尚未发布归档，可从本仓库的 `bundle/` 打包。上面的命令安装的是整个 Profile 的 Host 插件；仅安装你已核对来源的归档。安装完成后启动或重启对应 Profile，在「设置 → SSH 设备」中使用。

## 使用与安全边界

- 从可信渠道核对目标机的 Host Key 指纹，使用专用低权限账号。不要把 SSH 私钥、密码或凭据库口令发给助手。
- 为当前会话授权后，在 Harness 的「＋」或斜杠菜单选择 `/ssh-broker`，填写任务并发送。只有一台设备获授权时自动使用它，多台时先选设备。自 `0.4.0` 起，模型工具统一使用 `dsh_ssh_broker_` 前缀。
- 授权绑定设备和会话，有效期内可撤销。只需要传文件时选择「仅文件传输」，并指定远端目录。上传仅接受当前会话中用户提供的附件；下载返回当前会话的文件附件。上传不覆盖同名文件，且需要服务端支持 OpenSSH `hardlink@openssh.com`。
- 启用 Shell 就允许按 SSH 账号现有权限执行命令；SFTP 目录限制不约束 Shell。需要在远端强制隔离文件访问时，应使用操作系统权限或 SFTP chroot。凭据库加密不防御已被攻陷的宿主机或同用户恶意进程。
- 已在隔离 Profile、低权限回环 OpenSSH 和 Chrome 中验证会话授权、上传下载、在途下载撤销及默认关闭。聊天界面点击附件保存到本机未单独验收。

[完整使用、备份与恢复说明](bundle/README.md) · [安全问题报告](SECURITY.md)

## 打包与测试

在仓库根目录运行：

```sh
node --test phase2-vault.test.mjs composer-host.test.mjs
npm pack ./bundle --ignore-scripts
```

要运行 Host 指令集成测试，请将 `DSH_TEST_ROOT` 设为 Harness 安装目录，将 `DSH_TEST_SSH_PACKAGE` 设为已安装的 SSH 设备插件目录。未设置时会跳过该项。

安装包应只包含 bundle 的运行代码、资源、使用说明和许可证，不包含测试、日志、凭据或 Profile 数据。项目源码采用 [MIT 许可证](LICENSE)。
