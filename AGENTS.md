# Blades of Hex 项目约定

## 提交、推送与部署

- 当用户明确要求对本项目执行提交、推送和部署时，三项操作合并执行，使用以下 PowerShell 函数：

```powershell
function deploy { param([string]$m) git add -A; git commit -m $m; git push origin main; ssh -i D:/Frostrain.pem root@116.62.179.231 "cd /root/blades-of-hex && git fetch origin && git reset --hard origin/main && PORT=3000 pm2 restart blades-of-hex --update-env && pm2 save" }
```

- 参数 `$m` 是 Git 提交信息。
- 仅在用户明确下达提交、推送或部署指令时运行；普通代码修改仍保持在本地。
