# 发版

发布走 **staged publishing + trusted publishing**：CI 只把版本暂存到 npm 的 stage 队列，
维护者用 2FA 批准后才真正上线。全程不需要任何长期 token。

## 一次性准备

1. **npm 账号开启 2FA。** staged publishing 的批准步骤依赖它。
2. **包必须先存在于 registry。** `npm stage` 不支持全新包 —— 首次发布只能手工：

   ```bash
   npm login --registry https://registry.npmjs.org
   npm publish --registry https://registry.npmjs.org --access public
   ```

   之后 `release.yml` 才能接管后续版本。
3. **配置 trusted publisher。** npmjs.com → 包页面 → Settings → Trusted Publisher：
   填本仓库（`jianghuifr/dsh-mobile-ui`）、workflow 文件名 `release.yml`，
   并把权限限制为 **stage-only**。这一步让 CI 用 OIDC 换凭据，无需 `NPM_TOKEN`。

## 每个版本

```bash
npm version patch        # 或 minor / major
git push --follow-tags
```

打上 `v*` 标签触发 `release.yml`：

1. 校验标签与 `package.json` 的版本一致（不一致直接失败）；
2. 跑 `npm run verify`（bundle 完整性检查 + eslint + node --test）；
3. 若 registry 上还没有这个版本，`npm stage publish` 把它暂存；
4. 建一个 GitHub Release。

## 批准

暂存**不等于发布**，对公众不可见。用 2FA 批准：

- 网页：npmjs.com → 账号 → **Staged Packages** → Approve
- CLI：`npm stage list` 拿 stage id → `npm stage approve <stage-id>`

批准后 `https://www.npmjs.com/package/@jianghuifr/dsh-mobile-ui` 才会更新。

## 图标集更新

图标是 vendoring 进仓库的（`assets/`，1251 个 SVG + 一张映射表），运行时**不读** VS Code
扩展目录。要跟进上游：

```bash
node scripts/vendor-icons.mjs              # 自动找已安装的 material-icon-theme
node scripts/vendor-icons.mjs --from <dir> # 或指定目录
npm run verify
```

然后把 `assets/` 与 `assets/source.json` 的版本变更一起提交。图标更新会明显影响包体积
（当前 1 MB 图标 + 398 KB 映射表），所以单独成一个 commit 更好读。
