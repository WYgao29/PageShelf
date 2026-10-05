export function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) { if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(),value); else if (key === 'className') element.className=value; else if (value !== undefined && value !== null && value !== false) { if (key in element && !key.startsWith('aria-') && !key.startsWith('data-')) element[key]=value; else element.setAttribute(key,value === true ? '' : value); } }
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return element;
}
export const button = (label, onClick, attrs = {}) => h('button', { type:'button',onClick,...attrs }, label);
export const formatDate = value => value ? new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',...(new Date(value).getFullYear() !== new Date().getFullYear()?{year:'numeric'}:{})}).format(new Date(value)) : '未扫描';
export const bytes = value => value >= 1024*1024 ? (value/1024/1024).toFixed(1)+' MB' : value >=1024 ? Math.round(value/1024)+' KB' : (value||0)+' B';
export function highlighted(text, ranges = []) { const fragment=document.createDocumentFragment();let start=0;for(const [a,b] of ranges){fragment.append(document.createTextNode(text.slice(start,a)),h('mark',{},text.slice(a,b)));start=b;}fragment.append(document.createTextNode(text.slice(start)));return fragment; }
export function storageGet(key,fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function storageSet(key,value) { try { localStorage.setItem(key,JSON.stringify(value)); } catch {} }
