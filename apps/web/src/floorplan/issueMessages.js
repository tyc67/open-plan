// zh-TW messages for validator issues (open-plan-core validatePlan). The message keeps the raw path in brackets,
// so a user can paste it back to an agent, which reads paths, not Chinese labels.

const LISTS = { walls: ['第', ' 段牆'], openings: ['第', ' 個開口'], rooms: ['第', ' 個空間'], furniture: ['第', ' 件家具'], measurements: ['第', ' 條測量線'], dimensions: ['第', ' 組尺寸線'] };
const FIELDS = {
  id: 'id', name: '名稱', type: '類型', a: '起點', b: '終點', thickness: '厚度', demolished: '拆除標記', wallId: '所在牆', offset: '位置', width: '寬度',
  sill: '窗台高度', head: '頂高', hinge: '鉸鏈側', swing: '開門方向', entry: '大門標記', mat: '地板材質', poly: '外框', at: '標籤位置', counted: '計入面積',
  cx: 'X', cy: 'Y', w: '寬度', d: '深度', rot: '旋轉角度', color: '顏色', ceilingHeight: '天花板高度', units: '單位', schemaVersion: '格式版本',
  materials: '材質', segments: '尺寸段', wastePercent: '損耗率', walls: '牆體清單', openings: '開口清單', rooms: '空間清單', furniture: '家具清單',
};

/** "第 3 個開口的寬度" style label for a path such as `openings[2].width`. */
export function pathLabel(path) {
  if (path === '$') return '平面圖';
  const list = /^(\w+)\[(\d+)\](?:\.(.+))?$/.exec(path);
  if (list && LISTS[list[1]]) {
    const [before, after] = LISTS[list[1]], item = `${before} ${Number(list[2]) + 1}${after}`;
    if (!list[3]) return item;
    const field = list[3].split(/[.[]/)[0];
    return `${item}的${FIELDS[field] || field}`;
  }
  const field = path.replace(/^\$\./, '').split(/[.[]/)[0];
  return FIELDS[field] || field;
}

const mm = value => `${Math.round(value * 10) / 10} mm`;
const heightText = p => p.min !== undefined && p.max !== undefined ? `高度 ${mm(p.value)} 超出範圍 ${p.min}–${p.max} mm` : p.max !== undefined ? `高度 ${mm(p.value)} 高於天花板 ${mm(p.max)}` : `高度 ${mm(p.value)} 不能小於 ${p.min} mm`;
const TEXT = {
  'json-invalid': () => '資料不是有效的 JSON',
  'v1-unreadable': () => '舊版（v1）資料無法轉換為目前的格式',
  'file-too-large': () => '檔案大於 20 MB，不是平面圖檔案',
  'file-unreadable': () => '無法讀取檔案',
  'type-invalid': p => `格式不對，應為 ${p.expected}`,
  'missing-field': p => `缺少必要欄位（${p.expected}）`,
  'enum-invalid': p => `不是可用的值，可用：${p.allowed.join('、')}`,
  'schema-version': p => `格式版本是 ${JSON.stringify(p.found)}，只支援 ${p.expected}`,
  'id-duplicate': p => `id「${p.id}」重複`,
  'wall-missing': p => `找不到 id 為「${p.wallId}」的牆`,
  'wall-zero-length': () => '起點和終點相同，牆的長度為 0',
  'wall-not-axis-aligned': () => '牆必須是水平或垂直（此版本不支援斜牆）',
  'thickness-out-of-range': p => `厚度 ${mm(p.value)} 超出範圍 ${p.min}–${p.max} mm`,
  'value-out-of-range': p => p.max === undefined ? `數值 ${p.value} 不能小於 ${p.min}` : `數值 ${p.value} 超出範圍 ${p.min}–${p.max}`,
  'size-not-positive': p => `數值 ${p.value} 必須大於 0`,
  'opening-outside-wall': p => `超出牆的長度 ${mm(p.wallLength)}（結束於 ${mm(p.end)}）`,
  'openings-overlap': p => `和開口「${p.otherId}」重疊`,
  'height-out-of-range': p => (p.defaulted ? '未填寫，使用預設值；' : '') + heightText(p),
  'wall-not-demolishable': p => `${p.type === 'b' ? '承重牆' : '外牆'}不能標記拆除；可在牆體屬性按「恢復牆體」`,
  'window-sill-not-below-head': p => `窗台 ${mm(p.sill)} 必須低於頂高 ${mm(p.head)}`,
  'window-in-low-wall': () => '窗戶位在矮牆上，玻璃會高出矮牆',
  'room-too-few-points': p => `外框只有 ${p.count} 個點，至少需要 3 個`,
  'room-area-too-small': p => `面積 ${p.area.toFixed(4)} m² 小於 ${p.min} m²`,
  'room-self-crossing': () => '外框的邊互相交叉',
  'room-material-missing': p => `找不到材質「${p.mat}」，以預設材質顯示`,
  'too-many-items': p => `共 ${p.count} 項，超過上限 ${p.limit}`,
  // Refusals of the editing commands (roadmap D4).
  'wall-end-off-line': () => '牆的端點只能沿著牆的方向移動',
  'wall-end-past-other': () => '長度必須大於 0',
  'split-point-off-wall': () => '分割位置必須在牆的兩端之間',
  'split-point-in-opening': p => `分割位置在開口「${p.openingId}」裡面`,
  'wall-demolished-type': () => '已標記拆除的牆不能改成承重牆或外牆；請先恢復牆體',
  'wall-demolished': () => '這段牆已標記拆除',
  'walls-not-collinear': () => '兩段牆不在同一條線上',
  'walls-type-differs': () => '兩段牆的類型不同',
  'walls-thickness-differs': () => '兩段牆的厚度不同',
  'walls-demolition-differs': () => '兩段牆的拆除狀態不同',
  'walls-not-touching': () => '兩段牆沒有相接',
  'join-same-wall': () => '不能和自己合併',
  'opening-missing': p => `找不到開口「${p.openingId}」`,
  'plan-too-large': p => `平面圖 ${(p.width / 1000).toFixed(1)} × ${(p.depth / 1000).toFixed(1)} m，超過 ${p.limit / 1000} × ${p.limit / 1000} m`,
};

/** One issue as zh-TW text, for example "第 3 個開口的寬度：超出牆的長度 3000 mm（結束於 3500 mm）（openings[2].width）". */
export function issueMessage({ path, code, params }) {
  const text = TEXT[code]?.(params) ?? code;
  return `${pathLabel(path)}：${text}（${path}）`;
}

// Command fields whose name helps the user; other fields (`to`, `at`, `otherId`) are named by the message itself.
const NAMED_FIELDS = ['type', 'thickness', 'name', 'offset', 'width', 'sill', 'head', 'hinge', 'swing', 'mat', 'poly'];

/**
 * The errors of a refused edit (roadmap D4) as zh-TW lines. An error of a command has a path inside the command
 * (`commands[0].thickness`), which means nothing to the user, so the line names only the field.
 */
export function editMessages(errors, max = 5) {
  const line = issue => {
    const command = /^commands\[\d+\](?:\.(\w+))?/.exec(issue.path);
    if (!command) return issue.code === 'scale-result-invalid' ? null : issueMessage(issue);
    const text = TEXT[issue.code]?.(issue.params ?? {}) ?? issue.code, field = NAMED_FIELDS.includes(command[1]) && FIELDS[command[1]];
    return field ? `${field}：${text}` : text;
  };
  const lines = errors.slice(0, max).map(line).filter(Boolean);
  if (errors.length > max) lines.push(`還有 ${errors.length - max} 個未列出（共 ${errors.length} 個）`);
  return lines;
}

/** What an edit also did or caused (notes and warnings of the commands), as zh-TW lines. */
export function editNoteLines({ notes = [], warnings = [] }) {
  const lines = [];
  for (const note of notes) if (note.code === 'openings-deleted') lines.push(`牆上的 ${note.params.openingIds.length} 個開口也一併刪除了。`);
  const rooms = [...new Set(warnings.filter(w => w.code === 'room-edge-off-wall').map(w => w.params.roomId))];
  if (rooms.length) lines.push(`有 ${rooms.length} 個空間的外框不再貼著牆面；空間外框不會自動調整，請檢查。`);
  for (const w of warnings) if (w.code !== 'room-edge-off-wall') lines.push(issueMessage(w));
  return { lines, roomIds: rooms };
}

/** The first `max` messages, and a line with the number left out. */
export function issueMessages(issues, max = 20) {
  const lines = issues.slice(0, max).map(issueMessage);
  if (issues.length > max) lines.push(`還有 ${issues.length - max} 個未列出（共 ${issues.length} 個）`);
  return lines;
}

// zh-TW text for the notes of the v1 migration report (open-plan-core migrateV1). The notes have no parameters, so the
// text is general; the English message has the numbers and stays visible below it.
const REPORT = {
  'wall-type-unknown': '不明的牆體類型已改為隔間牆（n）',
  'opening-wall-created': '已在開口位置建立一段牆',
  'opening-wall-low': '開口所在的牆是矮牆，上方不畫過梁',
  'neighbour-demolished': '相鄰的牆已標記拆除，開口仍保留，請檢查',
  'door-hinge-not-at-end': '舊版鉸鏈不在開口的一端，已改到最近的一端',
  'door-hinge-moved': '鉸鏈位置已移動',
  'door-closed-direction': '舊版門的關閉方向不是從鉸鏈指向開口',
  'door-swing-not-normal': '舊版開門方向和牆不垂直，已改為最接近的一側',
  'door-length-changed': '舊版門扇長度已改為開口寬度',
  'sample-bay-holes-not-applicable': '沒有範例的凸窗牆，未加入凸窗開口',
  'sample-bay-holes-skipped': '有牆或開口和範例凸窗重疊，未加入凸窗開口',
  'sample-bay-hole-created': '已加入範例凸窗的開口（舊版只有固定的過梁）',
  'room-polygon-corrected': '舊範例的空間外框和承重牆重疊，已改為沿牆面',
};

/** One migration note as zh-TW text with the ids it names, for example "開口 d1，牆 d1--wall：鉸鏈位置已移動". */
export function reportMessage({ code, openingId, wallId, roomId, message }) {
  const ids = [roomId && `空間 ${roomId}`, openingId && `開口 ${openingId}`, wallId && `牆 ${wallId}`].filter(Boolean).join('，');
  return `${ids ? `${ids}：` : ''}${REPORT[code] ?? message}`;
}
