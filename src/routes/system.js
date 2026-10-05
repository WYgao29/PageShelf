export async function handle({ request, response, url, chooseDirectory, sendJson }) {
  if (['/api/system/choose-folder', '/api/settings/choose-folder'].includes(url.pathname) && request.method === 'POST') {
    const selected = await chooseDirectory();
    if (selected !== null && (typeof selected !== 'string' || !selected.trim())) throw Object.assign(new Error('选择的文件夹路径无效'), { code: 'FOLDER_PICKER_UNAVAILABLE' });
    sendJson(response, 200, selected === null ? { cancelled: true } : { cancelled: false, path: selected.trim() }); return true;
  }
  return false;
}
