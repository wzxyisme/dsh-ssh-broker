# 开发与发布

[返回中文 README](../README.md) · [English README](../README.en.md)

## 目录约定

- `bundle/` 是唯一的可安装包根目录。保留包名 `@local/dsh-ssh-broker`、插件 ID `ssh-broker` 和 `dsh.bundle.patch`。DSH 官方模块由 Host 解析，不作为 npm 普通依赖重复打包。
- `tests/` 使用回环地址、临时目录和专用测试凭据。不要把真实 Profile、凭据库、终端日志或 SSH 密钥提交到 Git。
- `docs/` 维护发布和市场提交说明。归档与校验和放在 Git 忽略的 `dist/`，通过 GitHub Release 分发，不提交到 Git。

## 测试

需要 Node.js 24 或更高版本。从仓库根目录运行：

```sh
node --test tests/vault.test.mjs
```

完整回归需要 DSH `0.2.2-rc.5`、能解析 `ssh2` 的已安装插件目录，以及 Linux 上的 OpenSSH `sftp-server`（例如 Debian/Ubuntu 的 `openssh-sftp-server` 包）。运行：

```sh
DSH_TEST_ROOT=/absolute/path/to/dsh-installation \
DSH_TEST_SSH_PACKAGE=/absolute/path/to/installed/dsh-ssh-broker \
node --test tests/*.test.mjs
```

`DSH_TEST_ROOT` 指向含 DSH `package.json` 的安装目录，不是 Profile。`DSH_TEST_SSH_PACKAGE` 用于解析 `ssh2`；测试执行本仓库的代码，不会改动已安装插件或读取实际设备凭据。缺少环境变量会跳过 Host 集成测试；缺少 `sftp-server` 会跳过 SFTP 夹具。发版前应确保两者均未跳过。

## 打包与发布

1. 更新 `bundle/package.json` 的版本、根目录双语 README 的安装链接和变更日志。审阅改动并跑完整回归。
2. 从目标提交打包。在仓库根目录执行（以下以 `0.7.2` 为例）：

   ```sh
   mkdir -p dist
   npm pack ./bundle --ignore-scripts --pack-destination dist
   (cd dist && sha256sum local-dsh-ssh-broker-0.7.2.tgz > SHA256SUMS)
   tar -tzf dist/local-dsh-ssh-broker-0.7.2.tgz
   ```

   检查包只包含运行文件、清单、资源、使用手册和许可证。依赖仍由包管理器按清单安装；tarball 不内嵌 `node_modules` 或本机环境。
3. 用独立测试 Profile 运行 `dsh plugin --profile <test-profile> add <path-to-tgz> --ignore-scripts`。确认包名、版本、兼容性和 Host 插件配置可加载；不要用日常 Profile 代替隔离验证。
4. 在已审阅的主分支提交上创建 `v<版本号>` Release，附上 `.tgz` 和 `SHA256SUMS`。从公开链接下载，再核对 SHA-256。保持资产名和 tag 中的版本一致。
5. 市场采用固定 tag 的 Release URL。后续版本若要更新市场安装入口，只改自己的市场条目。详见[市场提交说明](market/README.md)。
