export async function request(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path,{method,signal,...(method!=='GET'?{headers:{'content-type':'application/json'},body:JSON.stringify(body||{})}:{})});
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) { const failure = payload?.error; throw Object.assign(new Error(failure?.message || failure || (response.status===401?'需要访问令牌':'无法连接本地知识库')), { code:failure?.code,status:response.status,details:failure?.details }); }
  return payload;
}
export async function pollScan(callback = () => {}, { signal } = {}) { while (true) { if (signal?.aborted) throw new DOMException('Aborted','AbortError'); const status=await request('/api/scan/status',{signal});await callback(status);if(!status.running.length&&!status.queued.length)return status;await new Promise((resolve,reject)=>{const timer=setTimeout(done,500);function done(){signal?.removeEventListener('abort',cancel);resolve();}function cancel(){clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));}signal?.addEventListener('abort',cancel,{once:true});});} }
