import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { testTrashService } from "./helpers/fixture.js";
import { createServer } from "../src/server.js";

async function withServer(callback) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-data-"));
  const sourceDir = await mkdtemp(path.join(os.tmpdir(), "html-library-source-"));
  await writeFile(
    path.join(sourceDir, "远程阅读.html"),
    "<html><head><title>远程阅读</title></head><body><p>这是 API 搜索内容。</p></body></html>",
  );
  const server = createServer({ dataDir, trashService: testTrashService });
  await server.ready;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = "http://127.0.0.1:" + address.port;
  try {
    await callback({ baseUrl, sourceDir, server });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function withConfiguredServer(options, callback) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-auth-data-"));
  const server = createServer({ dataDir, ...options });
  await server.ready;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = "http://127.0.0.1:" + server.address().port;
  try {
    await callback({ baseUrl });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function mhtmlFixture() {
  return [
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; type="text/html"; boundary="mhtml-boundary"',
    '',
    '--mhtml-boundary',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    'Content-Location: http://example.test/index.html',
    '',
    '<html><head><title>MHTML 服务</title></head><body><p>通过服务读取。</p><img src="cid:image@example.test"></body></html>',
    '--mhtml-boundary',
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    'Content-Location: http://example.test/image.png',
    'Content-ID: <image@example.test>',
    '',
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64'),
    '--mhtml-boundary--',
    '',
  ].join('\r\n');
}

async function jsonRequest(baseUrl, route, options = {}) {
  const response = await fetch(baseUrl + route, {
    ...options,
    headers: { "content-type": "application/json", origin: baseUrl, ...(options.headers || {}) },
  });
  const body = await response.json();
  if (options.method === 'POST' && route === '/api/roots' && response.status === 201) { while (true) { const status = await (await fetch(baseUrl+'/api/scan/status')).json(); if (!status.running.length && !status.queued.length) break; } }
  return { response, body };
}

test("API adds a root, scans it, searches it, and reads its source", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir, label: "API 样例" }),
    });
    assert.equal(added.response.status, 201);
    assert.ok(added.body.scan.queued.length);
    assert.equal((await (await fetch(baseUrl + "/api/roots")).json()).totals.items, 1);

    const library = await jsonRequest(baseUrl, "/api/items?q=API%20搜索");
    assert.equal(library.response.status, 200);
    assert.equal(library.body.items.length, 1);
    const item = library.body.items[0];

    const source = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/source/html");
    assert.equal(source.status, 200);
    assert.equal(source.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await source.text(), /远程阅读/);
  });
});

test("API opens MHTML as HTML and keeps the original archive for download", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const content = mhtmlFixture();
    await writeFile(path.join(sourceDir, "离线页面.mhtml"), content);
    const added = await jsonRequest(baseUrl, "/api/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir, label: "MHTML" }),
    });
    const indexed = (await jsonRequest(baseUrl, "/api/items")).body;
    assert.equal(indexed.items.length, 2);
    const item = indexed.items.find((entry) => entry.mhtml);
    assert.equal(item.title, "MHTML 服务");

    const source = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/source/mhtml");
    assert.equal(source.status, 200);
    assert.equal(source.headers.get("content-type"), "text/html; charset=utf-8");
    const rendered = await source.text();
    assert.match(rendered, /MHTML 服务/);
    assert.match(rendered, /data:image\/png;base64,/);
    assert.doesNotMatch(rendered, /multipart\/related|mhtml-boundary/);

    const download = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/download/mhtml");
    assert.equal(download.headers.get("content-type"), 'multipart/related; type="text/html"; boundary="mhtml-boundary"');
    assert.match(await download.text(), /MHTML 服务/);

    const htmlRecords = await jsonRequest(baseUrl, "/api/items?fmt=html");
    assert.equal(htmlRecords.body.items.some((entry) => entry.id === item.id), true);
  });
});

test("API rejects invalid roots and unknown source formats", async () => {
  await withServer(async ({ baseUrl }) => {
    const invalid = await jsonRequest(baseUrl, "/api/roots", {
      method: "POST",
      body: JSON.stringify({ path: path.join(os.tmpdir(), "does-not-exist") }),
    });
    assert.equal(invalid.response.status, 400);
    assert.match(invalid.body.error.message, /目录|路径/);

    const unknown = await fetch(baseUrl + "/api/items/nope/source/html");
    assert.equal(unknown.status, 404);
  });
});

test("serves the unified library app shell", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /我的对话库/);
    assert.doesNotMatch(html, /itemDialog|打开记录/);
    const app = await (await fetch(baseUrl + "/assets/js/main.js")).text();
    assert.match(app, /mountReader/);
    assert.equal((await fetch(baseUrl + "/assets/app.js")).status, 404);
  });
});

test("API removes a root without touching its source files", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir, label: "待移除" }),
    });
    const rootId = added.body.root.id;
    const removed = await fetch(baseUrl + "/api/roots/" + encodeURIComponent(rootId), { method: "DELETE", headers: { origin: baseUrl, "content-type": "application/json" }, body: "{}" });
    assert.equal(removed.status, 200);
    const settings = await (await fetch(baseUrl + "/api/roots")).json();
    assert.equal(settings.roots.length, 0);
    assert.equal((await (await fetch(baseUrl + "/api/items")).json()).items.length, 0);
  });
});

test("API deletes a record's source file and index entry", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir, label: "待删除" }),
    });
    const item = (await jsonRequest(baseUrl, "/api/items")).body.items[0];
    const deleted = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/trash", { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" }, body: "{\"confirm\":true}" });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).trashed.length, 1);
    await assert.rejects(access(path.join(sourceDir, "远程阅读.html")), { code: "ENOENT" });
    assert.equal((await (await fetch(baseUrl + "/api/items")).json()).items.length, 0);
  });
});

test("protected servers reject unauthenticated requests and support token bootstrap", async () => {
  await withConfiguredServer({ authToken: "review-secret" }, async ({ baseUrl }) => {
    const denied = await fetch(baseUrl + "/api/roots");
    assert.equal(denied.status, 401);

    const bootstrap = await fetch(baseUrl + "/?token=review-secret", { redirect: "manual" });
    assert.equal(bootstrap.status, 302);
    assert.match(bootstrap.headers.get("set-cookie"), /html_library_token=review-secret/);

    const cookie = bootstrap.headers.get("set-cookie").split(";", 1)[0];
    const allowed = await fetch(baseUrl + "/api/roots", { headers: { cookie } });
    assert.equal(allowed.status, 200);
  });
});

test("source responses prevent executable HTML and unknown formats are not server errors", async () => {
  await withServer(async ({ baseUrl, sourceDir }) => {
    const added = await jsonRequest(baseUrl, "/api/roots", {
      method: "POST",
      body: JSON.stringify({ path: sourceDir }),
    });
    const item = (await jsonRequest(baseUrl, "/api/items")).body.items[0];
    const source = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/source/html");
    assert.equal(source.status, 200);
    assert.match(source.headers.get("content-security-policy"), /sandbox/);
    assert.match(source.headers.get("content-security-policy"), /frame-ancestors 'self'/);
    assert.equal(source.headers.get("x-content-type-options"), "nosniff");

    const unknown = await fetch(baseUrl + "/api/items/" + encodeURIComponent(item.id) + "/source/toString");
    assert.equal(unknown.status, 404);
  });
});

test("API rejects null JSON bodies with a client error", async () => {
  await withServer(async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/api/roots", {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: "null",
    });
    assert.equal(response.status, 400);
  });
});

test("startup ignores invalid persisted roots instead of crashing", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "html-library-invalid-config-"));
  await writeFile(path.join(dataDir, "config.json"), JSON.stringify({ roots: [null, { label: "缺路径" }] }));
  const server = createServer({ dataDir, trashService: testTrashService });
  await assert.doesNotReject(server.ready);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/roots");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).roots, []);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("API returns the folder selected by the native folder picker", async () => {
  await withConfiguredServer({ chooseDirectory: async () => "/Users/example/Documents/对话" }, async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/api/settings/choose-folder", { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cancelled: false, path: "/Users/example/Documents/对话" });
  });
});

test("API reports when the native folder picker is cancelled", async () => {
  await withConfiguredServer({ chooseDirectory: async () => null }, async ({ baseUrl }) => {
    const response = await fetch(baseUrl + "/api/settings/choose-folder", { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cancelled: true });
  });
});

test('occupied port exits successfully without repeated errors', async()=>{
 const { createServer: createHttpServer }=await import('node:http');const { spawn }=await import('node:child_process');
 const blocker=createHttpServer();await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));
 const dataDir=await mkdtemp(path.join(os.tmpdir(),'html-library-port-'));const port=blocker.address().port;
 try {
  const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),HTML_LIBRARY_DATA_DIR:dataDir}});let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
  const timer=setTimeout(()=>child.kill(),5000);const code=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(timer);
  assert.equal(code,0);assert.match(output,new RegExp('服务已在运行.*'+port));assert.equal(errors,'');
 }finally{await new Promise(resolve=>blocker.close(resolve));}
});

test('v2 root API guards writes and supports preview rename order disable relocate remove',async()=>{
 await withServer(async({baseUrl,sourceDir,server})=>{
  const before=(await import('node:fs/promises')).stat;const stamp=(await before(path.join(sourceDir,'远程阅读.html'))).mtimeMs;
  for(const [headers,body,status] of [[{'content-type':'application/json'},'{}',403],[{origin:'https://other.test','content-type':'application/json'},'{}',403],[{origin:baseUrl,'content-type':'text/plain'},'{}',415],[{origin:baseUrl,'content-type':'application/json'},'null',400],[{origin:baseUrl,'content-type':'application/json'},'[]',400]])assert.equal((await fetch(baseUrl+'/api/roots',{method:'POST',headers,body})).status,status);
  const preview=await jsonRequest(baseUrl,'/api/roots?dryRun=1',{method:'POST',body:JSON.stringify({path:sourceDir})});assert.equal(preview.body.valid,true);assert.equal((await (await fetch(baseUrl+'/api/roots')).json()).roots.length,0);
  const add=await jsonRequest(baseUrl,'/api/roots',{method:'POST',body:JSON.stringify({path:sourceDir,label:'资料'})});assert.equal(add.response.status,201);const id=add.body.root.id;await server.library().scheduler.waitForIdle();
  const renamed=await jsonRequest(baseUrl,'/api/roots/'+id,{method:'PATCH',body:JSON.stringify({label:'新名'})});assert.equal(renamed.body.root.label,'新名');assert.equal(renamed.body.root.id,id);
  assert.equal((await jsonRequest(baseUrl,'/api/roots/order',{method:'PUT',body:JSON.stringify({ids:[]})})).response.status,400);
  assert.equal((await jsonRequest(baseUrl,'/api/roots/order',{method:'PUT',body:JSON.stringify({ids:[id]})})).response.status,200);
  await jsonRequest(baseUrl,'/api/roots/'+id,{method:'PATCH',body:'{"enabled":false}'});await server.library().scheduler.waitForIdle();assert.equal((await (await fetch(baseUrl+'/api/roots')).json()).totals.items,0);
  await jsonRequest(baseUrl,'/api/roots/'+id,{method:'PATCH',body:'{"enabled":true}'});await server.library().scheduler.waitForIdle();assert.equal((await (await fetch(baseUrl+'/api/roots')).json()).totals.items,1);
  const queued=await jsonRequest(baseUrl,'/api/roots/'+id+'/scan',{method:'POST',body:'{}'});assert.equal(queued.response.status,202);await server.library().scheduler.waitForIdle();
  await jsonRequest(baseUrl,'/api/roots/'+id,{method:'DELETE',body:'{}'});assert.equal((await (await fetch(baseUrl+'/api/roots')).json()).roots.length,0);assert.equal((await before(path.join(sourceDir,'远程阅读.html'))).mtimeMs,stamp);
 });
});

test('v2 document APIs use text/plain ETags safe images sandbox and series details',async()=>{
 await withServer(async({baseUrl,sourceDir,server})=>{const {writeFile,mkdir,symlink,rename,utimes}=await import('node:fs/promises');await mkdir(path.join(sourceDir,'nested'));await writeFile(path.join(sourceDir,'nested','notes.md'),'# 图片\n![图](image.png)');await writeFile(path.join(sourceDir,'nested','image.png'),Buffer.from([137,80,78,71,13,10,26,10]));await writeFile(path.join(sourceDir,'nested','fake.png'),'secret text');await symlink('/etc/passwd',path.join(sourceDir,'nested','link.png'));
  await jsonRequest(baseUrl,'/api/roots',{method:'POST',body:JSON.stringify({path:sourceDir})});await server.library().scheduler.waitForIdle();const list=await (await fetch(baseUrl+'/api/items')).json();assert.equal(list.total,2);const item=list.items.find(x=>x.html),md=list.items.find(x=>x.markdown),itemRoute='/api/items/'+encodeURIComponent(item.id);
  const detail=await (await fetch(baseUrl+itemRoute)).json();assert.equal(detail.files.length,1);const doc=await fetch(baseUrl+itemRoute+'/document');assert.equal(doc.headers.get('content-type'),'text/plain; charset=utf-8');const etag=doc.headers.get('etag');assert.equal((await fetch(baseUrl+itemRoute+'/document',{headers:{'if-none-match':etag}})).status,304);const original=await fetch(baseUrl+itemRoute+'/original');assert.match(original.headers.get('content-security-policy'),/sandbox/);
  const originalStat=(await import('node:fs/promises')).stat;const info=await originalStat(path.join(sourceDir,'远程阅读.html'));await rename(path.join(sourceDir,'远程阅读.html'),path.join(sourceDir,'old-test'));await writeFile(path.join(sourceDir,'远程阅读.html'),'<p>replacement body</p>'.padEnd(info.size,' '));await utimes(path.join(sourceDir,'远程阅读.html'),info.atime,info.mtime);const replaced=await fetch(baseUrl+itemRoute+'/document',{headers:{'if-none-match':etag}});assert.equal(replaced.status,200);assert.notEqual(replaced.headers.get('etag'),etag);assert.match(await replaced.text(),/replacement body/);
  const asset=pathValue=>baseUrl+'/api/items/'+encodeURIComponent(md.id)+'/asset?path='+encodeURIComponent(pathValue);assert.equal((await fetch(asset('image.png'))).status,200);for(const invalid of ['../../../../etc/passwd','../遠程.md','fake.png','link.png'])assert.equal((await fetch(asset(invalid))).status,404);
  assert.equal((await jsonRequest(baseUrl,itemRoute+'/trash',{method:'POST',body:'{}'})).response.status,400);const trash=await jsonRequest(baseUrl,itemRoute+'/trash',{method:'POST',body:'{"confirm":true}'});assert.equal(trash.response.status,200);assert.equal(trash.body.trashed.length,1);
 });
});

test('vendored ES modules have executable JavaScript MIME',async()=>withServer(async({baseUrl})=>{const response=await fetch(baseUrl+'/assets/vendor/dompurify-3.4.16/purify.es.mjs');assert.match(response.headers.get('content-type'),/^text\/javascript/);}));
test('history deep links use shell while missing assets and unknown API stay 404',async()=>withServer(async({baseUrl})=>{const deep=await fetch(baseUrl+'/r/root-test?item=abc');assert.equal(deep.status,200);assert.match(deep.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await deep.text(),/reader-pane/);assert.equal((await fetch(baseUrl+'/assets/nope.js')).status,404);assert.equal((await fetch(baseUrl+'/api/not-real')).status,404);}));

test('system reveal accepts only known IDs and uses fixed argv',async()=>{const calls=[];await withConfiguredServer({systemExecFile:async(...args)=>{calls.push(args);}},async({baseUrl})=>{const allowed=await jsonRequest(baseUrl,'/api/system/reveal',{method:'POST',body:'{"trash":true}'});assert.equal(allowed.response.status,200);assert.equal(calls[0][0],'/usr/bin/open');assert.deepEqual(calls[0][1],['-a','Finder',path.join(os.homedir(),'.Trash')]);const refused=await jsonRequest(baseUrl,'/api/system/reveal',{method:'POST',body:'{"path":"/etc/passwd"}'});assert.equal(refused.response.status,400);assert.equal(calls.length,1);});});
test('legacy endpoints retire while Markdown source links redirect safely',async()=>withServer(async({baseUrl,sourceDir})=>{await writeFile(path.join(sourceDir,'笔记.md'),'# 笔记');await jsonRequest(baseUrl,'/api/roots',{method:'POST',body:JSON.stringify({path:sourceDir})});const md=(await jsonRequest(baseUrl,'/api/items?fmt=markdown')).body.items[0];for(const route of ['/api/settings','/api/library'])assert.equal((await fetch(baseUrl+route)).status,404);const source='/api/items/'+encodeURIComponent(md.id)+'/source/markdown';const valid=await fetch(baseUrl+'/assets/markdown-viewer.html?source='+encodeURIComponent(source),{redirect:'manual'});assert.equal(valid.status,302);assert.match(valid.headers.get('location'),/view=markdown/);for(const bad of ['https://evil.test'+source,source+'?x=1','/etc/passwd'])assert.equal((await fetch(baseUrl+'/assets/markdown-viewer.html?source='+encodeURIComponent(bad),{redirect:'manual'})).status,400);}));
