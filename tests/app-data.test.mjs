import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = {
  window: { APP_CONFIG: {} },
  document: { createElement: () => ({ click() {} }) },
  URL: globalThis.URL,
  Blob: class {},
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(join(root, "js/app-data.js"), "utf8"), sandbox);
const AppData = sandbox.window.AppData;

assert.equal(AppData.EVENT_LEVEL_POINTS.межрегиональный, 500);
assert.equal(AppData.EVENT_LEVEL_POINTS.региональный, 500);
assert.equal(AppData.isAllowedChatUrl("https://vk.me/join/test"), true);
assert.equal(AppData.isAllowedChatUrl("https://example.com/x"), false);

const cleaned = AppData.cleanupOrphanEnrollments(
  [
    { eventId: "a", userId: 1 },
    { eventId: "b", userId: 2 },
  ],
  [{ id: "a" }]
);
assert.equal(cleaned.length, 1);

console.log("app-data.test.mjs: OK");
