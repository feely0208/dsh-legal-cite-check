import { createPlugin, pkgRootFrom } from '@deepwhale-cn/dsh-guard-core/plugin';
import { registerApi } from './api.js';

const base = createPlugin({
  name: 'legal-cite-check',
  pkgRoot: pkgRootFrom(import.meta.url),
  skillFile: 'skill/legal-cite-check.md',
  binFile: 'bin/cli.mjs',
  description: '深鲸引用核验：抽出文书里的《法名》第 N 条、法释文号、案号，核验是否失效、条号越界或需人工核验',
  whenToUse: '当用户要核验文书引用、查法条真假、检查有没有引错法条时使用：' +
    '扫描 md/txt，按随包离线索引输出 citations.csv + citations.md。',
});
export const name = base.name;
export const inject = [...base.inject, 'webServer'];
export function apply(ctx) {
  base.apply(ctx);
  try {
    if (ctx.webServer?.register) registerApi(ctx);
  } catch (e) {
    ctx.logger?.warn?.('[legal-cite-check] 面板出口注册失败: ' + (e?.message || e));
  }
}
