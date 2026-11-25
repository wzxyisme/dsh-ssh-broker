# 开发与发布

[返回中文 README](../README.md) · [English README](../README.en.md)

## 目录约定

- `bundle/` 是唯一的插件包根目录。公开包名、插件条目 ID 和 Web 模块 ID 均为 `dsh-ssh-broker`。DSH 官方模块由 Host 解析，不作为 npm 普通依赖重复打包。
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

1. 更新 `bundle/package.json` 的版本及变更日志，审阅改动并跑完整回归。用 npm 更新并提交包的锁文件。
2. 在受审阅的提交上，从仓库根目录按锁文件生成发布归档（以下以 `0.7.3` 为例）：

   ```sh
   node scripts/pack-release.mjs
   (cd dist && sha256sum -c SHA256SUMS)
   tar -tzf dist/dsh-ssh-broker-0.7.3.tgz
   ```

   脚本在临时目录运行 `npm ci --omit=optional --ignore-scripts`，保留 `ssh2` 的必需 JavaScript 依赖及许可证，剔除上游测试夹具。不要捆绑可选的 `cpu-features`、`nan` 或编译产物，也不要直接从源码目录发布。原生加速不是 SSH/SFTP 的运行前提。
3. 在独立的 DSH Web Profile 中，用 `dsh plugin --profile <test-profile> add <path-to-tgz>` 试装，不加 `--ignore-scripts`。检查包名、版本、组合配置和 Host 回归。
4. 在已登录并启用 2FA 的终端发布上一步验证过的**同一个归档**：

   ```sh
   npm publish ./dist/dsh-ssh-broker-0.7.3.tgz --access public --ignore-scripts --registry=https://registry.npmjs.org
   ```

   用干净的 Profile 验收 `dsh plugin --profile web add dsh-ssh-broker`，并核对公开 npm 的版本和包内容。若同步发布 GitHub Release，使用已验证归档和校验和，不要另打一个不同的包。市场条目使用固定的 Release URL，参见[市场提交说明](market/README.md)。
