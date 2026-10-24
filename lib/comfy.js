// Cliente do ComfyUI: converte um workflow do editor (formato UI) para o formato de API e executa.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LINK_FREE = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO', 'COLOR', 'LOAD_3D', 'COMFY_DYNAMICCOMBO_V3']);

function inputOrder(def) {
  const o = def.input_order || {};
  return [...(o.required || []).map((n) => ['required', n]), ...(o.optional || []).map((n) => ['optional', n])];
}

function specOf(def, kind, name) {
  return def.input?.[kind]?.[name];
}

const isWidget = (spec) => {
  if (!spec) return false;
  const t = spec[0];
  return Array.isArray(t) || LINK_FREE.has(t);
};

/** Converte workflow UI -> prompt de API, mantendo so os ancestrais dos nos de saida. */
export function toApi(wf, objectInfo, outputIds, overrides = {}) {
  const nodes = new Map(wf.nodes.map((n) => [n.id, n]));
  const links = new Map(wf.links.map((l) => [l[0], l]));
  // ComfySwitchNode: resolve a chave em tempo de conversao e liga direto na ramificacao escolhida
  const boolOf = (id) => overrides[id]?.value ?? nodes.get(id).widgets_values?.[0];
  const resolve = (linkId) => {
    let l = links.get(linkId);
    for (;;) {
      const n = nodes.get(l[1]);
      if (n.type !== 'ComfySwitchNode') return l;
      const swIn = (n.inputs || []).find((i) => i.name === 'switch');
      const cond = swIn?.link != null ? boolOf(links.get(swIn.link)[1]) : n.widgets_values?.[0];
      const pick = (n.inputs || []).find((i) => i.name === (cond ? 'on_true' : 'on_false'));
      if (pick?.link == null) throw new Error(`Switch ${n.id} sem entrada ${cond ? 'on_true' : 'on_false'}`);
      l = links.get(pick.link);
    }
  };
  const need = new Set();
  const visit = (id) => {
    if (need.has(id)) return;
    need.add(id);
    for (const inp of nodes.get(id).inputs || []) if (inp.link != null) visit(resolve(inp.link)[1]);
  };
  outputIds.forEach(visit);

  const prompt = {};
  for (const id of need) {
    const n = nodes.get(id);
    const def = objectInfo[n.type];
    if (!def) throw new Error(`No desconhecido no ComfyUI: ${n.type}`);
    const inputs = {};
    const byName = Object.fromEntries((n.inputs || []).map((i) => [i.name, i]));
    let w = 0;
    const vals = n.widgets_values || [];
    for (const [kind, name] of inputOrder(def)) {
      const spec = specOf(def, kind, name);
      const linked = byName[name]?.link != null;
      if (isWidget(spec)) {
        const v = vals[w++];
        if (spec[1]?.control_after_generate) w++;
        if (!linked && v !== undefined) inputs[name] = v;
        if (spec[0] === 'COMFY_DYNAMICCOMBO_V3') { // combo dinamico: sub-entradas da opcao escolhida viram "nome.sub"
          const opt = (spec[1].options || []).find((o) => o.key === v);
          for (const k of ['required', 'optional']) for (const sub of Object.keys(opt?.inputs?.[k] || {})) {
            const sv = vals[w++];
            if (sv !== undefined) inputs[`${name}.${sub}`] = sv;
          }
        }
      }
      if (linked) {
        const l = resolve(byName[name].link);
        inputs[name] = [String(l[1]), l[2]];
      }
    }
    // entradas dinamicas (ex.: ComfySwitchNode on_true/on_false) que nao estejam em input_order
    for (const i of n.inputs || []) if (i.link != null && !(i.name in inputs)) {
      const l = resolve(i.link);
      inputs[i.name] = [String(l[1]), l[2]];
    }
    prompt[String(id)] = { class_type: n.type, inputs };
  }
  for (const [id, set] of Object.entries(overrides)) if (prompt[id]) Object.assign(prompt[id].inputs, set);
  return prompt;
}

export class Comfy {
  constructor(base = 'http://127.0.0.1:8189', inputDir) {
    this.base = base;
    this.inputDir = inputDir;
  }
  async alive() {
    try { return (await fetch(`${this.base}/system_stats`)).ok; } catch { return false; }
  }
  async objectInfo() {
    return (await fetch(`${this.base}/object_info`)).json();
  }
  putImage(srcPath, name) {
    fs.mkdirSync(this.inputDir, { recursive: true });
    fs.copyFileSync(srcPath, path.join(this.inputDir, name));
    return name;
  }
  async run(prompt, log = () => {}, signal) {
    const r = await fetch(`${this.base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
    const j = await r.json();
    if (!r.ok) throw new Error('ComfyUI recusou o workflow: ' + JSON.stringify(j.node_errors || j.error || j).slice(0, 1500));
    const id = j.prompt_id;
    if (j.node_errors && Object.keys(j.node_errors).length) log('node_errors: ' + JSON.stringify(j.node_errors).slice(0, 2500));
    log(`ComfyUI: prompt ${id}`);
    for (;;) {
      if (signal?.aborted) { await fetch(`${this.base}/interrupt`, { method: 'POST' }); throw new Error('cancelado'); }
      await new Promise((res) => setTimeout(res, 2000));
      const h = await (await fetch(`${this.base}/history/${id}`)).json();
      const e = h[id];
      if (!e) continue;
      if (e.status?.status_str === 'error') {
        const m = (e.status.messages || []).find((x) => x[0] === 'execution_error');
        throw new Error('ComfyUI: ' + (m ? `${m[1].node_type}: ${m[1].exception_message}` : 'erro de execucao'));
      }
      if (e.outputs && Object.keys(e.outputs).length || e.status?.completed) return e;
    }
  }
}

export const TRELLIS_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ai', 'workflows', 'trellis2_image_to_model.json');

/** Roda o workflow TRELLIS.2 do ComfyUI e devolve o caminho do GLB gerado (com texturas PBR). */
export async function runTrellis(comfy, imagePath, { faces = 700000, texRes = 4096, prefix = 'trellis', template = TRELLIS_TEMPLATE, outputDir } = {}, log = () => {}, signal) {
  const wf = JSON.parse(fs.readFileSync(template, 'utf8'));
  const info = await comfy.objectInfo();
  const name = comfy.putImage(imagePath, `in_${path.basename(imagePath)}`);
  const prompt = toApi(wf, info, [322], {
    122: { image: name },
    316: { value: true }, // TRELLIS.2 (false = Pixal3D)
    186: { target_face_count: faces },
    288: { value: texRes },
    322: { filename_prefix: `3d/${prefix}` },
  });
  await comfy.run(prompt, log, signal);
  const dir = path.join(outputDir, '3d');
  const hit = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.glb')).sort().pop();
  if (!hit) throw new Error('ComfyUI nao gerou o GLB');
  return path.join(dir, hit);
}
