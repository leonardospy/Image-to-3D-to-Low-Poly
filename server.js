import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runJob } from './lib/pipeline.js';
import { buildModels } from './lib/postprocess.js';
import { locateTools } from './lib/tools.js';
import { runAiJob, runHunyuanJob, runTrellisJob, comfyAvailable, releaseComfy, aiPython } from './lib/ai.js';

const root = path.dirname(fileURLToPath(import.meta.url));
let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')); } catch {}
const DATA = process.env.DATA_DIR || cfg.dataDir || path.join(root, 'data', 'jobs');
fs.mkdirSync(DATA, { recursive: true });

const jobs = new Map();
const app = express();

// A pagina do GitHub Pages (e o proprio localhost) podem usar este gerador local: CORS so para essas origens.
const ORIGINS = [/^https:\/\/leonardospy\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.some((r) => r.test(o))) {
    res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Private-Network': 'true' });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(root, 'public')));
app.use('/files', express.static(DATA));

const newId = () => crypto.randomBytes(5).toString('hex');
const upload = multer({
  storage: multer.diskStorage({
    destination(req, _f, cb) {
      req.jobId ||= newId();
      const d = path.join(DATA, req.jobId, 'images');
      fs.mkdirSync(d, { recursive: true });
      cb(null, d);
    },
    filename: (_r, f, cb) => cb(null, path.basename(f.originalname).replace(/[^\w.\-]/g, '_')),
  }),
  fileFilter: (_r, f, cb) => cb(null, /\.(jpe?g|png|tiff?|webp)$/i.test(f.originalname)),
  limits: { files: 300, fileSize: 60 * 1024 * 1024 },
});

function emit(job) {
  const data = `data: ${JSON.stringify({ status: job.status, step: job.step, progress: job.progress, stats: job.stats, error: job.error })}\n\n`;
  job.clients.forEach((res) => res.write(data));
}

app.get('/api/tools', (_req, res) => res.json({ ...locateTools(), ai: !!aiPython(), comfy: comfyAvailable() }));

app.post('/api/jobs', upload.array('photos', 300), (req, res) => {
  const files = req.files || [];
  const hy = req.body.engine === 'hunyuan';
  const tr = req.body.engine === 'trellis';
  const ai = req.body.engine === 'ai' || hy || tr;
  if (ai ? files.length < 1 : files.length < 8) return res.status(400).json({ error: ai ? 'Envie pelo menos 1 foto.' : 'Envie pelo menos 8 fotos (ideal: 30-80).' });
  if (tr && !comfyAvailable()) return res.status(400).json({ error: 'ComfyUI nao encontrado (veja README).' });
  if (ai && !aiPython()) return res.status(400).json({ error: 'Ambiente de IA nao instalado (veja ai/README.md).' });
  const job = {
    id: req.jobId, dir: path.join(DATA, req.jobId), status: 'running', step: 'Na fila', progress: 0,
    log: [], clients: new Set(), stats: null, error: null, abort: new AbortController(),
  };
  jobs.set(job.id, job);
  const log = (l) => { job.log.push(l); job.clients.forEach((r) => r.write(`event: log\ndata: ${JSON.stringify(l)}\n\n`)); };
  const step = (s, p) => { job.step = s; job.progress = p; log(`== ${s}`); emit(job); };
  const opts = { quality: req.body.quality, lowPolyTris: Math.max(300, Math.min(100000, +req.body.lowPolyTris || 5000)) };
  const pick = files.find((f) => f.originalname === req.body.pick) || files[0];
  let viewMap = {};
  try { viewMap = JSON.parse(req.body.views || '{}'); } catch {}
  const views = {};
  for (const f of files) if (viewMap[f.originalname]) views[viewMap[f.originalname]] = f.path;
  if (hy && !Object.keys(views).length) views.front = pick.path;
  const dims = { lengthM: +req.body.length || 4.3, widthM: +req.body.width || 0, heightM: +req.body.height || 0 };
  const task = tr
    ? runTrellisJob(job, files.slice(0, 6).map((f) => f.path), { lowPolyTris: opts.lowPolyTris, photoSide: req.body.photoSide, ...dims }, log, step, job.abort.signal)
    : hy
    ? runHunyuanJob(job, views, { lowPolyTris: opts.lowPolyTris, removeBg: req.body.removeBg !== '0', lengthM: +req.body.length || 4.3, widthM: +req.body.width || 0, heightM: +req.body.height || 0 }, log, step, job.abort.signal)
    : ai
    ? runAiJob(job, pick.path, { lowPolyTris: opts.lowPolyTris, removeBg: req.body.removeBg !== '0' }, log, step, job.abort.signal)
    : runJob(job, opts, log, step, job.abort.signal);
  task
    .then((stats) => { job.status = 'done'; job.stats = stats; })
    .catch((e) => { job.status = 'error'; job.error = e.message; log(`ERRO: ${e.message}`); })
    .finally(() => { emit(job); releaseComfy(); });
  res.json({ id: job.id, photos: files.length });
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.sendStatus(404);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  job.log.forEach((l) => res.write(`event: log\ndata: ${JSON.stringify(l)}\n\n`));
  job.clients.add(res);
  emit(job);
  req.on('close', () => job.clients.delete(res));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
  jobs.get(req.params.id)?.abort.abort();
  res.json({ ok: true });
});

// Reprocessa o OBJ ja texturizado com outro alvo de poligonos (sem refazer a fotogrametria)
app.post('/api/jobs/:id/relowpoly', express.json(), async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== 'done') return res.sendStatus(409);
  try {
    const mvs = path.join(job.dir, 'mvs');
    const raw = path.join(job.dir, 'ai_raw.glb');
    const obj = fs.existsSync(raw) ? raw : path.join(mvs, fs.readdirSync(mvs).find((f) => f.endsWith('.obj')));
    job.stats = await buildModels(obj, path.join(job.dir, 'out'), { lowPolyTris: Math.max(300, +req.body.lowPolyTris || 5000) });
    res.json(job.stats);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Foto -> 3D em http://localhost:${port}`));
