# @deepwhale-cn/dsh-legal-cite-check

**文书发出前，先把里面的法条逐条核一遍 —— 失效的、越界的、查不到的，直接列出来。**

关键词：引用核验 · 法条核验 · 失效法条 · 条号越界 · 案号待核 · 法律文书 · 离线

---

## 它解决什么

AI 写的法律文书最常见的硬伤不是文风，是引用：

- 还在引 2021 年就废止的《合同法》《婚姻法》《物权法》；
- 条号超出条文总数（如《民法典》第 1300 条 —— 民法典只有 1260 条）；
- 继续引已被新解释取代的旧司法解释（如法释〔2001〕14 号）；
- 案号看起来像真的，实际无法离线证实。

它把这四类里的**前三类能查的查掉**，案号一律标「需人工核验」—— 不把「没查到」说成「没问题」。

## 用法

```bash
# 单个文书
dsh-legal-cite-check 起诉状.md

# 整个目录（递归）
dsh-legal-cite-check ./案件材料 --strict

# 机器可读 / 指定输出目录
dsh-legal-cite-check 起诉状.md --json --out ./核验结果

# 内置样例
dsh-legal-cite-check --demo
```

产物：`citations.csv`（UTF-8 BOM，Excel 可直接开）、`citations.md`（汇总 + 必须处理 + 待核验 + 明细）。

### 面板

侧栏「深鲸引用核验」：填文书/目录路径 → 开始核验 → 汇总（OK / 失效 / 越界 / 待核验）+ 前 20 条问题 + 产物路径。后端未注册时面板显示错误提示，不白屏。

### 状态

| 状态 | 级别 | 含义 |
|---|---|---|
| `OUTDATED` | material | 引用了已废止的法律/解释，按 `replaced_by` 改引 |
| `OUT_OF_RANGE` | material | 条号大于条文总数 |
| `RENUMBERED` / `PENDING` / `UNKNOWN` | warn | 条文重排 / 尚未生效 / 索引未收录，需人工核 |
| `UNVERIFIED` | info | 案号或文号无法离线核验 |
| `OK` | ok | 法名与条号在索引内（**不等于适用于本案**） |

退出码：`0` 完成；`1` `--strict` 且有必须处理项；`2` 参数/路径错误。

## 数据

随包 `lib/data/`：

- `statutes-index.json`：1,513 部现行/待生效法规，含条文总数（来源 chinese-law-corpus，CC0 1.0，文本取自国家法律法规数据库）；
- `statutes.json`：失效对照（12 部旧法、4 件旧劳动争议解释）、条文重排提示、常用简称。

纯 JSON，可自行追加；不联网、不上传、不调用模型。

## 边界

- 只核验「法名 + 条号是否存在、是否失效」，**不判断是否适用于本案**；
- 不核验案例内容真伪；
- 只读 `.md` / `.txt`，`.docx` 请先转文本；
- 结果不构成法律意见，正式提交前须由承办律师核对 flk.npc.gov.cn 原文。

## 安装

```bash
dsh plugin --profile web add @deepwhale-cn/dsh-legal-cite-check
```

## 测试

```bash
bash tests/run.sh
```

## License

MIT © 深鲸 DeepWhale

<p align="right"><a href="https://deepwhale.org.cn"><img src="https://www.deepwhale.org.cn/images/badge/deepwhale-badge.png" alt="powered by dwh" height="20"></a></p>
