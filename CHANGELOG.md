# 变更日志 / Changelog

## 0.7.3

- 首次发布到公共 npm；包名、插件条目 ID 和 Web 模块 ID 统一为 `dsh-ssh-broker`。旧测试版凭据库不会自动迁移或删除。
- 随包分发纯 JavaScript SSH 依赖及其许可证，不安装可选原生加速模块，默认 pnpm 不需要放行构建脚本。

## 0.7.2

- 整理仓库结构，新增英文 README 和发布、市场提交文档；插件名称与兼容性要求不变。
- 此版 GitHub Release 同时包含 `main` 中已合并、先前在本地 `0.7.1` 包中验证过的修复：Shell 正确处理空工作目录，SFTP 区分审批超时、传输进度和提交结果，六个模型侧工具改用英文调用说明。

## 0.7.0

- 新增 SFTP SHA-256 校验、经单次审批的原子替换（需服务端支持）。

## 0.6.x

- 支持经单次审批上传指定工作区文件；修复可选上传来源被序列化为空字符串时的校验。

## 0.5.0

- 新增 SFTP 目录预览和可选的子目录权限。

早期发行包见 [GitHub Releases](https://github.com/wzxyisme/dsh-ssh-broker/releases)。
