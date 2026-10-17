# AGENTS.md — 在本仓库里干活前先读这个

## 这是什么

`dsh-colorize`（界面调色师）：DeepSeek Harness 的**浏览器半边**插件。快捷键进拾色模式，点界面上任意元素
就地改色 —— 元素级改动落成一条 CSS 规则，颜色命中语义色时走 `theme.overrideTokens` 覆盖层。

`client.js` 是全部逻辑（约 2900 行，一个 IIFE 式的 `window.__ModuleLoader__.load({ factory })`）；
`index.js` 是**故意的空实现**，只为让这个包是普通的 bundle 条目。

## 不能回退的硬约束（改之前先看有没有守卫盯着）

1. **空闲零轮询**：不进拾色模式时不许有 `setInterval`、`MutationObserver`、常驻 rAF 循环、键盘监听。
   常驻只允许：一条 `<style>`、一个 `shortcuts` 命令、一个零尺寸挂载点。
   `npm run check:manifest` 会用正则拦 `setInterval(` 与 `new MutationObserver(`。
2. **不写 profile**：插件只写自己的 `<style>`、`localStorage["dsh-colorize:v1"]` 与 `theme.overrideTokens`。
   安装/卸载只走 `dsh plugin add/remove`。
3. **`emit()` 必须 `Array.from(store.listeners)`**：`store.listeners` 是 `Set`，
   `Array.prototype.slice.call(Set)` 读 `this.length` 永远返回 `[]` —— 订阅者一次都不会被通知，
   界面永远不重渲染（0.3.0 的「热键按了没反应」就是这个）。
4. **面板必须在 top layer**：`popover="manual"` + `showPopover()`。DSH 设置弹窗是 `body` 下
   `z-index:1000` 的独立堆叠上下文，应用 frame 是 `z-index:20`，frame 内部再高的 z-index 也翻不过去。
5. **alpha 不变量**（`docs/internals.md` 第七节，逐条都有来历）：
   * `parseColor` 必须读得全，**百分比 alpha 要 /100**（`rgba(0,0,0,40%)` 曾被 clamp 成 1）；
   * 写进规则只能走 `toCss`（`a >= 0.999` 才降级 hex）；
   * 行内 hex 显示 `toHexAlpha`，改 hex 用 `carriesAlpha(raw)` 决定「输入里的 alpha 胜出」还是「保留当前不透明度」；
   * `ColorEditor` 用 `written` ref 区分「自己写的回声」和「别处改的值」，否则编辑器开着时行内改的
     透明度会被下一次拖动写回旧值；
   * **0% 是「空位」不是「用户要的透明度」**：`alphaForEdit()` / `opaqueIfEmpty()` 保证在
     `rgba(0,0,0,0)` 的行里输入颜色、或从它打开编辑器，都是不透明起手 —— 否则写出 `rgba(r,g,b,0)`，
     屏幕上什么都没变，用户会继续报「改不了」；
   * 色块一律 `toCss` 上色，不许 `toHex`（40% 会显示成完全不透明，看着也像「透明度丢了」）。
6. **背景行必须一定给得出**：本元素透明时**也要**给一行 `背景 · 当前透明`（值就是 `rgba(0,0,0,0)`）。
   曾经只在「猜到有祖先 / 子元素在画背景」时才给背景行，于是在深层 DOM 里（祖先超出探测范围、又没有
   铺满的子元素）面板**一行背景都没有** —— 用户只能反复反馈「背景改不了」。祖先探测保持 12 层、
   铺满子元素扫描 20 个；祖先 / 子元素两行互斥，但本元素那一行永远在。
7. **面板必须留在视口里**：内容高度会变（打开取色器 / 语义色行），所以 `placePanel` 在**每次渲染后**
   重算（rAF 合并），两轴夹在视口内（8px 边距，放不下翻到元素上方），`max-height`/`max-width` 收到视口尺寸，
   打开取色器时 `scrollIntoView`。只在「选中元素 + scroll/resize」时算一次的话，贴边取色会顶出屏幕。
8. **手动改的目标必须被尊重**：`目标` 是输入框，重匹配走 `inspectElement(el, selectorOverride)`，
   行的规则**写用户输入的选择器**，不许回退到 `buildSelector`。非法 / 零匹配只显示行内说明，不动当前选择。
   **放宽选择器时只要 `store.selected.el` 仍 matches，就继续用它**（不许改成 `list[0]`）——
   否则用户看到的是「面板跳到了第一个匹配元素」。窗口捕获的「Esc 关面板」必须跳过 `input / textarea / select`。
9. **手动拖拽优先于自动摆放**：标题栏拖动写 `manualPos`，此后 `placePanel` 只夹边、不再按元素摆放；
   拖动要 pointer capture + 视口夹边，标题栏上的按钮按下不触发拖动；换目标时清空 `manualPos` 恢复自动摆放。
10. **`client.js` 的 `VERSION` 必须等于 `package.json` 的 version**：面板标题读它，这是「页面里装的哪个构建」
    的唯一线索。`npm run check:manifest` 会拦。
11. **两份 locale 的键必须一一对应**，`files` 必须覆盖所有会发布的东西。
12. **别把 `web:linux` 的默认键位加回来**：DSH 只放行三种组合且都被官方命令占了，
    `register()` 会原子校验所有平台的默认键位 —— 一个不合法默认值会让整条命令注册失败。
    Windows/中文 IME 下 `Alt+Shift` 是输入法切换，也不要当默认键。

## 环境坑（踩过）

- **改完 `client.js`：刷新页面（F5）即可**（宿主每次页面加载从磁盘读客户端模块，实测过）。
  不需要重启 profile，也**不要**用关/开 bundle 当热重载：部分版本会报
  `profile resolution: ... requires a process restart`。
- **验证必须用自建临时实例**：`(dsh --profile web --port 0 --no-open > /tmp/cz.log 2>&1 &)`，
  睡 14 秒，从日志里取带 token 的 URL；用完 `kill` 掉并删 `/tmp/cz.log`。
  不要动用户正在跑的那个实例（端口不同 = origin 不同 = `localStorage` 不同，看不到对方的配色）。
- **React 受控输入要原生 value setter**：`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v)`
  再 `dispatchEvent(new Event('input',{bubbles:true}))`，否则 React 的 value tracker 会吞掉这次改动。
- **`localStorage` 是 per-origin**：面板里「改的颜色在别的会话没了」通常只是端口/浏览器不同。
- **`dsh plugin remove` 会残留 `node_modules/<包名>` 软链**，不影响使用。
- **`npm run check` 是本仓库唯一门禁**：语法 + 清单 + 单测。CI 跑同一份。
- **单测怎么拿到 `client.js` 的内部函数**：`tests/color.test.mjs` 在 `node:vm` 里求值，
  靠 `globalThis.__DSH_COLORIZE_TEST__ === true` 时导出的 `exports.__internals`。
  浏览器永远不会设这个标志，所以线上不多带东西；新增可测的纯函数就往那个对象里加。

## 自测要求

每修一条：**自己起实例 + 真实 DOM 事件复现 → 修 → 复测 → 把数字写进 `CHANGELOG.md`**，
控制台必须 0 error / 0 warn。验收表在 `docs/verification.md`，照抄那些规则原文来比。
未验证的事必须写明（例如「桌面壳没跑过」）。
