import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CrashPage from '../src/CrashPage.jsx';

// The crash page acts only on the storage of its own mode (roadmap C3: two separate storage modes).
const page = fileMode => renderToStaticMarkup(createElement(CrashPage, { error: new Error('render failed'), fileMode }));

describe('crash page', () => {
  it('in local file mode, it refers to the plan file and has no browser-storage action', () => {
    const html = page(true);
    expect(html).toContain('平面圖檔案保留最後一次成功儲存的版本');
    expect(html).toContain('尚未儲存的編輯可能已遺失');
    expect(html).toContain('重新載入');
    for (const text of ['此瀏覽器內', '下載已儲存資料', '備份後改用新的平面圖']) expect(html).not.toContain(text);
  });
  it('in website mode, it keeps the browser-storage actions', () => {
    const html = page(false);
    for (const text of ['此瀏覽器內', '下載已儲存資料', '重新載入', '備份後改用新的平面圖']) expect(html).toContain(text);
  });
});
