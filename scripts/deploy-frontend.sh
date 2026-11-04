#!/usr/bin/env bash
# 前端部署：构建 → 同步到 nginx 静态卷 → 清理 N 天前的旧 chunk → reload
#
# 用法：bash /opt/lims/scripts/deploy-frontend.sh
#
# 为什么不用 rsync --delete（2026-11-04 用户报障）：
#   删除旧 chunk 会让「已打开但未刷新的标签页」在点进别的模块时懒加载 404
#   → React 渲染不出来 → 白屏；刷新后拿新 index.html 才好。
#   旧文件保留 KEEP_DAYS 天足够覆盖跨部署的会话。
set -euo pipefail

ROOT=/opt/lims
DIST_VOL=/var/lib/docker/volumes/docker_frontend-dist/_data
KEEP_DAYS=${KEEP_DAYS:-7}

cd "$ROOT/frontend"
echo "== 构建"
npm run build

echo "== 同步到 $DIST_VOL（保留旧 assets）"
mkdir -p "$DIST_VOL"
rsync -a dist/ "$DIST_VOL"/

echo "== 清理 ${KEEP_DAYS} 天前的旧 assets"
find "$DIST_VOL/assets" -type f -mtime "+$KEEP_DAYS" -delete
echo "   剩余文件数: $(ls "$DIST_VOL/assets" | wc -l)"

echo "== reload nginx"
docker exec docker-nginx-1 nginx -s reload
echo "== 完成"
