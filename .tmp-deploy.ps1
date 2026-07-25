function deploy { param([string]$m) git add -A; git commit -m $m; git push origin main; ssh -i D:/Frostrain.pem root@116.62.179.231 "cd /root/blades-of-hex && git fetch origin && git reset --hard origin/main && PORT=3000 pm2 restart blades-of-hex --update-env && pm2 save" }
deploy "fix. 将领挂舰选择区分陆战图；重新构建dist使共享引擎真正上线"
