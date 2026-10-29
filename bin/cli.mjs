#!/usr/bin/env node
/**
 * dsh-legal-cite-check —— 法律文书引用核验（离线）
 *
 * 用法：
 *   dsh-legal-cite-check <文书或目录> [--strict] [--json] [--out 输出目录]
 *   dsh-legal-cite-check --demo [--json]
 *
 * 退出码：
 *   0  核验完成，无 material 级问题（或未加 --strict）
 *   1  --strict 且存在失效/越界等必须处理项
 *   2  参数错误 / 路径不存在 / 没有可核验的文本
 */
import { runJson, run } from '../lib/core.mjs';

const args = process.argv.slice(2);
const has = (k) => args.includes('--' + k);
const val = (k, d = '') => {
  const i = args.indexOf('--' + k);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};

if (has('help') || (!args.length && process.stdin.isTTY)) {
  console.log(`dsh-legal-cite-check —— 深鲸引用核验

用法：
  dsh-legal-cite-check <文书.md|目录> [--strict] [--json] [--out 目录]
  dsh-legal-cite-check --demo [--json]

选项：
  --strict   存在失效法条 / 条号越界时退出码 1（可挂 CI）
  --json     输出机器可读 JSON
  --out DIR  指定输出目录（默认：文书旁的「引用核验/」）
  --demo     用内置样例跑一遍，不读外部文件

产物：citations.csv（Excel 可开）、citations.md（人看的报告）
只核验离线索引能证实的事实；索引未收录 = 需人工核验，不是「通过」。`);
  process.exit(0);
}

const positional = (() => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') { i++; continue; }
    if (!args[i].startsWith('--')) return args[i];
  }
  return '';
})();
const opts = {
  input: positional || '',
  out: val('out', ''),
  demo: has('demo'),
  strict: has('strict'),
};

const r = has('json') ? runJson(opts) : run(opts);
if (!r.ok) {
  console.error('❌ ' + (r.text || '核验失败'));
  process.exit(2);
}

if (has('json')) console.log(JSON.stringify(r, null, 2));
else console.log(r.text || '');

if (has('strict') && r.summary && r.summary.material > 0) process.exit(1);
process.exit(0);
