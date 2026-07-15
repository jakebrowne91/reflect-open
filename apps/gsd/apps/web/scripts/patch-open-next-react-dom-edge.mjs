import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const handlerPath = path.join(
  appDir,
  ".open-next/server-functions/default/apps/web/handler.mjs",
);

if (!existsSync(handlerPath)) {
  throw new Error(`OpenNext handler not found at ${handlerPath}`);
}

const source = readFileSync(handlerPath, "utf8");
const browserModuleMatch = source.match(
  /"react-dom\/server\.browser":function\([^)]*\)\{"use strict";[^=]+\.exports=(require_[A-Za-z0-9_$]+)\(\)\}/,
);
const edgeModuleMatch = source.match(
  /("react-dom\/server\.edge":function\([^)]*\)\{"use strict";[^=]+\.exports=)(require_[A-Za-z0-9_$]+)(\(\)\})/,
);

if (!browserModuleMatch?.[1] || !edgeModuleMatch?.[1] || !edgeModuleMatch[3]) {
  throw new Error("Could not locate ReactDOM server module mappings");
}

if (edgeModuleMatch[2] === browserModuleMatch[1]) {
  console.log("OpenNext ReactDOM server mapping already patched");
  process.exit(0);
}

const patched = source.replace(
  edgeModuleMatch[0],
  `${edgeModuleMatch[1]}${browserModuleMatch[1]}${edgeModuleMatch[3]}`,
);

if (patched === source) {
  throw new Error("OpenNext ReactDOM server mapping patch made no changes");
}

writeFileSync(handlerPath, patched);
console.log("Patched OpenNext ReactDOM server mapping for React 18");
