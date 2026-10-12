/**
 * dsh-colorize — Host half.
 *
 * There is nothing to do on the Host side: picking elements, computing selectors
 * and stacking token overrides all happen in the browser, through the official
 * Client `slots` / `theme` / `locale` services. This row exists so the package is
 * an ordinary bundle entry that Plugin Manager can list, enable and disable.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.effect(() => () => {}, 'dsh-colorize: host half is inert')
}
