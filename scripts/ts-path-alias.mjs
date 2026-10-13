/**
 * 让 `scripts/*.ts` 能用 Node 自带的类型剥离（--experimental-strip-types）直接运行。
 *
 * 为什么需要它：
 *   项目里的 TS 用 `@/` 别名 + 无扩展名导入（Next/tsc 都能解析），
 *   但 Node 的 ESM 解析器既不认别名、也不给无扩展名补 `.ts`。
 *   这里注册一个极简 resolve 钩子把这两件事补上，**不改动任何应用代码**，
 *   也不必为了跑一个运维脚本而引入 tsx / ts-node 之类的额外依赖。
 *
 * 用法（在 FoloUp 目录下）：
 *   node --experimental-strip-types --import ./scripts/ts-path-alias.mjs scripts/retention-cleanup.ts --help
 *
 * ⚠️ 只对「我们自己写的 .ts 源码」生效：
 *    node_modules 里的包（例如 better-sqlite3 的 CJS 内部 require('./database')）
 *    必须原样交给 Node 默认解析 —— 否则补成 `database.ts` 会直接找不到模块。
 * ⚠️ 只能解析「可擦除语法」的 TS（不能有 enum / namespace / 参数属性）。
 *    本文件不参与 Next 构建，也不在 tsconfig 的 include 列表里（只收 .ts/.tsx）。
 */
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC_DIR = path.join(process.cwd(), "src");
const RESOLVED_EXT = /\.(ts|tsx|js|mjs|cjs|json)$/;
const EXTENSIONLESS_RELATIVE = /^\.\.?(\/|$)/;

function isOwnTsSource(parentUrl) {
  return parentUrl.endsWith(".ts") && !parentUrl.includes("/node_modules/");
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!isOwnTsSource(context.parentURL ?? "")) {
      return nextResolve(specifier, context);
    }

    let target = null;

    if (specifier.startsWith("@/")) {
      target = pathToFileURL(path.join(SRC_DIR, specifier.slice(2))).href;
    } else if (EXTENSIONLESS_RELATIVE.test(specifier) && context.parentURL) {
      target = new URL(specifier, context.parentURL).href;
    }

    if (target && !RESOLVED_EXT.test(target)) {
      target = `${target}.ts`;
    }

    return nextResolve(target ?? specifier, context);
  },
});
