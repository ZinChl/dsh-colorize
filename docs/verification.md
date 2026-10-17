# 验证记录与复现方法

这个插件没有「单元测试全绿 = 能发」的奢侈：真正会坏的地方在浏览器里（React 的受控输入、top layer、
真实指针事件、主题层）。所以验证分三层，缺一层就会漏掉一类 bug。

## 第 0 层：离线门禁（CI 每次都跑）

```bash
npm run check          # 语法 + 清单校验 + 单测
npm run check:manifest # 只跑清单
npm test               # 只跑单测（9 个，纯颜色数学）
```

清单校验拦的是「发版必踩」的那一类：`client.js` 的 `VERSION` 与 `package.json` 不一致（面板标题会撒谎）、
locale 两份键不对应、`files` 漏了某个文件、patch 行 id/name 写错、以及零轮询回归。

## 第 1 层：浏览器脚本化验收（每个版本都做）

真实实例 + 真实 DOM 事件。**不要用「看一眼截图」代替**：这一层的价值在于拿到规则原文。

### 起一个临时实例（不要动用户正在跑的那个）

```bash
(dsh --profile web --port 0 --no-open > /tmp/cz.log 2>&1 &)
sleep 14
grep -oE "http://127\.0\.0\.1:[0-9]+/\?[^ ]*" /tmp/cz.log | head -1
```

拿到带 token 的 URL 后交给浏览器自动化（本项目用 winchrome）：

1. 打开该 URL，等 `window.__dshColorize` 出现。
2. `window.__dshColorize.state()` 应该返回 `{ version: '<package.json version>', ... }`；`modules` 必须是 1
   （`>1` = 客户端包被加载了两份，界面和 console API 会分属两个 store）。
3. `window.__dshColorize.open()` 进拾色；派发一个 `click` 到目标元素上选中它。
4. **交互细节用脚本，不用截图**：React 受控输入必须走原生 value setter：

```js
const setNative = (el, value, blur) => {
  el.focus()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(value))
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  if (blur) el.blur()
}
```

5. 每次操作后读**规则原文**，别读界面文字：

```js
document.getElementById('dsh-colorize-overrides').textContent
localStorage.getItem('dsh-colorize:v1')
```

6. 结束时 `window.__dshColorize.clear()` 清掉测试数据，`kill` 掉临时实例，删掉 `/tmp/cz.log`。
7. 控制台必须 **0 error / 0 warn**。

### 验收表（0.5.3 实测值，回归时照抄）

| 操作 | 期望（规则原文 / 字段值） |
| --- | --- |
| 行内不透明度填 40 | `color: rgba(173, 178, 184, 0.4) !important`；行内显示 `#adb2b866` / `40`；色块计算值 `rgba(173, 178, 184, 0.4)` |
| 再填 6 位 hex `#22a2b8` | `rgba(34, 162, 184, 0.4)` —— alpha 保留 |
| 填 8 位 hex `#22a2b880` | `rgba(34, 162, 184, 0.502)`；行内 `#22a2b880` / `50` |
| 混合器 A 拖到 60，再拖 R 到 200 | `rgba(200, 162, 184, 0.6)` |
| **编辑器开着时**行内改 70%，再拖 R | `rgba(20, 178, 184, 0.7)`，编辑器 A 滑杆同步 70% |
| 调色盘（系统取色器）/ 预设 / 编辑器 hex `#f0a` | alpha 全部保持 0.6 |
| 「应用」→ 重新拾取 | 行内 `#22a2b8b3` / `70` |
| 「取消」 | 精确回到打开编辑器前的值 |
| 语义色行内不透明度填 25 | token `rgba(0, 0, 0, 0.25)`；`getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base')` 同步 |
| 应用范围切到「含后代 / 同类」 | 规则搬到新选择器，旧 id 消失，只有一个规则 |

### 背景行（0.5.4 起，回归必测）

用一个**自己透明、子元素也不铺满**的容器（会话滚动区就是）：

| 操作 | 期望（0.5.4 实测值） |
| --- | --- |
| 拾取它 | 行里必须有 `背景 · 当前透明`（以及可能的 `背景 · 祖先 <tag.class>`）—— **绝不出现「只有文字一行」** |
| 在「当前透明」行输入 6 位 hex `#123456` | 规则 `div.<scroll> { background-color: #123456 !important; }`；`getComputedStyle(el).backgroundColor` = `rgb(18, 52, 86)`（不是 `rgba(...,0)`）；行内显示 `#123456 / 100` |
| 从「当前透明」行打开编辑器 | 起手 `R=18 G=52 B=86 A=100%`；拖 R 到 90 → `rgb(90, 52, 86)` |
| 在「祖先」行改 `#3fa46a` | 规则落在祖先选择器上（实测 `[data-phase="hero"]`），祖先计算值 `rgb(63, 164, 106)`，被点的元素保持透明 |
| 自己画背景的元素（如 `div.<x>_root`） | 只有一行 `背景`，不会多出「当前透明」 |
| 透明容器 + 铺满且上色的子元素 | 出现 `背景 · 子元素 div.<x>_card`（旧优先级没被破坏） |

### 目标（选择器）手动重匹配（0.5.5 起，回归必测）

面板的 `目标` 是输入框（`.dscz-target`）。用原生 value setter 改值后 `blur()`（等价于回车 / 离开输入框）：

| 输入 | 期望（0.5.5 实测值） |
| --- | --- |
| `.wSkVaW_root` | `state().selected.selector` 变成 `.wSkVaW_root`、`匹配 1 个`、行重检；在该行改背景 → 规则 `.wSkVaW_root { background-color: #123456 !important; }`，祖先算得 `rgb(18, 52, 86)` |
| `button` | `匹配 38 个`，行按第一个按钮重检（规则作用于整批） |
| `div[` | 输入框 `.dscz-target-bad` + `选择器语法无效`；`selected.selector` 不变 |
| `.definitely-not-here` | `没有元素匹配这个选择器`；选择不变 |
| `   `（空白） | `选择器不能为空`；选择不变 |
| 输入框里按 `Esc` | 文本还原成当前选择器，**面板仍打开** |
| 输入框外按 `Esc` | 面板关闭，`selected = null` |

### 面板不出屏幕（0.5.5 起，贴边取色必测）

| 操作 | 期望（0.5.5 实测值） |
| --- | --- |
| 拾取贴视口底部的元素（如侧边栏底部按钮组） | 面板矩形完全在视口内 |
| 再打开 `调色盘` | 面板自动上移，仍完全在内，编辑器可见（0.5.4：bottom 超出 136px） |
| 把视口压到 320px 宽（DevTools device 或 `emulate`） | 面板宽度收到 `视口-16`，`[8, 8, 312, 452]`，内部可滚动，无横向溢出 |
| 面板开着时拉动窗口 / 滚动页面 | 面板跟随元素，且始终在视口内 |

### 拾色性能

`window.__dshColorize.pickPerf()` 不是 API；性能用 DevTools Performance 面板量：
拾色模式下 3 秒内 `elementsFromPoint` 调用数必须是 **0**，rAF 回调 ≤ 每帧 1 次。

## 第 2 层：真机体验（发版前至少一次）

脚本测不出「手感」：鼠标划过时高亮是否跟手、退出后有没有残留、面板会不会被设置弹窗盖住、
快捷键在真实 IME 下会不会被吞。发版前请在真实实例里点一遍：

1. 设置 → 常规 →「自定义色彩」→ 开始拾色（不依赖快捷键）。
2. 悬停几个元素 → 单击选中 → 改色 → 应用 → 面板与高亮框一起消失。
3. 打开设置弹窗，再拾色 —— 面板必须在弹窗**之上**。
4. 设置 → 常规 → 快捷键里能看到 `colorize.pick`，改键后本插件的录制框显示同一组合。

## 已知没测到的部分

* 桌面壳（`dsh.client.platform: web` 之外的宿主）没跑过，manifest 里也只声明 web。
* 触屏 / 手写笔没有专门验证；拾色只用了 pointer 事件。
* 深色/浅色两套主题下的截图对比没有自动化，只人工看过。
