# FoloUp CN · AI 语音面试系统（中国特供版）

> 让 AI 替 HR 完成候选人初面：建岗位 → AI 出题 → 候选人链接 → 语音面试 → 转录落库 → AI 评分 → 对比看板。

![License](https://img.shields.io/github/license/foloup/foloup)
![Stack](https://img.shields.io/badge/stack-Next%2016%20%2B%20React%2018%20%2B%20SQLite-blue)

---

## 一、这是什么

本项目是开源项目 **[FoloUp](https://github.com/FoloUp/FoloUp)** 的中国特供分支（CN Edition）。

原版开箱依赖 **4 个境外服务**（Clerk 登录、Supabase 数据库、Retell AI 语音、OpenAI 模型），在国内实际落地时会同时撞上网络连通、计费方式、数据出境和域名备案四堵墙，基本无法直接使用。

本分支做的事可以概括成四类：

| 类别 | 具体动作 |
| :--- | :--- |
| **① 换掉依赖** | 4 个境外服务全部替换为国内 / 自托管方案 |
| **② 删减累赘** | 去掉多租户、客户管理等内部场景用不到的复杂度 |
| **③ 自定义模型** | 文本模型与实时语音模型均可一行配置切换 |
| **④ 中文化 + 新增功能** | 界面 / 提示词 / 报错全中文，并补齐 HR 实际需要的流程能力 |

---

## 二、依赖替换（境外 → 国内）

| 能力 | 上游原版 | 本分支 |
| :--- | :--- | :--- |
| 登录鉴权 | Clerk（SaaS） | **应用内管理员账号**：scrypt 加盐哈希 + 会话 Cookie + 首次登录强制改密 |
| 数据存储 | Supabase（云 Postgres） | **SQLite 单文件**（`better-sqlite3`），默认 `./data/foloup.db` |
| 语音通话 | Retell AI | **通义千问实时语音**，浏览器直连 WebSocket，服务器不转发音频 |
| 大语言模型 | OpenAI | **通义 / DeepSeek / GLM / Kimi 等**，统一走 OpenAI 兼容接口 |

> 语音链路是**浏览器直连**模型平台，音频不经应用服务器 ⇒ 1 核 1G 的机器即可承载（实测稳态内存 50–80 MB）。

---

## 三、删减了什么

目标是让系统保持在「一家公司内部使用」这个复杂度上：

- **多租户 / 组织架构**（Clerk Organization）——改为单一管理员体系
- **客户（Clients）管理**及其相关上下文、服务层——内部 HR 场景不需要
- **注册 / 登录 / 登出等 Clerk 托管页面**——改为自建登录页
- **Webhook 回调路由**与一批 REST 接口（如 `create-interview`、`create-interviewer`、`response-webhook`）——统一收敛为 Next.js Server Actions，减少一跳网络与一套鉴权

---

## 四、自定义模型（改一行即生效）

全部通过环境变量驱动，入口收敛在 `src/lib/llm.ts`：

```bash
LLM_MODEL=deepseek-v4.1-flash                                # 换模型就改这一行
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-xxx                                           # 也可在「系统设置」页填写
LLM_MAX_TOKENS=4000                                          # ⚠️ 不要低于 2000
LLM_TIMEOUT_MS=50000
LLM_JSON_MODE=1                                              # 设 0 则不发 response_format=json_object
```

实时语音单独配置：

```bash
QWEN_REALTIME_API_KEY=sk-xxx               # 不填则回落到 QWEN_API_KEY
QWEN_REALTIME_WS_URL=                      # 留空用默认地域地址
QWEN_REALTIME_MODEL=                       # 默认 qwen3.8-omni-flash-realtime
QWEN_REALTIME_ASR_MODEL=qwen3-asr-flash-realtime
```

设置页填写的密钥会经 **AES-256-GCM 加密**写入 SQLite，不明文落盘。

**出题实测延迟**（同一岗位，仅供参考）：

| 模型 | 延迟 | 备注 |
| :--- | :--- | :--- |
| `deepseek-v4.1-flash` | ≈ 2.3 s | **默认**，性价比最好 |
| `qwen-max` | ≈ 3.4 s | |
| `glm-5` | ≈ 12.6 s | |
| `deepseek-v4-pro` | ≈ 35 s | 偏慢，不建议用于出题 |

⚠️ **坑位提示**：`deepseek-v4` 系列与 `glm-5` 会先输出 `reasoning_content`（思考过程），它与正文**共享 `max_tokens` 预算**。预算设小了会出现「接口返回 200 但正文为空」。长输出场景（逐字稿评分、沟通分析）务必显式给到 8000。

---

## 五、新增了什么

在原版闭环之外补的能力：

- **候选人专属流程**：岗位变成可复用模板，HR 逐人添加候选人 → 上传 PDF 简历 → 服务端提取正文后 **AES-256-GCM 加密入库**（简历正文永不回传候选人浏览器）→ AI 结合岗位与简历出题 → HR 逐题确认 → 签发随机 token 专属链接 `/call/<token>`
- **摄像头监考**：授权、定时截图、视线/风险事件、证据留存与查看，切标签告警
- **知情同意与数据留存**：同意记录服务端留痕、留存期限可配、候选人自助数据申请 / 删除页
- **结果工作台**：岗位能力维度配置、评分证据链、可排序对比表、结果导出
- **面试前设备自检**：麦克风 / 扬声器 / 摄像头授权检测与语音电平诊断，避免正式面试时才发现设备不可用
- **实时对话记录侧栏**：面试过程中同步展示逐字稿
- **手机端适配**：候选人可直接用手机完成面试

---

## 六、中文化

- 全部界面文案（含原先遗留的英文告警弹窗）改为简体中文
- 所有模型提示词中文化，报错信息中文化
- ⚠️ 提示词中作为**对外契约**的 JSON 键名与机器枚举值（如 `supportingQuotes[].type` 的 `"strength"` / `"improvement_area"`）**刻意保留英文**，因为 UI 直接按这些键取值，改动会导致解析失败

---

## 七、快速开始

```bash
git clone https://github.com/CB257526/foloup-cn.git
cd foloup-cn

cp .env.example .env      # 至少填入 QWEN_API_KEY

yarn                      # 装依赖
yarn dev                  # 开发
```

打开 <http://localhost:3000>。

> ⚠️ 本机开发必须用 `localhost` 访问，**不能用 `127.0.0.1`**：否则 Next 16 会判定 `_next/*` 跨域而拦截资源，React 不水合，页面永远停在初始态。

其他命令：

```bash
yarn build      # 生产构建
yarn start      # 生产启动
yarn lint       # biome 检查
yarn check      # biome 检查 + 自动修复
```

**默认管理员账号**：`admin` / `admin`，首次登录会强制要求修改密码。部署到公网后请第一时间改掉。

---

## 八、部署

仓库内已提供生产用的容器化配置：

- `Dockerfile.prod` —— 生产镜像（基础镜像已参数化为 `ARG BASE_IMAGE`，便于切换镜像源）
- `docker-compose.prod.yml` —— 应用 + Caddy（自动申请 / 续期 HTTPS 证书）
- `.env.production.example` —— 生产环境变量模板

```bash
cp .env.production.example .env.production
# 填好域名与密钥后
docker compose -f docker-compose.prod.yml up -d --build
```

### 部署的硬约束

1. **候选人页必须 HTTPS** —— 否则浏览器拒绝授予麦克风权限，语音面试无法进行。
2. **必须有长驻进程 + 持久磁盘** —— SQLite 依赖可写文件系统与常驻进程，因此 **Vercel / GitHub Pages / Cloudflare Workers 等无状态托管平台全部不可用**（`better-sqlite3` 还是原生模块）。要换云只能换成**带持久卷的容器托管**。
3. **`NEXT_PUBLIC_SITE_URL` 是构建期内联的** —— 换域名后**必须重新构建镜像**，只改环境变量不生效。

### 备份

唯一需要备份的是 `data/` 目录：

- `foloup.db` —— 全部业务数据
- `settings.key` —— API Key 加密密钥
- `resume-data.key` —— 简历正文加密密钥

> 🔴 后两个密钥丢失后，已加密的 API Key 与简历正文**将无法解密**，且不可恢复。

---

## 九、已知限制

- 实时语音的**真实手机端麦克风链路**尚未完成真机验证（桌面浏览器已验证）
- 候选人自助删除目前按「专属 token + 邮箱匹配」校验，未加二次验证（如短信 / 邮箱验证码）；需公司在正式使用前确认是否接受，或改为人工审核
- 数据留存到期清理已具备执行入口，但**默认关闭**，需部署方自行接入定时任务
- 若部署在中国大陆以外地区，候选人个人信息构成出境，系统内「存储于境内」的相关表述需按实际部署地修订

---

## 十、License 与致谢

本项目基于 [FoloUp/FoloUp](https://github.com/FoloUp/FoloUp)（MIT License）改造，遵循原协议。感谢原作者的开源工作。

上游远程已保留为 `upstream`，便于同步上游修复：

```bash
git remote add upstream https://github.com/FoloUp/FoloUp.git
git fetch upstream
```
