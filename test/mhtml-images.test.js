import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { renderMhtml } from "../src/formats/mhtml.js";
import { createDocumentCache, documentIdentity } from "../src/cache.js";
import { readDocument } from "../src/services/items.js";
import { withTempFixture } from "./helpers/fixture.js";
import { IMAGE_BASE64, IMAGE_LOCATION, mhtmlWithImage } from "./helpers/mhtml-image.js";

for (const entity of ["&amp;", "&#38;", "&#x26;", "&"]) {
  test("MHTML matches archived images when HTML query separators use " + entity, () => {
    const reference = IMAGE_LOCATION.replaceAll("&", entity);
    const output = renderMhtml(Buffer.from(mhtmlWithImage("离线图片", '<img alt="保存的图片" src="' + reference + '">')));
    const document = new JSDOM(output).window.document;
    assert.equal(document.querySelector("img").src, "data:image/png;base64," + IMAGE_BASE64);
    assert.equal(document.querySelector("img").alt, "保存的图片");
  });
}

test("MHTML embeds image URLs in HTML-escaped inline CSS without breaking attribute quotes", () => {
  const reference = IMAGE_LOCATION.replaceAll("&", "&amp;");
  const output = renderMhtml(Buffer.from(mhtmlWithImage("背景图片", '<div id="banner" style="background-image: url(&quot;' + reference + '&quot;); color: red">背景</div>')));
  const banner = new JSDOM(output).window.document.querySelector("#banner");
  assert.match(banner.style.backgroundImage, /^url\("?data:image\/png;base64,/);
  assert.equal(banner.style.color, "red");
  assert.equal(banner.attributes.length, 2);
});

test("MHTML leaves unrelated markup and unavailable external images unchanged", () => {
  const body = '<img alt="A &amp; B" src="https://missing.example.test/not-in-archive.png?a=1&amp;b=2"><div style="color: red">保留样式</div>';
  const output = renderMhtml(Buffer.from(mhtmlWithImage("未保存的图片", body)));
  assert.ok(output.includes(body));
});

test("MHTML renderer updates bypass stale document caches and old ETags automatically", async () => {
  await withTempFixture(async directory => {
    const buffer = Buffer.from(mhtmlWithImage("旧缓存中的图片"));
    const source = { buffer, path: "/source/archive.mhtml", stat: { dev: 1, ino: 2, size: buffer.length, mtimeMs: 3 } };
    const library = { getItem: () => ({ mhtml: {} }), readSource: async () => source };
    const cache = createDocumentCache({ directory });
    const oldKey = documentIdentity({ itemId: "mhtml-item", format: "mhtml", path: source.path, stat: source.stat });
    await cache.getOrCreate(oldKey, () => "stale-renderer-output", { itemId: "mhtml-item" });
    const response = await readDocument({ library, cache, id: "mhtml-item", action: "original", ifNoneMatch: '"' + oldKey + '"' });
    assert.equal(response.status, 200);
    assert.notEqual(response.headers.etag, '"' + oldKey + '"');
    assert.equal(new JSDOM(response.body).window.document.querySelector("img").src, "data:image/png;base64," + IMAGE_BASE64);
    const unchanged = await readDocument({ library, cache, id: "mhtml-item", action: "document", ifNoneMatch: response.headers.etag });
    assert.equal(unchanged.status, 304);
  });
});
