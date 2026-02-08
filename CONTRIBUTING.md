# 贡献指南

这是一个个人维护的小项目，采用轻量 Git 流程。

## 分支策略（精简版）
- `main`：唯一长期分支，保持可运行。
- `feat/*`（可选）：较大改动时使用的临时分支，完成后合并回 `main` 并删除。

## 版本与发布
- 使用语义化版本：`MAJOR.MINOR.PATCH`。
- 每次发布在 `main` 上打 tag，例如 `v1.0.1`。
- 在 GitHub Release 选择对应 tag，上传 APK。

## 日常开发流程
1. 小改动：直接在 `main` 开发并提交。
2. 大改动（可选）：
   - `git checkout main && git pull`
   - `git checkout -b feat/<short-name>`
   - 开发并提交后合并回 `main`
3. 提交信息建议：
   - `feat: ...`
   - `fix: ...`
   - `docs: ...`
   - `chore: ...`

## 发布流程
1. 确保 `main` 为最新：
   - `git checkout main && git pull`
2. 更新文档：
   - `CHANGELOG.md`
   - `README.md`（如有用户可见变更）
3. 打 tag 并推送：
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`
4. 在 GitHub 创建 Release 并上传 APK。

## 安全与文件规范
- 不要提交密钥、证书和敏感信息。
- 已忽略：`*.jks`、`*.apk`（若需上传 APK，请通过 Release 附件）。

## PR/提交前检查
- [ ] 应用可正常运行（`npx expo start`）
- [ ] 如有必要已更新 `CHANGELOG.md`
- [ ] 未提交敏感文件（`*.jks`、token、env）
