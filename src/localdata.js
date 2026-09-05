/* ============================================================
   Loading the bestiary from a folder the user drops in, instead of a server.

   WHY THIS EXISTS. Hosted somewhere like GitHub Pages, there is no `data/` to
   fetch — nothing from 5e.tools is committed to this repo, on purpose (see
   DESIGN.md, "What may be committed"), so a public deploy ships the empty
   shell only. This is the other half of that design: instead of every visitor
   needing to run their own local server, they hand the app their own copy of
   5e.tools' `data/` folder directly in the browser, via drag-and-drop or a
   folder picker. Nothing here ever leaves the browser — there is no upload,
   no server-side code at all, just FileReader over local files.

   WHAT THE APP ACTUALLY NEEDS. app.js's loader asks for paths like
   "data/bestiary/index.json" or "data/spells/index.json" — the same shape
   whether they came from `fetch()` or from a dropped folder. The one thing
   that varies is what the user actually dragged in: 5e.tools' `data/` folder
   itself, a whole checkout of 5e.tools' repo (which contains `data/` alongside
   a dozen other folders), or their own differently-named copy of just the
   bestiary files. `normalizeRelPath` below is the one function that makes all
   three land on the same keys, so the rest of the loader never has to care
   which one it got.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* A dropped item's path always includes the thing the user actually picked as
     its first segment — "data/bestiary/index.json" if they dragged 5e.tools'
     `data` folder, "5etools-src/data/bestiary/index.json" if they dragged the
     whole checkout, "MyExport/bestiary/index.json" if they dragged a renamed
     folder of just the bestiary files. Slicing at the outermost "data" segment
     handles the first two; falling back to "drop the wrapper's own name"
     handles the third, since a folder with no "data" anywhere in it must BE
     the data folder as far as this app is concerned. */
  function normalizeRelPath(path) {
    const parts = String(path).split("/").filter(Boolean);
    const i = parts.indexOf("data");
    if (i >= 0 && i < parts.length - 1) return parts.slice(i + 1).join("/");
    return parts.slice(1).join("/");
  }

  /* { path, file } pairs -> a lookup keyed by the same normalized shape
     getJson's callers already use. Later entries win on a collision, which
     only matters if the user drops the same folder twice; harmless either way. */
  function buildFileIndex(pairs) {
    const map = new Map();
    (pairs || []).forEach(p => {
      if (p && p.file) map.set(normalizeRelPath(p.path), p.file);
    });
    return map;
  }

  // The one thing a real File and the mocks in this file's tests both need.
  const readJsonFile = file => file.text().then(t => JSON.parse(t));

  /* A picked <input webkitdirectory>'s FileList: every File already carries
     its path from the picked root in .webkitRelativePath. */
  function pairsFromFileList(fileList) {
    return Array.from(fileList || []).map(f => ({ path: f.webkitRelativePath || f.name, file: f }));
  }

  /* A dropped folder's DataTransfer. Directories only show up through the
     (nonstandard but universally supported) webkitGetAsEntry() API, which
     means walking the tree by hand: readEntries() has to be called repeatedly
     until it returns empty, because browsers page large directories rather
     than returning everything in one call. */
  function walkEntry(entry, base) {
    return new Promise(resolve => {
      if (!entry) { resolve([]); return; }
      if (entry.isFile) {
        entry.file(file => resolve([{ path: base + entry.name, file }]));
        return;
      }
      if (!entry.isDirectory) { resolve([]); return; }
      const reader = entry.createReader();
      const nested = [];
      const readBatch = () => {
        reader.readEntries(batch => {
          if (!batch.length) {
            Promise.all(nested).then(lists => resolve(lists.flat()));
            return;
          }
          batch.forEach(e => nested.push(walkEntry(e, base + entry.name + "/")));
          readBatch();
        }, () => resolve([]));
      };
      readBatch();
    });
  }

  async function pairsFromDataTransfer(dataTransfer) {
    const items = Array.from((dataTransfer && dataTransfer.items) || []).filter(i => i.kind === "file");
    const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    const lists = await Promise.all(entries.map(e => walkEntry(e, "")));
    return lists.flat();
  }

  return { normalizeRelPath, buildFileIndex, readJsonFile, pairsFromFileList, pairsFromDataTransfer };
});
