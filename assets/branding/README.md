# Page Agent 标志

页面折角与字母 P 构成主体，两个连接的节点表示网页流程编排。沿用插件的紫色配色，背景透明。

- `page-agent-logo.png`：生成原图，1254 × 1254，RGBA。
- `../../public/icons/page-agent-{16,32,48,128,256,512}.png`：由原图等比缩小的 PNG；16/32 用于工具栏，48/128 用于扩展管理，128 同时供侧栏使用。
- 不给图标再叠加背景色、圆角裁切或投影，以免破坏透明留白。

使用内置 imagegen 生成并精修，使用 macOS `sips` 输出各尺寸。生成过程没有引入运行时服务或依赖。

## 初始提示词

Use case: logo-brand. Create one polished production app icon for Page Agent, a browser workflow automation extension. A simple, memorable white geometric page-shaped P monogram with a short connected workflow route and two small rounded-square nodes subtly integrated into its counter or right edge. Strong clear silhouette and generous negative space so it remains recognizable at 16 pixels. Thick robust geometry, balanced optical spacing. Place the white symbol inside a rounded square indigo-violet tile, subtle smooth gradient from #7966F1 upper left to #5543CF lower right, flat crisp vector-like finish. Single icon only, no wordmark, no text, no mockups, no borders, no sparkles, no metallic effects, no drop shadows outside the tile. Square canvas with the tile centered, filling 88 percent of the width, corners radius approximately 22 percent of tile. Real transparent background outside the tile. The page and route should feel like one coherent proprietary symbol, not a collage. Intended for Chrome toolbar, extension management and a 34px app header.

## 精修提示词

Polish this exact Page Agent logo for production. Preserve the white page-shaped P with two connected workflow nodes and purple tile composition and proportions. Fix only edge quality and surface finish: eliminate ALL stray blue speckles, halos, debris, grain and artifacts outside the tile, make the rounded-square boundary perfectly clean and smoothly antialiased, with all background outside genuinely transparent. Simplify tile surface to a smooth subtle indigo-violet gradient with no texture or lighting noise. Keep same centered icon and generous margins. Clean crisp vector-like app icon, no external shadow, no text.
