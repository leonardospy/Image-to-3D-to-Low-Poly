// Le a descricao livre da cena ("o que esta nas fotos") e devolve dicas para a reconstrucao:
// simetria, tamanho real, acabamento do material, por onde a volta comecou, quanto se andou em volta e o sentido.
const strip = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const CATS = [
  { id: 'carro', label: 'carro', size: 4.3, sym: 'mirror', rough: 0.4, metal: 0.15, words: ['carro', 'automovel', 'veiculo', 'sedan', 'seda', 'hatch', 'suv', 'picape', 'pickup', 'caminhonete', 'jipe', 'jeep', 'van', 'perua', 'conversivel', 'car', 'truck', 'fusca', 'golf', 'gol', 'civic', 'corolla', 'onix', 'uno', 'kombi', 'camaro', 'mustang', 'porsche', 'ferrari', 'mazda', 'rx-7', 'rx7', 'toyota', 'supra', 'honda', 'nissan', 'skyline', 'ford', 'chevrolet', 'fiat', 'volkswagen', 'vw', 'bmw', 'audi', 'mercedes', 'hyundai', 'renault', 'peugeot', 'subaru', 'mitsubishi', 'lamborghini'] },
  { id: 'onibus', label: 'ônibus/caminhão', size: 10, sym: 'mirror', rough: 0.45, metal: 0.1, words: ['onibus', 'caminhao', 'carreta', 'bus', 'lorry'] },
  { id: 'moto', label: 'moto', size: 2.1, sym: 'mirror', rough: 0.4, metal: 0.3, words: ['moto', 'motocicleta', 'scooter', 'motorcycle', 'motorbike'] },
  { id: 'bike', label: 'bicicleta', size: 1.75, sym: 'mirror', rough: 0.5, metal: 0.4, words: ['bicicleta', 'bike', 'bicycle'] },
  { id: 'busto', label: 'busto/cabeça', size: 0.6, sym: 'mirror', rough: 0.6, metal: 0, words: ['busto', 'cabeca', 'rosto', 'bust', 'head', 'face'] },
  { id: 'pessoa', label: 'pessoa/estátua', size: 1.7, sym: 'mirror', rough: 0.7, metal: 0, words: ['pessoa', 'homem', 'mulher', 'crianca', 'estatua', 'boneco', 'boneca', 'figura', 'action figure', 'person', 'man', 'woman', 'statue', 'figurine', 'doll'] },
  { id: 'animal', label: 'animal', size: 0.6, sym: 'mirror', rough: 0.85, metal: 0, words: ['cachorro', 'cao', 'gato', 'cavalo', 'passaro', 'animal', 'pelucia', 'urso', 'dog', 'cat', 'horse', 'bird', 'teddy'] },
  { id: 'cadeira', label: 'cadeira', size: 0.9, sym: 'mirror', rough: 0.6, metal: 0, words: ['cadeira', 'poltrona', 'banqueta', 'banco', 'chair', 'stool', 'armchair'] },
  { id: 'mesa', label: 'mesa', size: 1.2, sym: 'mirror', rough: 0.55, metal: 0, words: ['mesa', 'escrivaninha', 'table', 'desk'] },
  { id: 'sofa', label: 'sofá', size: 2, sym: 'mirror', rough: 0.9, metal: 0, words: ['sofa', 'couch'] },
  { id: 'caneca', label: 'caneca/xícara', size: 0.11, sym: 'mirror', rough: 0.25, metal: 0, words: ['caneca', 'xicara', 'chaleira', 'bule', 'mug', 'teapot', 'kettle'] },
  { id: 'revolucao', label: 'objeto de revolução', size: 0.3, sym: 'rot', rough: 0.3, metal: 0, words: ['garrafa', 'vaso', 'copo', 'lata', 'pote', 'jarra', 'vela', 'taca', 'tigela', 'cumbuca', 'cilindro', 'abajur', 'bola', 'globo', 'bottle', 'vase', 'cup', 'glass', 'can', 'jar', 'candle', 'bowl', 'cylinder', 'ball'] },
  { id: 'capacete', label: 'capacete', size: 0.3, sym: 'mirror', rough: 0.3, metal: 0, words: ['capacete', 'helmet'] },
  { id: 'sapato', label: 'calçado', size: 0.3, sym: 'none', rough: 0.7, metal: 0, words: ['tenis', 'sapato', 'bota', 'sandalia', 'chinelo', 'shoe', 'sneaker', 'boot'] },
  { id: 'eletronico', label: 'aparelho', size: 0.15, sym: 'mirror', rough: 0.45, metal: 0.1, words: ['controle', 'joystick', 'mouse', 'fone', 'headphone', 'controller', 'gamepad'] },
  { id: 'caixa', label: 'caixa/livro', size: 0.3, sym: 'none', rough: 0.7, metal: 0, words: ['caixa', 'livro', 'cubo', 'box', 'book', 'cube'] },
  { id: 'fruta', label: 'fruta/comida', size: 0.09, sym: 'none', rough: 0.55, metal: 0, words: ['maca', 'laranja', 'banana', 'pera', 'fruta', 'pao', 'bolo', 'apple', 'orange', 'fruit', 'bread', 'cake'] },
  { id: 'planta', label: 'planta', size: 0.5, sym: 'none', rough: 0.8, metal: 0, words: ['planta', 'arvore', 'flor', 'cacto', 'plant', 'tree', 'flower', 'cactus'] },
  { id: 'pedra', label: 'pedra/escultura', size: 0.3, sym: 'none', rough: 0.9, metal: 0, words: ['pedra', 'rocha', 'tronco', 'rock', 'stone', 'log'] },
];

const MATS = [
  { label: 'metálico', rough: 0.3, metal: 0.85, words: ['metal', 'metalico', 'aco', 'aluminio', 'cromado', 'ferro', 'bronze', 'cobre', 'latao', 'chrome', 'steel', 'iron', 'copper', 'brass'] },
  { label: 'vidro', rough: 0.05, metal: 0, words: ['vidro', 'cristal', 'glass'] },
  { label: 'cerâmica', rough: 0.25, metal: 0, words: ['ceramica', 'porcelana', 'louca', 'ceramic', 'porcelain'] },
  { label: 'madeira', rough: 0.7, metal: 0, words: ['madeira', 'wood', 'wooden'] },
  { label: 'plástico', rough: 0.45, metal: 0, words: ['plastico', 'plastic', 'lego'] },
  { label: 'couro', rough: 0.55, metal: 0, words: ['couro', 'leather'] },
  { label: 'tecido', rough: 0.95, metal: 0, words: ['tecido', 'pano', 'pelucia', 'la', 'algodao', 'fabric', 'cloth', 'plush', 'wool'] },
  { label: 'pedra', rough: 0.9, metal: 0, words: ['concreto', 'cimento', 'marmore', 'granito', 'concrete', 'marble'] },
  { label: 'brilhante', rough: 0.2, words: ['brilhante', 'polido', 'envernizado', 'laqueado', 'glossy', 'shiny', 'polished'] },
  { label: 'fosco', rough: 0.9, words: ['fosco', 'opaco', 'matte'] },
];

const has = (t, w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(t);

export function parseScene(text) {
  const t = strip(text || '');
  const out = { text: text || '', chips: [] };
  if (!t.trim()) return out;

  // categoria: a palavra que aparece primeiro no texto ganha
  let cat = null, at = Infinity;
  for (const c of CATS)
    for (const w of c.words) {
      const m = new RegExp(`(^|[^a-z])${w}s?([^a-z]|$)`).exec(t);
      if (m && m.index < at) { at = m.index; cat = c; }
    }
  if (cat) {
    out.category = cat.id;
    out.sym = cat.sym;
    out.size = cat.size;
    out.rough = cat.rough;
    out.metal = cat.metal;
    out.chips.push(cat.label);
  }

  // material / acabamento
  for (const m of MATS)
    if (m.words.some((w) => has(t, w))) {
      if (m.rough != null) out.rough = m.rough;
      if (m.metal != null) out.metal = m.metal;
      out.chips.push(m.label);
    }

  // tamanho explicito: "4,3 m", "30 cm", "120mm" -> maior medida em metros
  let size = 0;
  for (const m of t.matchAll(/(\d+(?:[.,]\d+)?)\s*(mm|cm|m|metros?|centimetros?|milimetros?)(?![a-z])/g)) {
    const v = parseFloat(m[1].replace(',', '.'));
    const u = m[2].startsWith('mm') || m[2].startsWith('mili') ? 0.001 : m[2].startsWith('c') ? 0.01 : 1;
    size = Math.max(size, v * u);
  }
  if (size > 0) { out.size = size; out.sizeGiven = true; }

  // medidas completas: "4,28 x 1,76 x 1,23 m" (comprimento x largura x altura) ou "largura 1,76 m", "altura 123 cm"...
  const num = String.raw`(\d+(?:[.,]\d+)?)`, unit = '(mm|cm|m)?';
  const toM = (v, u) => parseFloat(v.replace(',', '.')) * (u === 'mm' ? 0.001 : u === 'cm' ? 0.01 : 1);
  const tri = new RegExp(String.raw`${num}\s*${unit}\s*[x×]\s*${num}\s*${unit}\s*[x×]\s*${num}\s*${unit}`).exec(t);
  const dims = {};
  if (tri) {
    const u = tri[6] || tri[4] || tri[2] || 'm';
    dims.L = toM(tri[1], tri[2] || u); dims.W = toM(tri[3], tri[4] || u); dims.H = toM(tri[5], tri[6] || u);
  }
  for (const [k, words] of [['L', 'comprimento|length'], ['W', 'largura|width'], ['H', 'altura|height']]) {
    const m = new RegExp(String.raw`(?:${words})\D{0,12}?${num}\s*${unit}`).exec(t);
    if (m) dims[k] = toM(m[1], m[2] || 'm');
  }
  if (Object.keys(dims).length) {
    out.dims = dims;
    out.size = Math.max(dims.L || 0, dims.W || 0, dims.H || 0, out.sizeGiven ? out.size : 0);
    out.sizeGiven = true;
  }
  const f2 = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  if (out.dims) out.chips.push('medidas: ' + ['L', 'W', 'H'].map((k) => (out.dims[k] ? f2(out.dims[k]) : '?')).join(' × ') + ' m (C × L × A)');
  else if (out.size) out.chips.push(`maior medida ≈ ${out.size.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m${out.sizeGiven ? '' : ' (típica)'}`);

  // simetria forcada pelo texto
  if (/(sem simetria|assimetric|nao e simetric|irregular|asymmetric)/.test(t)) out.sym = 'none';
  else if (/(simetric|espelhad|symmetric)/.test(t) && out.sym !== 'rot') out.sym = 'mirror';
  else if (/(redond|cilindric|torneado|de revolucao)/.test(t) && !cat) out.sym = 'rot';
  if (out.sym === 'mirror') out.chips.push('simetria espelhada');
  if (out.sym === 'rot') out.chips.push('simetria de revolução');

  // por onde comecou a volta (a 1a foto mostra...)
  if (/(comec|inici|primeira foto|1a foto)[^.]*?(traseira|tras|costas|fundo)/.test(t) || /(comec|inici)[^.]*?(pela|por) (parte de )?tras/.test(t)) { out.start = 180; out.chips.push('1ª foto: traseira'); }
  else if (/(comec|inici|primeira foto|1a foto)[^.]*?lado esquerdo/.test(t)) { out.start = 90; out.chips.push('1ª foto: lado esquerdo'); }
  else if (/(comec|inici|primeira foto|1a foto)[^.]*?lado direito/.test(t)) { out.start = -90; out.chips.push('1ª foto: lado direito'); }

  // quanto andou em volta
  if (/(meia volta|180|so a frente e os lados|metade)/.test(t)) { out.span = 180; out.chips.push('meia volta'); }
  else if (/(so a frente|so de frente|90 graus|um quarto)/.test(t)) { out.span = 90; out.chips.push('só a frente'); }
  else if (/(volta completa|360|toda a volta|ao redor|em volta)/.test(t)) { out.span = 360; }

  if (/(pendurad|suspens|na mao|segurando|flutuando|hanging|in hand)/.test(t)) { out.ground = false; out.chips.push('sem chão'); }

  if (/anti[- ]?horario|counter[- ]?clockwise/.test(t)) { out.dir = 'ccw'; out.chips.push('sentido anti-horário'); }
  else if (/horario|clockwise/.test(t)) { out.dir = 'cw'; out.chips.push('sentido horário'); }
  return out;
}

// classes do ImageNet (reconhecimento automatico) -> categoria; soma as notas das 5 primeiras por categoria
const IMAGENET = {
  carro: ['sports car', 'racer', 'cab', 'convertible', 'limousine', 'minivan', 'beach wagon', 'station wagon', 'jeep', 'pickup', 'car wheel', 'grille', 'model t', 'police van', 'ambulance', 'go-kart'],
  onibus: ['school bus', 'trolleybus', 'minibus', 'moving van', 'trailer truck', 'fire engine', 'garbage truck', 'tow truck'],
  moto: ['moped', 'motor scooter'],
  bike: ['mountain bike', 'bicycle-built-for-two', 'tricycle', 'unicycle'],
  cadeira: ['folding chair', 'rocking chair', 'barber chair', 'throne'],
  mesa: ['dining table', 'desk'],
  sofa: ['studio couch'],
  caneca: ['coffee mug', 'teapot', 'cup'],
  revolucao: ['beer bottle', 'wine bottle', 'water bottle', 'pop bottle', 'pill bottle', 'whiskey jug', 'water jug', 'vase', 'beer glass', 'goblet', 'candle', 'bucket', 'barrel', 'pot, flowerpot', 'mixing bowl', 'soup bowl'],
  capacete: ['crash helmet', 'football helmet'],
  sapato: ['running shoe', 'sandal', 'clog', 'cowboy boot', 'loafer'],
  animal: ['teddy'],
};
export function categoryFromLabels(results) {
  const sum = {};
  for (const { label, score } of results) {
    const l = label.toLowerCase();
    for (const [cat, keys] of Object.entries(IMAGENET)) if (keys.some((k) => l.includes(k))) sum[cat] = (sum[cat] || 0) + score;
  }
  const best = Object.entries(sum).sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 0.25) return null;
  const c = CATS.find((x) => x.id === best[0]);
  return { category: c.id, label: c.label, score: best[1], sym: c.sym, size: c.size, rough: c.rough, metal: c.metal };
}
