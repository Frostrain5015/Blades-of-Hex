function deploy { param([string]$m) git add -A; git commit -m $m; git push origin main; ssh -i D:/Frostrain.pem root@116.62.179.231 "cd /root/blades-of-hex && git fetch origin && git reset --hard origin/main && npm run build && PORT=3000 pm2 restart blades-of-hex --update-env && pm2 save" }
deploy "refactor. 共享引擎第二轮迭代：感知诚实化、攻城任务放弃权、近战兑现力评估"
