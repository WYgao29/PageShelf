import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
export const sourceNotFound = (message='源文件不存在或路径无效')=>Object.assign(new Error(message),{code:'SOURCE_NOT_FOUND'});
export function isInsideRoot(root,candidate) { const relative=path.relative(root,candidate);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative); }
export async function validateSourceFile(rootPath,absolutePath,fsOps=fs) {
 try {
  const canonicalRoot=await fsOps.realpath(rootPath),candidate=path.resolve(absolutePath),rawRoot=path.resolve(rootPath);
  const expected=isInsideRoot(rawRoot,candidate)?path.resolve(canonicalRoot,path.relative(rawRoot,candidate)):candidate;
  const [stat,canonical]=await Promise.all([fsOps.lstat(candidate),fsOps.realpath(candidate)]);
  if(!stat.isFile()||stat.isSymbolicLink()||!isInsideRoot(canonicalRoot,canonical)||canonical!==expected)throw sourceNotFound();
  return {path:canonical,stat};
 } catch(error) { if(['ENOENT','ELOOP','ENOTDIR'].includes(error.code))throw sourceNotFound();throw error; }
}
export async function readSafeFile(rootPath,absolutePath) {
 const checked=await validateSourceFile(rootPath,absolutePath);
 const handle=await fs.open(checked.path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try {const stat=await handle.stat();if(!stat.isFile()||stat.ino!==checked.stat.ino||stat.dev!==checked.stat.dev)throw sourceNotFound();return {path:checked.path,stat,buffer:await handle.readFile()};}finally{await handle.close();}
}
