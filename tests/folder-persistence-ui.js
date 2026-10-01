/* Standalone browser checks using invented data; no sourcebooks required.
   NODE_PATH=/path/to/playwright/node_modules node tests/theme-edition-ui.js */
"use strict";
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const fixtures = {};
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (fixtures[pathname]) {
    res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fixtures[pathname])); return;
  }
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream"); res.end(data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  const profile = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "doxx-folder-test-"));
  try {
    browser = await chromium.launchPersistentContext(profile, { headless: true });
    let page = await browser.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { window.showDirectoryPicker = undefined; });
    const url = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(url);
    await page.locator("#data-picker").waitFor({ state: "attached" });
    const upload = async name => {
      await page.evaluate(name => {
        const transfer = new DataTransfer();
        const add = (path, content) => {
          const file = new File([JSON.stringify(content)], path.split("/").pop(), { type: "application/json" });
          Object.defineProperty(file, "webkitRelativePath", { value: "data/" + path });
          transfer.items.add(file);
        };
        add("bestiary/index.json", { TEST: "test.json" });
        add("bestiary/test.json", { monster: [{ name, source: "TEST", type: "beast", size: ["M"], ac: [12], hp: { average: 20 }, cr: "1" }] });
        const picker = document.querySelector("#data-picker");
        picker.files = transfer.files;
        picker.dispatchEvent(new Event("change", { bubbles: true }));
      }, name);
      await page.waitForFunction(() => document.querySelector("#fatal").hidden);
    };
    await upload("Saved creature");
    await page.waitForFunction(() => document.querySelector("#data-status").textContent === "Data saved in this browser");
    await page.locator("#in-name").fill("Saved creature");
    await page.locator(".result-name").filter({ hasText: "Saved creature" }).waitFor();
    await browser.close();
    browser = await chromium.launchPersistentContext(profile, { headless: true });
    page = await browser.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => { window.showDirectoryPicker = undefined; });
    await page.goto(url);
    await page.locator(".result-name").filter({ hasText: "Saved creature" }).waitFor();
    assert.equal(await page.locator("#fatal").isVisible(), false);
    assert.equal(await page.locator(".toolbar #in-2024").count(), 1);
    await page.locator("#data-change").click();
    await upload("Replacement creature");
    await page.locator("#in-name").fill("Replacement creature");
    await page.locator(".result-name").filter({ hasText: "Replacement creature" }).waitFor();
    const files = await page.evaluate(async () => {
      const saved = await loadFileIndex();
      return JSON.parse(await saved.files.get("bestiary/test.json").text()).monster.map(m => m.name);
    });
    assert.deepEqual(files, ["Replacement creature"]);
    await page.reload();
    await page.locator(".result-name").filter({ hasText: "Replacement creature" }).waitFor();
    await page.locator("#data-forget").click();
    await page.locator("#data-picker").waitFor({ state: "attached" });
    assert.equal(await page.evaluate(async () => loadFileIndex()), null);
    assert.deepEqual(errors, []);
    console.log("Folder upload, cross-page restore, replacement, forgetting, and toolbar toggle passed");
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
