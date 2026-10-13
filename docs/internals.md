# 工作原理与不变量

这份文档写给改这个插件的人（包括几个月后的我）。**「为什么这么写」比「写了什么」更重要**，
因为这里的每一个设计几乎都对应一个踩过的坑。

## 一、四条硬约束

1. **空闲零轮询**：不进页面时不跑任何定时器、不监听 DOM 变化。常驻的只有
   `#dsh-colorize-overrides` 这一条 `<style>`、一个注册到官方 `shortcuts` 的命令、和一个零尺寸 React 挂载点。
   `npm run check:manifest` 会用两条正则拦住 `setInterval()` 和 `new MutationObserver()` 回归。
2. **不写 profile**：插件只活在自己的 `<style>` / `localStorage` / `theme.overrideTokens` 层里，
   不碰 `~/.dsh/profiles/**`。安装卸载只走 `dsh plugin add/remove`。
3. **颜色只改颜色**：不改圆角 / 字号 / 间距，也不注入脚本。
4. **透明度是显式的**：任何「保留 alpha」的地方都必须写清楚 alpha 从哪来；改 hex、点预设、用系统取色器
   都不许静默把不透明度重置回 100%（见下面「alpha 不变量」）。

## 二、四个界面，一个 store

| 位置 | 服务 | 作用 |
| --- | --- | --- |
| `shell.overlay` | `slots` | 浮动面板：拾色遮罩、高亮框、角标、颜色行、取色器 |
| `settings.general.item` | `slots` | 设置 → 常规 →「自定义色彩」：鼠标入口（键盘被 IME 吞掉时用它） |
| `plugins.bundle.config` | `slots` | 插件设置页：快捷键录制 + 每条改动一行 + 导出/导入 |
| `colorize.pick` | `shortcuts` | 官方快捷键命令（默认 `Ctrl+Shift+K`） |

四个界面共用 `client.js` 里的一个 store（`subscribe()` / `emit()`），所以面板和设置页永远看到同一份数据。

> **`emit()` 必须 `Array.from(store.listeners)`**。`store.listeners` 是 `Set`，
> `Array.prototype.slice.call(Set)` 读的是 `this.length`（Set 只有 `size`），永远返回 `[]` ——
> 订阅者一次都不会被通知，界面永远不重渲染。0.3.0 的「热键按了没反应」就是这个。

## 三、规则模型

一次着色 = **一条 CSS 规则**：

```js
{ id: 'color::p.foo', selector: 'p.foo', prop: 'color', value: 'rgba(34, 162, 184, 0.4)', label, extra? }
```

* `id = prop + '::' + selector` —— 同一个选择器上同一个属性只有一条规则，改写就是覆盖。
* 渲染成一段 `selector { prop: value !important; extra }` 塞进 `<style id="dsh-colorize-overrides">`。
* `extra` 是附加声明，目前只用于背景图：`background-image: none !important;`（否则 `background-image` 会盖住 `background-color`）。
* 持久化：`localStorage["dsh-colorize:v1"]` → `{ version: 1, rules: [...], tokens: {...} }`，写入去抖 250ms（token 400ms）。

### 选择器怎么来

`buildSelector(el)` 依次尝试：

1. 唯一的 `id`
2. 唯一的 `data-*` / `aria-label`（转义后）
3. 最短的**唯一**祖先路径，中间层不够唯一时才补 `:nth-of-type(n)`

每个候选都用 `querySelectorAll` 验过「确实唯一」才会被采用。这也是为什么改动一个元素之后，
同一个类名的其他元素不会被误伤 —— 除非你显式选「同类 N 个」。

### 应用范围

编辑器里的三个范围：

| 范围 | 选择器 | 效果 |
| --- | --- | --- |
| 仅此元素 | `sel` | 1 个元素 |
| 同类 N 个 | 去掉 `:nth-of-type(n)` 的 `sel` | 所有同类 |
| 含后代 N 个 | `sel, sel *` | 自己 + 全部后代 |

切换范围时会**搬移**已有规则（删旧 id、写新 id），不会留下两条。

## 四、语义色（token 层）

元素的计算色正好等于某个 `--dsw-alias-*` / `--dsw-specific-*` 时，面板会多出一行「语义色（全局生效）」。
改它不走 CSS 规则，而是：

```js
theme.overrideTokens('dsh-colorize', { '--dsw-alias-bg-base': { light: value, dark: value } })
```

* 必须给 `{ light, dark }` 两个值（`theme` 服务拒绝裸字符串）。
* 「明/暗」勾选 = 同时写两层；不勾选只写当前配色模式，另一层保留主题原值。
* 这比元素级规则稳得多：整个界面跟着变，也不会被别的规则压住。

## 五、拾色热路径（性能）

拾色模式要跟着鼠标走，又不能卡：

* 遮罩是 `pointer-events: none` 的全屏层，所以**不需要命中测试** —— 直接读 `event.target`。
  （曾经用 `document.elementsFromPoint`，实测 ~0.42ms/次、3 秒里 180 次，还触发二次强制布局。）
* 指针移动合并成**每帧一次** `requestAnimationFrame`，`getBoundingClientRect` 每帧只调一次。
* 高亮框用 `transform: translate3d(...)` 移动 + `will-change: transform`（走合成器），
  不用 `left/top`，也不带 `box-shadow`。rAF 回调实测 0.425ms → 0.318ms。
* 退出拾色一定把高亮框/角标显式 `display: none` 并清缓存 —— 它们是直接写 `style` 移动的，不重绘 React，
  没人隐藏就会冻结在最后一帧（0.5.1 的「窗口关不掉」）。

## 六、面板为什么必须在 top layer

DSH 的设置弹窗是 `body` 下的 `div[role=dialog][aria-modal=true]`，`z-index: 1000`，
而应用 frame 是 `z-index: 20` —— 两者是**兄弟堆叠上下文**，frame 里再大的 `z-index` 也压不上去。
所以挂载点用 `popover="manual"` + `showPopover()` 提升到浏览器 top layer。

## 七、alpha 不变量（最容易出错的地方）

颜色的 alpha **不是**「顺手带一下」的东西，它是三处独立来源的交汇点：正在编辑的草稿、行内输入框、规则现值。
约定：

1. `parseColor` 必须读得出 `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` / `rgb(... / a)`，
   并且**百分比 alpha 要除以 100**（`rgba(0,0,0,40%)` 曾经被 clamp 成 1，透明度静默消失）。
2. `toCss` 是写进规则的**唯一**序列化入口：`a >= 0.999` 才降级成 hex，否则写 `rgba(...)`。
3. 行内 hex 框显示 `toHexAlpha(color)`（半透明就是 8 位），改 hex 时用 `carriesAlpha(raw)` 决定
   「输入里的 alpha 胜出」还是「保留行内当前不透明度」。
4. `ColorEditor` 记住自己最后写出的 CSS（`written` ref）：`from` 变成别的值说明改动来自别处
   （行内框、另一个面板），要重新取用；自己写的回声忽略。**少了这一步，编辑器开着时行内改的透明度
   会被下一次拖动写回旧值** —— 用户看到的就是「用了滑杆，透明度没了」。
5. 色块一律用 `toCss` 上色，不要用 `toHex`：否则 40% 的颜色在界面上显示为完全不透明，
   看起来也像「透明度丢了」。
6. **0% 是「空位」，不是「用户想要的透明度」**：透明元素的背景行、未被覆盖的 token 起手都是
   `rgba(0, 0, 0, 0)`。`alphaForEdit(parsed, current, raw)` 的规则是「输入里写了 alpha 就以它为准，
   否则沿用行内不透明度，但行内是 0 时按输入的不透明值写」；`opaqueIfEmpty()` 让编辑器从空位起手时用 100%。
   少了这一条，用户输入一个颜色得到的是 `rgba(r,g,b,0)` —— 屏幕上什么都没变，又被当成「改不了」。

`tests/color.test.mjs` 覆盖 1～3 与 6；4 与 5 靠 `docs/verification.md` 里的浏览器验收。

## 八、背景行必须「一定给得出」

背景是这个插件被投诉最多的地方，原因都是**面板没给行**而不是写不进去。行是怎么来的：

| 行 | 条件 |
| --- | --- |
| `背景`（本元素） | 元素自己的 `background-color` 不透明**或**有 `background-image` |
| `背景 · 当前透明` | 元素自己不画背景 —— **也要给**，值就是 `rgba(0, 0, 0, 0)`，标签注明「当前透明」 |
| `背景 ::before` / `::after` | 伪元素有 `content` 且画背景（毛玻璃头部/卡片常见） |
| `背景 · 子元素 …` | 有直接子元素铺满 ≥85% 面积且自己上色（滚动区、卡片：容器的背景被它盖住） |
| `背景 · 祖先 …` | 祖先在画可见色带（往上找 **12** 层） |

约定：

* **「本元素」那一行永远存在**（要么是真实颜色，要么是「当前透明」）。面板是唯一入口，
  不能因为探测没猜到就不给 —— 0.5.0～0.5.3 的「背景改不了」全是这个：深层 DOM 里祖先超出探测范围
  （曾经只走 6 层）、又没有铺满的子元素，于是三条候选都不成立，面板一行背景都不给。
* 子孙 / 祖先那两行是**互斥的备选**（谁在画可见色带就显示谁），本元素行永远在，顺序是
  `祖先 → 本元素 → 子元素`（祖先在前是为了让 `matchTokens` 拿到真正可见的颜色去匹配语义色）。
* 元素有 `background-image` 时，规则必须同时写 `background-image: none !important`（见 `extra`），
  否则 `background-color` 永远被图盖着。
