import { mkdtemp, mkdir, writeFile, rm, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
export async function withTempFixture(callback) {
 const directory = await mkdtemp(path.join(os.tmpdir(), 'html-v2-test-'));
 try { return await callback(directory); } finally { await rm(directory,{recursive:true,force:true}); }
}
export function html(title, body='这是用于验证正文抽取的脱敏资料。'.repeat(25)) { return `<html><head><title>${title}</title></head><body><article><h1>${title}</h1><h2>研究问题</h2><p>${body}</p><h3>证据与方法</h3><p>证据应当可复核。</p></article></body></html>`; }
export function mhtml(title) { return 'MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary="fixture"\r\n\r\n--fixture\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from(html(title)).toString('base64')+'\r\n--fixture--'; }
export async function createLegacyFixture(parentDir) {
 const rootPath=path.join(parentDir,'source'); const dataDir=path.join(parentDir,'data');
 const rootId='root-2e61579df9d2'; const paths=[];
 const course='腾讯云ADP-FDE认证课程';
 for (const [series,n] of [['用Codex做行业研究',10],['基础设施',9],['AI产业链投资大逻辑',6],['AI时代，如何提问',6],['一个产品的诞生',3],['用Codex做跨境电商',2]]) for(let i=1;i<=n;i++) paths.push([`${series}_${String(i).padStart(2,'0')}_章节${i}.mhtml`,mhtml(`${series}章节${i}`)]);
 for(let i=1;i<=4;i++) paths.push([`${course}/${String(i).padStart(2,'0')}_课程${i}.html`,html(`课程${i}`)]);
 for(const name of ['index','log','学习进度','复习计划']) paths.push([`${course}/bloom-learn/${name}.md`,`---\ntitle: ${name}\ntags: [学习, 资料]\n---\n# ${name}\n\n[[学习进度]]\n\n这是学习笔记。`]);
 for(let i=1;i<=4;i++) paths.push([`单篇${i}.html`,html(`单篇${i}`)]);
 await mkdir(dataDir,{recursive:true});
 for(const [relative,content] of paths) { const target=path.join(rootPath,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content); }
 await writeFile(path.join(dataDir,'config.json'),JSON.stringify({roots:[{id:rootId,path:rootPath,label:'名词解释',addedAt:'2026-09-01T14:21:33.516Z'}]}));
 const expectedItemIds=paths.map(([relative])=>rootId+':'+createHash('sha1').update(relative.replace(/\.[^.]+$/,'')).digest('hex').slice(0,12)).sort();
 return {dataDir,rootPath,rootId,expectedItemIds};
}
export const testTrashService={async trashFiles({paths}) {for(const file of paths) await rename(file,file+'.trashed-test');return {trashed:paths,failed:[],method:'test'};}};
