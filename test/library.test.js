import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rename, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { testTrashService } from "./helpers/fixture.js";
import { createLibrary } from "../src/library.js";

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-"));
  await mkdir(path.join(root, "nested"));
  await writeFile(
    path.join(root, "统一入口.html"),
    "<!doctype html><html><head><title>统一入口</title></head><body><h1>本地知识库</h1><p>扫描和搜索说明</p></body></html>",
  );
  await writeFile(
    path.join(root, "统一入口.md"),
    "# 统一入口\n\n这里介绍如何搜索本地知识库。",
  );
  await writeFile(
    path.join(root, "nested", "only-markdown.md"),
    "# 只有 Markdown\n\n这是一份嵌套笔记。",
  );
  await writeFile(path.join(root, "ignored.txt"), "不应被索引");
  return root;
}

function mhtmlFixture() {
  return [
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="mhtml-boundary"',
    '',
    '--mhtml-boundary',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<!doctype html><html><head><title>MHTML 示例</title></head><body><h1>离线页面</h1><p>内嵌资源索引测试</p></body></html>',
    '--mhtml-boundary--',
    '',
  ].join('\r\n');
}

test("scan merges matching HTML and Markdown files into one item", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });

  const result = await library.scan();
  assert.equal(result.items.length, 2);

  const paired = result.items.find((item) => item.relativePath === "统一入口");
  assert.ok(paired);
  assert.equal(paired.title, "统一入口");
  assert.equal(paired.html.extension, ".html");
  assert.equal(paired.markdown.extension, ".md");
  assert.match(paired.snippet, /本地知识库|搜索本地知识库/);

  const markdownOnly = result.items.find((item) => item.relativePath === "nested/only-markdown");
  assert.ok(markdownOnly);
  assert.equal(markdownOnly.html, null);
  assert.equal(markdownOnly.markdown.extension, ".md");
});

test("scan indexes MHTML and extracts its embedded HTML for title and search", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-mhtml-"));
  await writeFile(path.join(root, "离线页面.mhtml"), mhtmlFixture());
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "离线资料" }] });

  const result = await library.scan();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].mhtml.extension, ".mhtml");
  assert.equal(result.items[0].html, null);
  assert.equal(result.items[0].title, "MHTML 示例");
  assert.match(result.items[0].snippet, /离线页面|内嵌资源索引测试/);
  assert.equal(library.search("内嵌资源").length, 1);
});

test("readSource returns the original MHTML archive", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-mhtml-source-"));
  const content = mhtmlFixture();
  await writeFile(path.join(root, "离线页面.mht"), content);
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "离线资料" }] });
  await library.scan();

  const item = library.search()[0];
  const source = await library.readSource(item.id, "mhtml");
  assert.equal(source.fileName, "离线页面.mht");
  assert.equal(source.contentType, 'multipart/related; type="text/html"; boundary="mhtml-boundary"');
  assert.equal(source.content.toString("utf8"), content);
});

test("search matches title, path, and body content", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();

  assert.equal(library.search("本地知识库").length, 1);
  assert.equal(library.search("nested").length, 1);
  assert.equal(library.search("ONLY MARKDOWN").length, 1);
  assert.equal(library.search("没有这个词").length, 0);
});

test("readSource rejects paths outside the configured root", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();

  const item = library.search("统一入口")[0];
  await assert.rejects(
    library.readSource(item.id, "html", "../outside.html"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
});

test("readSource rejects a source file replaced by a symlink outside the root", async () => {
  const root = await createFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "html-library-outside-"));
  const outsideFile = path.join(outside, "secret.md");
  const sourceFile = path.join(root, "统一入口.md");
  await writeFile(outsideFile, "# 不应被读取");
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();
  await unlink(sourceFile);
  await symlink(outsideFile, sourceFile);

  const item = library.search("统一入口")[0];
  await assert.rejects(
    library.readSource(item.id, "markdown"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
});

test("readSource rejects unknown formats and files removed after scanning", async () => {
  const root = await createFixture();
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();
  const item = library.search("统一入口")[0];

  await assert.rejects(
    library.readSource(item.id, "toString"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
  await unlink(path.join(root, "统一入口.html"));
  await assert.rejects(
    library.readSource(item.id, "html"),
    (error) => error.code === "SOURCE_NOT_FOUND",
  );
});

test("deleteItem moves all source files to trash and removes the index entry", async () => {
  const root = await createFixture();
  const library = createLibrary({ trashService: testTrashService, roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();

  const item = library.search("统一入口")[0];
  await library.deleteItem(item.id);

  await assert.rejects(access(path.join(root, "统一入口.html")), { code: "ENOENT" });
  await assert.rejects(access(path.join(root, "统一入口.md")), { code: "ENOENT" });
  await access(path.join(root, "统一入口.html.trashed-test"));
  assert.equal(library.search("统一入口").length, 0);
});

test("deleteItem refuses a source path replaced by an outside symlink", async () => {
  const root = await createFixture();
  const outside = await mkdtemp(path.join(os.tmpdir(), "html-library-delete-outside-"));
  const outsideFile = path.join(outside, "secret.md");
  const sourceFile = path.join(root, "统一入口.md");
  await writeFile(outsideFile, "# 不应被删除");
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "我的对话" }] });
  await library.scan();
  await unlink(sourceFile);
  await symlink(outsideFile, sourceFile);

  const item = library.search("统一入口")[0];
  await assert.rejects(library.deleteItem(item.id), (error) => error.code === "SOURCE_NOT_FOUND");
  await access(outsideFile);
});

test("scan chooses .html deterministically when a stem has duplicate HTML formats", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-duplicate-"));
  await writeFile(path.join(root, "same.html"), "<title>优先 HTML</title>");
  await writeFile(path.join(root, "same.htm"), "<title>不应优先</title>");
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "重复测试" }] });

  const result = await library.scan();
  assert.equal(result.items[0].html.extension, ".html");
  assert.equal(result.items[0].title, "优先 HTML");
  assert.match(result.errors[0].message, /重复/);
});

test("a scan queued after removing a root cannot be overwritten by the earlier scan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "html-library-slow-"));
  await Promise.all(
    Array.from({ length: 1200 }, (_, index) =>
      writeFile(path.join(root, `item-${index}.md`), `# item ${index}\n`),
    ),
  );
  const library = createLibrary({ roots: [{ id: "root-a", path: root, label: "临时目录" }] });
  const firstScan = library.scan();
  await new Promise((resolve) => setImmediate(resolve));
  await library.removeRoot("root-a");
  const secondScan = library.scan();
  await Promise.all([firstScan, secondScan]);

  assert.equal(library.search().length, 0);
});

test('incremental scans reuse unchanged metadata and full scans reread', async()=>{
 const root=await createFixture();let reads=0;const library=createLibrary({roots:[{id:'a',path:root}],scanFile:async()=>{reads++;return {title:'spy',bodyText:'content'};}});await library.scan();assert.equal(reads,3);reads=0;await library.scan();assert.equal(reads,0);await library.scan({full:true});assert.equal(reads,3);assert.equal(library.getSnapshot().items.some(item=>item.sourceFiles.some(source=>Object.hasOwn(source,'content') || Buffer.isBuffer(source.buffer))),false);
});
test('legacy NFD stems retain v1 item ids and memory feedback persists on next mutation',async()=>{
 const {createConfigStore}=await import('../src/config.js'),{createRootRegistry}=await import('../src/roots.js'),{withTempFixture}=await import('./helpers/fixture.js'),{readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto');await withTempFixture(async directory=>{const root=path.join(directory,'source');await mkdir(root);await writeFile(path.join(root,'cafe\u0301.md'),'# Café');const store=createConfigStore({dataDir:directory});await writeFile(path.join(directory,'config.json'),JSON.stringify({roots:[{id:'old',path:root}]}));const registry=createRootRegistry({configStore:store});await registry.load();const library=createLibrary({rootRegistry:registry});await library.scan();const {readdir}=await import('node:fs/promises');const raw=(await readdir(root))[0].slice(0,-3);const oldId='old:'+createHash('sha1').update(raw).digest('hex').slice(0,12);assert.equal(library.search()[0].id,oldId);await registry.applyChange({type:'patch',id:'old',input:{label:'updated'}});assert.equal(JSON.parse(await readFile(path.join(directory,'config.json'),'utf8')).roots[0].options.idAlgo,'v1');});
});
test('legacy fixture retains all ids and ownership goes 48 to 40+8 to 48',async()=>{
 const {createConfigStore}=await import('../src/config.js'),{createRootRegistry}=await import('../src/roots.js'),{withTempFixture,createLegacyFixture}=await import('./helpers/fixture.js');await withTempFixture(async directory=>{const fixture=await createLegacyFixture(directory);const registry=createRootRegistry({configStore:createConfigStore({dataDir:fixture.dataDir})});await registry.load();const library=createLibrary({rootRegistry:registry});await library.scan();assert.deepEqual(library.search().map(x=>x.id).sort(),fixture.expectedItemIds);assert.deepEqual(library.getSnapshot().series.map(x=>x.total).sort((a,b)=>b-a),[10,9,6,6,4,3,2]);const {root}=await registry.applyChange({type:'add',input:{path:path.join(fixture.rootPath,'腾讯云ADP-FDE认证课程')}});await library.scan();assert.equal(library.search('',{rootId:fixture.rootId}).length,40);assert.equal(library.search('',{rootId:root.id}).length,8);await registry.applyChange({type:'remove',id:root.id});await library.scan();assert.equal(library.search().length,48);});
});
test('a stale delayed scan cannot resurrect a trashed item',async()=>{const root=await createFixture();let gate,release,slow=false;const library=createLibrary({roots:[{id:'a',path:root}],trashService:testTrashService,scanFile:async()=>{if(slow){gate=new Promise(resolve=>release=resolve);await gate;}return{title:'item',bodyText:'text'};}});assert.equal(typeof library.getSnapshot,'function');await library.scan();slow=true;const scanning=library.scan({full:true});while(!release)await new Promise(r=>setImmediate(r));const id=library.search().find(x=>x.html).id;await library.trashItem(id);slow=false;release();await scanning;assert.equal(library.getItem(id),null);});
