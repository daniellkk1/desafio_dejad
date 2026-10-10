'use strict';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
// Chave de acesso da organizacao (painel). Defina OWNER_KEY no EasyPanel.
const OWNER_KEY = process.env.OWNER_KEY || 'dejad-admin';
const ROUND_MS = Number(process.env.ROUND_MS || 20 * 60 * 1000); // 20 minutos
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS || 5 * 1000); // contagem comum
const TOTAL_PHASES = 7;

const app = express();
app.use(express.json({ limit: '256kb' }));

// ---------- Estado em memoria ----------
/**
 * rooms: Map<code, room>
 * room = { code, title, status, createdAt, startsAt, endsAt, players: Map<id, player>, order: [] }
 * player = { id, token, name, joinedAt, phase, stage, finished, finishedAt, durationMs }
 */
const rooms = new Map();

const now = () => Date.now();
const genCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
};
const genId = () => crypto.randomUUID();
const genToken = () => crypto.randomBytes(24).toString('hex');

function roomExpired(room) {
  return room.status === 'running' && room.endsAt && now() > room.endsAt;
}

// Monta o objeto room publico esperado pelo cliente (jogo + painel)
function serializeRoom(room) {
  const players = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    phase: p.phase,
    stage: p.stage,
    finished: p.finished,
  }));

  const finishers = [...room.players.values()]
    .filter((p) => p.finished)
    .sort((a, b) => {
      if (a.durationMs !== b.durationMs) return a.durationMs - b.durationMs;
      return a.joinedAt - b.joinedAt; // desempate: ordem de entrada
    });

  const ranking = finishers.map((p, i) => ({
    id: p.id,
    name: p.name,
    rank: i + 1,
    durationMs: p.durationMs,
  }));

  const podium = finishers.slice(0, 3).map((p) => ({
    id: p.id,
    name: p.name,
    durationMs: p.durationMs,
  }));

  return {
    code: room.code,
    title: room.title,
    status: room.status,
    startsAt: room.startsAt || 0,
    endsAt: room.endsAt || 0,
    players,
    ranking,
    podium,
  };
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    phase: player.phase,
    stage: player.stage,
    finished: player.finished,
    durationMs: player.durationMs,
  };
}

// Adiciona serverTime em toda resposta para sincronizar relogios
function reply(res, status, body) {
  res.status(status).json({ serverTime: now(), ...body });
}

// ---------- Auth da organizacao ----------
function requireOwner(req, res, next) {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== OWNER_KEY) {
    return reply(res, 401, { error: 'Chave da organizacao invalida.' });
  }
  next();
}

// Auth do jogador por token
function playerFromAuth(req) {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  for (const room of rooms.values()) {
    for (const p of room.players.values()) {
      if (p.token === token) return { room, player: p };
    }
  }
  return null;
}

// ================= ROTAS DO JOGADOR =================

// Entrar numa sala
app.post('/api/join', (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase();
  const name = String(req.body?.name || '').trim();
  if (!code || !name) return reply(res, 400, { error: 'Informe a sala e seu nome.' });
  if (name.length < 2 || name.length > 40) return reply(res, 400, { error: 'Nome invalido.' });

  const room = rooms.get(code);
  if (!room) return reply(res, 404, { error: 'Sala nao encontrada.' });
  if (room.status === 'closed') return reply(res, 409, { error: 'Esta rodada ja foi encerrada.' });
  if (room.status === 'running') return reply(res, 409, { error: 'A rodada ja comecou.' });

  const player = {
    id: genId(),
    token: genToken(),
    name,
    joinedAt: now(),
    phase: 0,
    stage: 0,
    finished: false,
    finishedAt: 0,
    durationMs: 0,
  };
  room.players.set(player.id, player);

  reply(res, 200, {
    player: { id: player.id, token: player.token, name: player.name, room: room.code },
    room: serializeRoom(room),
  });
});

// Estado da sala + do jogador (polling)
app.get('/api/players/:id', (req, res) => {
  const ctx = playerFromAuth(req);
  if (!ctx || ctx.player.id !== req.params.id) {
    return reply(res, 401, { error: 'Sessao do jogador invalida.' });
  }
  const { room, player } = ctx;

  // Fecha automaticamente quando o tempo acaba
  if (roomExpired(room)) room.status = 'closed';

  reply(res, 200, { room: serializeRoom(room), player: serializePlayer(player) });
});

// Avanco de fase / conclusao
app.post('/api/players/:id/stage', (req, res) => {
  const ctx = playerFromAuth(req);
  if (!ctx || ctx.player.id !== req.params.id) {
    return reply(res, 401, { error: 'Sessao do jogador invalida.' });
  }
  const { room, player } = ctx;

  if (room.status !== 'running') {
    return reply(res, 409, { error: 'A rodada nao esta em andamento.' });
  }
  if (roomExpired(room)) {
    room.status = 'closed';
    return reply(res, 409, { error: 'Tempo encerrado.' });
  }
  if (player.finished) {
    return reply(res, 200, {
      room: serializeRoom(room),
      finished: true,
      durationMs: player.durationMs,
    });
  }

  const phase = Number(req.body?.phase);
  if (!Number.isInteger(phase) || phase < 0 || phase >= TOTAL_PHASES) {
    return reply(res, 400, { error: 'Fase invalida.' });
  }
  // Aceita apenas o avanco da fase atual (anti-pulo)
  if (phase !== player.phase) {
    return reply(res, 409, { error: 'Fase fora de ordem.' });
  }

  player.stage = Math.max(player.stage, phase + 1);
  player.phase = Math.min(TOTAL_PHASES, phase + 1);

  let finished = false;
  // Concluiu a ultima fase
  if (phase === TOTAL_PHASES - 1) {
    player.finished = true;
    player.finishedAt = now();
    player.durationMs = Math.max(0, player.finishedAt - room.startsAt);
    finished = true;
  }

  reply(res, 200, {
    room: serializeRoom(room),
    finished,
    durationMs: player.durationMs,
  });
});

// ================= ROTAS DA ORGANIZACAO =================

// Snapshot publico da sala (usado pelo painel via selectRoom/poll)
app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  if (!room) return reply(res, 404, { error: 'Sala nao encontrada.' });
  if (roomExpired(room)) room.status = 'closed';
  reply(res, 200, { room: serializeRoom(room) });
});

// Listar salas da organizacao
app.get('/api/host/rooms', requireOwner, (req, res) => {
  const list = [...rooms.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((r) => ({ code: r.code, title: r.title, status: r.status }));
  reply(res, 200, { rooms: list });
});

// Criar sala
app.post('/api/host/rooms', requireOwner, (req, res) => {
  const title = String(req.body?.title || 'DEJAD CEARA-MIRIM').trim().slice(0, 80) || 'DEJAD CEARA-MIRIM';
  const room = {
    code: genCode(),
    title,
    status: 'waiting',
    createdAt: now(),
    startsAt: 0,
    endsAt: 0,
    players: new Map(),
  };
  rooms.set(room.code, room);
  reply(res, 200, { room: serializeRoom(room) });
});

// Iniciar / encerrar rodada
app.post('/api/host/rooms/:code/:action', requireOwner, (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  if (!room) return reply(res, 404, { error: 'Sala nao encontrada.' });
  const action = req.params.action;

  if (action === 'start') {
    if (room.status !== 'waiting') return reply(res, 409, { error: 'A rodada ja foi iniciada.' });
    if (room.players.size === 0) return reply(res, 409, { error: 'Nenhum jogador na sala.' });
    room.status = 'running';
    room.startsAt = now() + COUNTDOWN_MS; // inicio comum para todos
    room.endsAt = room.startsAt + ROUND_MS;
  } else if (action === 'end') {
    room.status = 'closed';
  } else {
    return reply(res, 400, { error: 'Acao desconhecida.' });
  }

  reply(res, 200, { room: serializeRoom(room) });
});

// ================= ESTATICOS =================
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/painel', (_req, res) => res.sendFile(path.join(__dirname, 'painel.html')));
app.use(express.static(__dirname, { extensions: ['html'] }));

// Health check para o EasyPanel
app.get('/healthz', (_req, res) => res.json({ ok: true, serverTime: now() }));

app.listen(PORT, () => {
  console.log(`A Cidade dos Iguais rodando na porta ${PORT}`);
});
