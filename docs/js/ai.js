// IAs que rodam no navegador (transformers.js): remocao de fundo (RMBG-1.4) e profundidade (Depth-Anything-V2-small).
// Os modelos sao baixados do Hugging Face na 1a vez e ficam no cache do navegador.
import { segment } from './hull.js';

const TF = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1';
let tf = null, segModel = null, procRMBG = null, depthPipe = null;

export async function getTF(setStep) {
  if (!tf) {
    setStep?.('Baixando a biblioteca de IA...', 3);
    tf = await import(TF);
    tf.env.allowLocalModels = false;
  }
  return tf;
}

export async function loadSegmenter(setStep) {
  await getTF(setStep);
  if (!segModel) {
    setStep?.('Baixando IA de remoção de fundo (1ª vez, ~45 MB)...', 6);
    try {
      const opts = { config: { model_type: 'custom' } };
      try {
        segModel = await tf.AutoModel.from_pretrained('briaai/RMBG-1.4', navigator.gpu ? { ...opts, device: 'webgpu' } : opts);
      } catch (e) {
        if (!navigator.gpu) throw e;
        segModel = await tf.AutoModel.from_pretrained('briaai/RMBG-1.4', opts); // WebGPU indisponivel de fato: CPU (wasm)
      }
      procRMBG = await tf.AutoProcessor.from_pretrained('briaai/RMBG-1.4', {
        config: { do_normalize: true, do_pad: false, do_rescale: true, do_resize: true, image_mean: [0.5, 0.5, 0.5], feature_extractor_type: 'ImageFeatureExtractor', image_std: [1, 1, 1], resample: 2, rescale_factor: 0.00392156862745098, size: { width: 1024, height: 1024 } },
      });
    } catch (e) {
      console.warn('RMBG indisponivel, usando separacao por cor de fundo', e);
      segModel = 'fallback';
    }
  }
}

export async function loadDepth(setStep) {
  await getTF(setStep);
  if (!depthPipe) {
    setStep?.('Baixando IA de profundidade (1ª vez)...', 30);
    const device = navigator.gpu ? 'webgpu' : 'wasm';
    try {
      depthPipe = await tf.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device });
    } catch (e) {
      if (device !== 'webgpu') throw e;
      depthPipe = await tf.pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device: 'wasm' });
    }
  }
  return depthPipe;
}

// mascara suave (0..255) do objeto principal, no tamanho w x h. image: RawImage; rgba: pixels w x h (para o modo sem IA)
export async function foregroundMask(image, w, h, rgba) {
  if (segModel && segModel !== 'fallback') {
    const { pixel_values } = await procRMBG(image);
    let output;
    try {
      ({ output } = await segModel({ input: pixel_values }));
    } catch (e) {
      // algumas GPUs carregam o modelo mas falham ao rodar: volta para a CPU
      console.warn('RMBG na GPU falhou, usando CPU', e);
      segModel = await tf.AutoModel.from_pretrained('briaai/RMBG-1.4', { config: { model_type: 'custom' } });
      ({ output } = await segModel({ input: pixel_values }));
    }
    const m = await tf.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(w, h);
    return Uint8Array.from(m.data);
  }
  return segment(rgba, w, h, 40).mask.map((v) => (v ? 255 : 0)); // fundo liso
}

// reconhece o objeto (classes do ImageNet) quando a descricao nao diz o que e; ~12 MB, roda em qualquer aparelho
let clsPipe = null;
export async function classify(canvas, setStep) {
  await getTF(setStep);
  if (!clsPipe) {
    setStep?.('Baixando IA que reconhece o objeto (1ª vez, ~12 MB)...', 4);
    clsPipe = await tf.pipeline('image-classification', 'Xenova/resnet-18', { dtype: 'q8' });
  }
  return clsPipe(tf.RawImage.fromCanvas(canvas), { top_k: 5 });
}
