import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';
import * as OpenCC from 'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/+esm';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
const traditional = OpenCC.Converter({ from: 'cn', to: 'twp' });
let recognizer;
self.onmessage = async ({ data: { samples, model } }) => {
  try {
    recognizer ??= await pipeline('automatic-speech-recognition', 'onnx-community/whisper-' + (model === 'small' ? 'small' : 'base'), {
      device: 'wasm',
      dtype: 'q8',
    });
    self.postMessage({ status: '轉錄中…' });
    const result = await recognizer(samples, { language: 'chinese', task: 'transcribe', return_timestamps: true });
    self.postMessage({ chunks: (result.chunks ?? [{ text: result.text }]).map(chunk => ({
      ...chunk, text: traditional(chunk.text),
    })).filter(chunk => chunk.text.trim()) });
  } catch (error) {
    self.postMessage({ error: '轉錄失敗。請確認網路或試用較短的音檔。' });
  }
};
