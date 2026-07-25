# Blades of Hex 项目约定

## 提交、推送与部署

- 当用户明确要求对本项目执行提交、推送和部署时，三项操作合并执行，使用以下 PowerShell 函数：

```powershell
function deploy { param([string]$m) git add -A; git commit -m $m; git push origin main; ssh -i D:/Frostrain.pem root@116.62.179.231 "cd /root/blades-of-hex && git fetch origin && git reset --hard origin/main && npm run build && PORT=3000 pm2 restart blades-of-hex --update-env && pm2 save" }
```

- 参数 `$m` 是 Git 提交信息。
- 仅在用户明确下达提交、推送或部署指令时运行；普通代码修改仍保持在本地。
- `dist/` 在 .gitignore 中、不进仓库：游戏客户端由服务器端的 `npm run build` 现场构建（服务器已装 vite 与 node v20）。少了这一步，服务器只会继续跑旧 bundle——前端代码改动必须带服务器端构建才算真正上线。
