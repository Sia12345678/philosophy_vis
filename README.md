# 哲学家星图 · Philosophers Across Time & Place

一个交互式可视化,沿时间轴(公元前 600 — 公元 2000)在世界地图上看 118 位东西方哲学家依生卒年浮现/淡出,悬浮看核心理论与代表作,点击看完整生平与思想传承连线。

> Interactive D3 visualization of 118 philosophers from across civilizations — Greek, Roman, Chinese, Indian, Islamic, medieval & modern Europe — projected onto era-appropriate historical world maps and animated along a draggable timeline.

## 功能 · Features

- **时间轴驱动**:拖动滑块,点按生卒区间淡入淡出;跨越历史时代边界时底图平滑切换(7 张世纪级历史地图,涵盖 BC 500 / 100 / 500 / 1300 / 1700 / 1900 / 2010)
- **交互**:悬浮 tooltip(姓名 / 生卒 / 流派 / 代表作),点击侧边栏深度信息
- **思想传承连线**:全局开关显示蛛网,点击单人聚焦上下游
- **流派筛选 + 双语搜索**:30 个流派分组,中英文人名都可搜
- **缩放**:1×–8× 缩放 + 拖动平移,放大后点等比缩小避免遮挡
- **响应式布局**:桌面、平板、手机与横屏均可使用,地图和标记会随容器尺寸重新排布
- **问题式思想路线**:3 条中英双语路线(哲学是什么 / 哲学与社会 / 哲学与人生),每条 6–8 站;支持上一站/下一站、进度保存、继续阅读、重新开始和完成状态
- **自定义提问**:在路线入口写下自己的问题,由用户自己连接的模型从现有哲学家中选择 6–8 个真正相关的概念切入点,生成一条可立即行走的路线;规划失败会明确报错,不会用通用模板假装回答
- **三套视觉风格**:默认「航海图」,可切换「夜航图」与「羊皮纸」;主题选择保存在本地
- **本地优先与分享**:路线进度只存在浏览器本地,可导出/导入 JSON;`#trail=<id>&step=<n>` 可直接分享到某一站,并与录屏模式 `#record` 共存
- **模型隐私边界**:自定义提问由浏览器直连用户选择的模型服务商;Key 默认只放在当前标签页的 sessionStorage,勾选“记住”后才写入 localStorage。项目服务器不接收、不保存、不代理用户的 API Key,自定义路线仅保存在本机
- **可靠底图加载**:底图请求失败会自动重试,并保留已显示的旧地图;首次加载失败时可手动重试
- **电影模式 (cinematic auto-play)**:自动播放时镜头沿 9 个航点平移(雅典→罗马→长安→巴格达→巴黎→哥尼斯堡→现代),顶部标题卡同步显示当下空间与说明
- **BYOK 模型连接**:哲学对话和自定义路线共用一套本地配置。填入自己的 OpenAI / Anthropic / DeepSeek / 通义 Qwen / Moonshot Kimi / 智谱 GLM 或任意 OpenAI 兼容接口,即可使用。**项目不提供任何 key**,也不代理请求;代码完全开源可审计。建议为试用 key 设置消费上限。

## 技术栈 · Tech Stack

Vite + TypeScript + D3.js · 原生 DOM,无框架 · `vite build` 产出纯静态可嵌入任何博客。

| | |
|---|---|
| 投影 | Natural Earth II |
| 历史地图 | [aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps) (CC-BY-4.0) |
| 字体 | Cormorant Garamond + Noto Serif SC |

## 本地运行 · Run Locally

```bash
npm install
npm run dev      # → http://127.0.0.1:5188
npm run build    # → dist/ (纯静态,可直接部署)
npm run qa       # 构建并用 Playwright 跑路线、深链、响应式与无障碍回归
npm run preview
```

## 数据 · Data

- `src/data/philosophers.json` — 118 位哲学家,按出生年排序,每条含双语姓名、生卒、活动地坐标、流派、影响力档(1/2/3)、3-5 条核心理论(双语)、代表作(带年份)、师承/影响关系、200 字中文 bio
- `src/data/schools.json` — 30 个流派配色 + 元数据
- `src/data/eras.json` — 7 个历史时代切片
- `src/data/waypoints.json` — 9 个电影模式镜头航点
- `src/data/trails.json` — 3 条问题式思想路线,共 23 站

## 文件结构 · Layout

```
src/
├── main.ts                   # 入口
├── styles.css
├── data/                     # philosophers / schools / eras / waypoints JSON
├── viz/
│   ├── map.ts                # 地图 + 点 + 缩放 + 底图过渡
│   ├── timeline.ts           # 滑块 + 自动播放 + 镜头脚本
│   ├── lineage.ts            # 师承/影响连线
│   ├── tooltip.ts
│   └── sidebar.ts
├── chat/                     # BYOK 对话、provider 配置与共享设置表单
├── ui/
│   ├── filterBar.ts          # 流派下拉 + 搜索
│   ├── cinematicCaption.ts   # 顶部电影感标题卡
│   └── trails.ts             # 路线入口、自定义提问、播放器与地图联动
└── utils/
    ├── store.ts              # 自实现 pub-sub
    ├── eras.ts               # 时代判断 + 底图加载缓存
    ├── trailHash.ts          # 路线深链与 #record 兼容
    ├── trailProgress.ts      # 本地进度、导入导出
    ├── modelTrail.ts         # 自定义问题的模型规划请求与结果校验
    ├── modelTrailSchema.ts   # 模型提示词、结构化路线解析与校验
    ├── customTrail.ts        # 自定义路线本地快照
    ├── theme.ts              # 三套视觉主题切换
    └── i18n.ts
public/basemaps/              # 7 张历史地图 GeoJSON
worker/index.ts               # Cloudflare Worker: 仅托管静态资源,不含模型接口
```

## 模型规划 · Model planning

自定义问题在浏览器内生成结构化提示词,然后直接请求用户自己配置的模型服务商。模型只负责选择哲学家、理论下标和每一步的问题;返回结果会在前端校验。未知哲学家、非法理论下标或不完整 JSON 会被拒绝;重复人物会自动合并。若首次输出结构不合规,会带着具体错误让模型重排一次。模型不可用时不会偷偷退回本地模板。完整规划通常需要 20–60 秒。

API Key 默认只保存在当前标签页的 sessionStorage;用户勾选“记住此设备”后才写入 localStorage。请求由浏览器直连 provider,不经过本项目的 Cloudflare Worker,因此项目侧既不接收也不保存 Key。部分 provider 可能限制浏览器 CORS;遇到这种情况可换 provider,或使用支持 CORS 的自定义 Base URL。

### 安全边界 · Security boundary

- Base URL 强制 HTTPS(仅本机 localhost 可用 HTTP),Key 只放在请求头,不进入 URL 或日志。
- 切换 provider 会清空表单里的旧 Key,避免把某家服务商的 Key 误发给另一家。
- provider 返回的错误信息在展示前会移除 Key;页面 CSP 限制第三方脚本和 `object`。
- 纯静态前端无法防御恶意浏览器扩展或页面 XSS 读取本地 Key。请始终使用单独创建、设置消费上限、可随时撤销的 Key,不要使用主账号 Key。

## 项目阶段 · Roadmap

详细方案见 [PLAN.md](./PLAN.md)。

- [x] Phase 1 · 骨架 MVP(现代地图 + 时间轴 + 20 人 + 悬浮/点击)
- [x] Phase 2 · 数据扩充至 118 位,涵盖东西方
- [x] Phase 3 · 思想传承连线(全局 + 聚焦双模式)
- [x] Phase 4 · 历史地图(7 张时代切片 + 1945 后当代地图)
- [x] Phase 5 · 电影自动播放 + 流派筛选
- [x] Phase 6 · BYOK 哲学家对话(纯前端调用 LLM,用户自带 key)
- [x] Phase 7 · BYOK 自定义路线(浏览器直连模型,项目侧零 API Key)

## 致谢 · Credits

历史地图来自 [@aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)(CC-BY-4.0)。
