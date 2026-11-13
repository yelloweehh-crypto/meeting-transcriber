const $ = id => document.getElementById(id);
const [audio, start, stop, status, progress, transcript] =
  ['audio', 'start', 'stop', 'status', 'progress', 'transcript'].map($);
let worker;

audio.onchange = () => {
  start.disabled = !audio.files.length;
  status.textContent = audio.files.length ? '可以開始轉錄。' : '請先選取錄音。';
};

function finish(message) {
  worker?.terminate?.();
  worker = undefined;
  audio.disabled = false;
  start.disabled = !audio.files.length;
  stop.disabled = true;
  status.textContent = message;
}

function time(seconds) {
  const value = Math.floor(seconds);
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60]
    .map(part => String(part).padStart(2, '0')).join(':');
}

start.onclick = async () => {
  const file = audio.files[0];
  if (!file) return;
  if (transcript.value.trim() && !confirm('開始新轉錄會清除目前的逐字稿。繼續嗎？')) return;
  start.disabled = audio.disabled = true;
  stop.disabled = false;
  progress.value = 0;
  status.textContent = '讀取錄音中…';
  const run = {};
  let job;
  worker = run;
  let context;
  try {
    context = new AudioContext({ sampleRate: 16000 });
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (worker !== run) return;
    if (decoded.duration > 7200.5) throw new Error('請選取 120 分鐘以內的錄音。');
    transcript.value = '';
    const size = 25 * decoded.sampleRate;
    let offset = 0;
    const send = () => {
      const end = Math.min(offset + size, decoded.length);
      const samples = new Float32Array(end - offset);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const source = decoded.getChannelData(channel);
        for (let i = 0; i < samples.length; i++) samples[i] += source[offset + i] / decoded.numberOfChannels;
      }
      job.postMessage({ samples }, [samples.buffer]);
    };
    job = new Worker('./transcribe.js?v=4', { type: 'module' });
    worker = job;
    job.onmessage = ({ data }) => {
      if (worker !== job) return;
      if (data.error) return finish(data.error);
      if (data.status) {
        status.textContent = data.status;
        return;
      }
      for (const chunk of data.chunks) {
        transcript.value += '[' + time(offset / 16000 + (chunk.timestamp?.[0] ?? 0)) + '] ' + chunk.text.trim() + '\n';
      }
      offset = Math.min(offset + size, decoded.length);
      progress.value = offset / decoded.length;
      if (offset >= decoded.length) return finish(transcript.value.trim() ? '轉錄完成。' : '轉錄完成，未辨識到文字。');
      status.textContent = '轉錄中… ' + Math.floor(progress.value * 100) + '%';
      send();
    };
    job.onerror = () => finish('無法載入轉錄工具，請確認網路並重試。');
    status.textContent = '載入模型中…';
    send();
  } catch (error) {
    if (worker === job || worker === run) finish(error.message || '無法讀取錄音。');
  } finally {
    if (context) await context.close();
  }
};
stop.onclick = () => finish('已停止，可保留目前的逐字稿。');

for (const button of document.querySelectorAll('[data-export]')) {
  button.onclick = () => {
    const field = $(button.dataset.export);
    if (!field.value.trim()) return;
    const url = URL.createObjectURL(new Blob([field.value], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = (field.id === 'minutes' ? '會議紀錄' : '逐字稿') + '.txt';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
}


$('summarize').onclick = () => {
  const text = transcript.value.replace(/^\s*\[\d{1,3}:\d{2}(?::\d{2})?\]\s*/gm, '').trim();
  const notice = $('minutes-status');
  if (!text) {
    notice.textContent = '請先完成轉錄或貼上逐字稿。';
    return;
  }
  const minutes = $('minutes');
  if (minutes.value !== minutes.defaultValue && !confirm('整理完成後要取代目前的會議紀錄嗎？')) return;

  const button = $('summarize');
  let job;
  const finish = message => {
    job?.terminate();
    button.disabled = false;
    notice.textContent = message;
  };
  button.disabled = true;
  notice.textContent = '載入本機摘要模型，首次使用需要下載…';
  try {
    job = new Worker('./summarize.js', { type: 'module' });
    job.onmessage = ({ data }) => {
      if (data.progress) {
        notice.textContent = data.progress;
      } else if (data.error) {
        finish(data.error);
      } else {
        minutes.value = data.minutes;
        finish('已整理會議紀錄初稿，請核對後再下載。');
      }
    };
    job.onerror = () => finish('無法載入摘要模型，請確認網路後重試。');
    job.postMessage(text);
  } catch {
    finish('無法啟動摘要工具，請重新整理頁面。');
  }
};
