# PandaAuth Admin 回滚说明

## 适用范围

本文只覆盖 PandaAuth 管理后台 `admin` 服务。发布入口、TAG pin 维护、备份和探活的唯一操作依据是 [PandaAuth 部署手册](../../panda-auth/deploy/README.md)，其中“失败回滚语义”说明自动恢复行为。

## 回退边界

- 正式发布入口检测到 Admin 发布失败时，会按服务粒度从对应 `.env.bak.<UTC>` 恢复 TAG 行、重建旧服务并重新探活；以命令回执判断成功与否。不要手工改服务器 TAG pin。
- `all` 中途失败不是整批回退：此前已经健康的新服务保留新版本，失败服务才回到旧版本，尚未重建的服务只恢复 pin。先按手册核对每个服务的终态，不能盲目重跑 `all`。
- 已成功发布后要主动恢复旧 Admin 版本，现行公开手册没有独立手动 rollback 命令；先由 PandaAuth owning maintainer 核对当前/目标版本及兼容性，并给出正式发布计划。不得猜测 tag 或直接改 `.env`。
- Admin 镜像回退不撤销 Server 数据或数据库迁移。只发布 Admin 时不得顺带运行 Server migration；若本次计划涉及 schema/Seeder 变化，须按 Server 发布手册和数据库备份恢复门禁单独处置。
- 保留 Admin Data Protection 命名卷、当前 Compose project、私密 env provider 和密钥；不得用更换项目名、删卷或重建密钥的方式处理应用回退。

## 验收与证据

记录 Admin 的目标镜像 SHA、配置备份引用、服务健康结果及会话影响。若自动恢复失败，保留现场并交由 owning operator 处置，不继续尝试可能覆盖现场的命令。
