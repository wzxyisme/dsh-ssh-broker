# Awesome DSH Plugin 提交说明

这里的条目是本仓库维护的提交副本，**不代表已收录**。提交前阅读上游的[贡献指南](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。

1. 核对 GitHub 仓库维持公开、未归档并带有 `dsh-plugin` topic。`main` 上的 `bundle/package.json` 必须继续声明 `dsh.bundle`，且旁边有清单指向的补丁。
2. 核对 [`v0.7.2` 发行版](https://github.com/wzxyisme/dsh-ssh-broker/releases/tag/v0.7.2)的 tarball 可以下载、校验和一致，并实际试装。条目 URL 指向 `tree/main/bundle`，因为仓库根不是可安装包。分类 `remote` 对应 SSH/SFTP；固定 tag 避免 `latest/download/` 搭配版本化文件名导致链接在下次发布后失效。
3. 将[这一份条目](wzxyisme__dsh-ssh-broker--bundle.yml)复制到市场仓库的 `data/plugins/wzxyisme__dsh-ssh-broker--bundle.yml`，只提交该文件，不手改市场仓库的 README。本仓库为同一插件只维护一份投稿条目。市场卡片位图和截图是可选的，本条目暂不声明。

PR 标题可用 `Add wzxyisme/dsh-ssh-broker`。说明中可指出包位于 `bundle/`、预构建包在 GitHub Releases，兼容性为 DSH Web `0.2.2-rc.5`。是否收录由市场维护者决定；不要将收录描述为安全审计。
