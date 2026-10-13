# 排错

按「最可能的原因」排序。每条都给出**怎么确认**，不要靠猜。

## 面板/插件整个不见了

1. 控制台跑 `window.__dshColorize.state()`。
   * 返回 `undefined` → 客户端半边没挂上：看 `plugin_manager list_plugins` 里 `dsh-colorize` 的 `fiberPhase`
     （`active` 正常 / `failed` 说明 `apply` 抛错，关一次再开会把原始堆栈放进 `error.diagnostic`）。
   * 返回对象但 `modules > 1` → 客户端包被加载了两份：界面和控制台 API 分属两个 store，症状是
     「改完没反应」。多半是同一份 `client.js` 既被 bundle 装进去、又被别的路径 import。
2. `version` 字段和 `package.json` 对不上 → 页面拿的是旧构建，**刷新页面（F5）**即可。
   改 `client.js` 不需要重启 `dsh`，但**关/开 bundle** 那条路在部分版本会报
   `profile resolution: ... requires a process restart`，别用它当热重载。

## 快捷键按了没反应

* 先用设置 → 常规 →「自定义色彩」按钮进入拾色。它是纯鼠标入口，能被键盘问题完全绕开。
* 这个命令走官方 `shortcuts` 服务注册，所以**可以在「设置 → 常规 → 快捷键」里改**，也可以在本插件的
  设置页里录制。命令 id 是 `colorize.pick`。
* Windows / 中文 IME 下 `Alt+Shift` 是输入法切换，**不要**把默认键位设成它。
* `web:linux`（浏览器 + Linux）**没有默认键位**：DSH 只放行三种组合，而它们都被官方命令占了；
  `register()` 会原子校验所有平台的默认键位，给一个不合法默认值会让整条命令注册失败。
  那里请用设置页按钮，或自己改键。
* 历史上还有一次「命令其实命中了，只是界面不重渲染」：`emit()` 用 `Array.prototype.slice.call(Set)` 永远返回 `[]`
  （见 `docs/internals.md`）。如果改了 store 逻辑，先确认订阅者真的被通知了。

## 背景色改了「没生效」

按顺序排除，面板其实已经把这几种情况分成几行：

1. **元素有背景图**（渐变也算）→ 行标签会带「含背景图」。确认规则里有 `background-image: none !important`；
   没有的话说明你改的是别的行。`background-image` 永远盖在 `background-color` 上面。
2. **背景画在伪元素上** → 面板会另外给 `::before` / `::after` 行，改那一行。
3. **元素自己是透明的**（会有一行 `背景 · 当前透明`）：
   * 直接改这一行 = 给这个元素自己上背景（画在祖先之上，一定看得见）；
   * 可见色带属于**祖先** → 还会有「背景 · 祖先 <tag.class>」；
   * 可见色带由某个铺满的**子元素**绘制（会话滚动区、卡片最常见）→ 还会有「背景 · 子元素 <tag.class>」。
4. **面板里一行背景都没有？** 那是 0.5.3 及以前的 bug（祖先探测只走 6 层、深层 DOM 里够不到）。
   0.5.4 起本元素那一行永远存在，先刷新页面（F5）确认面板标题是 `v0.5.4` 或更高。
5. 颜色写进去了但看不到，且行内有「已被更高优先级的样式覆盖」提示 → 有别的 `!important` 规则赢了。
   缩小一步：改用语义色（token）那一行，或把范围切到「仅此元素」。
6. 在 `背景 · 当前透明`（0%）那一行输入颜色却什么都没变 → 0.5.4 起不会了：空位里输入的颜色按
   不透明写入；旧版本会把 0% 当成你要的透明度，写出 `rgba(r,g,b,0)`。

> 检查是否真的写进去了：`document.getElementById('dsh-colorize-overrides').textContent`。

## 透明度（不透明度）看着没保留

先分清是**没写进去**还是**看不出来**：

* 写进去了没有 → 看规则原文和 `localStorage['dsh-colorize:v1']`。0.5.3 起：
  * 行内 hex 框半透明时会显示 8 位（40% → `#74fafb66`），想用 hex 设透明度就写 `#rrggbbaa`；
  * 只写 6 位 hex 会保留当前不透明度；
  * 色块用 `toCss` 上色，40% 就是 40% —— 如果色块看着完全不透明，说明页面还是旧构建（F5）。
* 编辑器开着时行内改了不透明度 → 0.5.3 起编辑器会立刻跟上同一个值。旧构建里编辑器会拿旧草稿，
  拖一下滑杆就把你刚设的透明度写回去（`docs/internals.md` 的 alpha 不变量第 4 条）。

## 面板被设置弹窗挡住

DSH 的设置弹窗是 `body` 下的 `div[role=dialog][aria-modal=true]`（`z-index: 1000`），
与应用 frame（`z-index: 20`）是兄弟堆叠上下文。插件靠 `popover="manual"` + `showPopover()`
把挂载点提升到 top layer。如果面板又跑到弹窗下面：

* 确认挂载点还有 `popover` 属性、`showPopover()` 没抛错（控制台）；
* 某些壳里 `showPopover()` 需要元素已插入文档 —— 挂载顺序变了就会失败。

## 退出拾色后残留一个框 / 角标

高亮框和角标是**直接写 `style` 移动**的（刻意不重绘 React）。退出时（`picking=false` 且 `selected=null`）
必须显式 `display: none` 并清掉缓存位置。改了退出路径就回归一下：
`window.__dshColorize.close()` → 两个元素的 `display` 必须是 `none`。

## 我改的颜色在别的会话里不见了

规则存在 `localStorage`，作用域是**当前浏览器 + 当前 origin**（端口不同就是不同 origin，
用 `--port 0` 起的临时实例看不到你正式实例的配色）。另外清浏览器数据、无痕窗口都会丢。
想搬运就用插件设置页的「导出 / 导入」。

## 卸载

```bash
dsh plugin --profile web remove dsh-colorize
```

残留的样式和配色不会跟着删（它们在你浏览器的 `localStorage` 里）。彻底清干净：
点面板「全部清除」，或在控制台跑 `window.__dshColorize.clear()`。
另注：`dsh plugin remove` 在部分版本会留下 `node_modules/<包名>` 软链，不影响使用，可手动删。
