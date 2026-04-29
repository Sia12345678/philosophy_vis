# 哲学家星图 · Philosophers Across Time & Place

一个交互式可视化,沿时间轴(公元前 600 — 公元 2000)在世界地图上看 118 位东西方哲学家依生卒年浮现/淡出,悬浮看核心理论与代表作,点击看完整生平与思想传承连线。

> Interactive D3 visualization of 118 philosophers from across civilizations — Greek, Roman, Chinese, Indian, Islamic, medieval & modern Europe — projected onto era-appropriate historical world maps and animated along a draggable timeline.

## 功能 · Features

- **时间轴驱动**:拖动滑块,点按生卒区间淡入淡出;跨越历史时代边界时底图平滑切换(7 张世纪级历史地图,涵盖 BC 500 / 100 / 500 / 1300 / 1700 / 1900 / 2010)
- **交互**:悬浮 tooltip(姓名 / 生卒 / 流派 / 代表作),点击侧边栏深度信息
- **思想传承连线**:全局开关显示蛛网,点击单人聚焦上下游
- **流派筛选 + 双语搜索**:30 个流派分组,中英文人名都可搜
- **缩放**:1×–8× 缩放 + 拖动平移,放大后点等比缩小避免遮挡
- **电影模式 (cinematic auto-play)**:自动播放时镜头沿 9 个航点平移(雅典→罗马→长安→巴格达→巴黎→哥尼斯堡→现代),顶部标题卡同步显示当下空间与说明
- **与哲学家对话(BYOK)**:点开侧边卡片底部 ⚙ 填入您自己的 OpenAI / Anthropic / DeepSeek / 通义 Qwen / Moonshot Kimi / 智谱 GLM key,即可让大模型扮演该哲学家与您对谈。Key 仅存于本地浏览器,**项目不提供任何 key**,代码完全开源可审计。建议为试用 key 设置消费上限。

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
npm run preview
```

## 数据 · Data

- `src/data/philosophers.json` — 118 位哲学家,按出生年排序,每条含双语姓名、生卒、活动地坐标、流派、影响力档(1/2/3)、3-5 条核心理论(双语)、代表作(带年份)、师承/影响关系、200 字中文 bio
- `src/data/schools.json` — 30 个流派配色 + 元数据
- `src/data/eras.json` — 7 个历史时代切片
- `src/data/waypoints.json` — 9 个电影模式镜头航点

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
├── ui/
│   ├── filterBar.ts          # 流派下拉 + 搜索
│   └── cinematicCaption.ts   # 顶部电影感标题卡
└── utils/
    ├── store.ts              # 自实现 pub-sub
    ├── eras.ts               # 时代判断 + 底图加载缓存
    └── i18n.ts
public/basemaps/              # 7 张历史地图 GeoJSON
```

## 项目阶段 · Roadmap

详细方案见 [PLAN.md](./PLAN.md)。

- [x] Phase 1 · 骨架 MVP(现代地图 + 时间轴 + 20 人 + 悬浮/点击)
- [x] Phase 2 · 数据扩充至 118 位,涵盖东西方
- [x] Phase 3 · 思想传承连线(全局 + 聚焦双模式)
- [x] Phase 4 · 历史地图(7 张时代切片 + 1945 后当代地图)
- [x] Phase 5 · 电影自动播放 + 流派筛选
- [x] Phase 6 · BYOK 哲学家对话(纯前端调用 LLM,用户自带 key)

## 致谢 · Credits

历史地图来自 [@aourednik/historical-basemaps](https://github.com/aourednik/historical-basemaps)(CC-BY-4.0)。
