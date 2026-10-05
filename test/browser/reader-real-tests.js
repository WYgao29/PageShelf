export async function runRealTests({ test, result }) {
 const { buildReader } = await import('/assets/js/reader/pipeline.js');
 const list = await (await fetch('/api/items?limit=500')).json(); result.realDocuments = [];
 for (const item of list.items) {
  if (!item.formats.html && !item.formats.mhtml) continue;
  const response = await fetch('/api/items/' + encodeURIComponent(item.id) + '/document');
  try { const reader = await buildReader({ item, html: await response.text() }); result.realDocuments.push({ id: item.id, title: item.title, format: item.mhtml ? 'mhtml' : 'html', status: reader.status, site: reader.site, headings: reader.toc.length, reason: reader.reason || null }); reader.find?.destroy(); }
  catch (error) { result.realDocuments.push({ id: item.id, title: item.title, format: item.mhtml ? 'mhtml' : 'html', status: 'failed', reason: error.message }); }
 }
 const success = result.realDocuments.filter(x => x.status === 'reader'), mhtml = success.filter(x => x.format === 'mhtml');
 await test('real library 44 HTML/MHTML documents reach >=42 successful extracts and >=35 MHTML', assert => { assert(result.realDocuments.length === 44, 'document count ' + result.realDocuments.length); assert(success.length >= 42, 'success ' + success.length); assert(mhtml.length >= 35, 'MHTML success ' + mhtml.length); });
 await test('first lecture has nine sections and full article heading', assert => { const first = result.realDocuments.find(x=>x.title.startsWith('第一讲：')); assert(first?.headings === 9, JSON.stringify(first)); });
 result.realIds = list.items.map(x=>x.id).sort(); result.realTitles = list.items.map(x=>({id:x.id,title:x.title}));
}
