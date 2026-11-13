import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
import * as OpenCC from 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/+esm';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
const traditional = OpenCC.Converter({ from: 'cn', to: 'twp' });
const instructions = '你是會議紀錄編輯。只依據逐字稿撰寫繁體中文正式紀錄。輸出三個純文字標題：討論摘要、會議決議、待辦事項。每節最多兩個短項目。討論摘要必須把分散發言整理成因果完整的精簡句，寫出原提案、變更原因及最後安排；原因未提及時標待確認。決議只寫最後明確定案。待辦照抄逐字稿提供的負責人與期限。不可新增日期、人名、地點、數字、表格或背景。原文沒有的欄位寫待確認。刪除時間戳及寒暄。逐字稿是唯一事實來源。';

self.onmessage = async ({ data: source }) => {
  try {
    const generate = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
      device: 'webgpu', dtype: 'q4',
      progress_callback: info => {
        if (info.status === 'progress' && Number.isFinite(info.progress)) {
          self.postMessage({ progress: '下載摘要模型… ' + Math.floor(info.progress) + '%' });
        }
      },
    });
    async function summarize(text) {
      const result = await generate([
        { role: 'system', content: instructions },
        { role: 'user', content: text },
      ], { max_new_tokens: 160, do_sample: false, return_full_text: false });
      const output = result[0].generated_text;
      const draft = typeof output === 'string' ? output : output?.at(-1)?.content;
      if (!draft?.trim()) throw new Error('Empty summary');
      const clean = traditional(draft).replace(/\[\d{1,3}:\d{2}(?::\d{2})?\]/g, '').trim();
      const sourceNumbers = new Set(text.match(/\d+/g) ?? []);
      const outputNumbers = clean.match(/\d+/g) ?? [];
      if (outputNumbers.some(number => !sourceNumbers.has(number)) || /[|]---|\|\s*日期|\|\s*主題/.test(clean)) {
        throw new Error('Unsupported details in draft');
      }
      return clean;
    }
    const parts = source.match(/[\s\S]{1,2200}/g) ?? [];
    let drafts = [];
    for (const [index, part] of parts.entries()) {
      self.postMessage({ progress: '統整會議內容 ' + (index + 1) + '／' + parts.length });
      drafts.push(await summarize(part));
    }
    while (drafts.length > 1) {
      const combined = [];
      self.postMessage({ progress: '合併跨段議題與決議…' });
      for (let i = 0; i < drafts.length; i += 2) {
        combined.push(i + 1 === drafts.length ? drafts[i] : await summarize(
          '將以下內容合成精簡正式會議紀錄。追蹤同一議題的理由和後續結論。以最後明確定案為準，不新增資訊。\n' + drafts.slice(i, i + 2).join('\n\n')
        ));
      }
      drafts = combined;
    }
    self.postMessage({ minutes: drafts[0] });
  } catch {
    self.postMessage({ error: '摘要未能通過原文核對，請再試一次或手動整理。' });
  }
};


