import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdminConsole } from './admin.js';
import { createMilestoneAnchor, type MilestoneAnchorClient } from './anchor.js';
import { MilestoneAnchorCoordinator } from './milestone-anchor.js';
import { PeerSyncEngine } from './peer-sync.js';
import { validateCandidateBlocks } from './peer-sync.js';
import { BLOCK_INTERVAL_MS_DEFAULT, BLOCK_JITTER_MS_DEFAULT } from './constants.js';
import { QuestionFactory } from './question-factory.js';
import { QuizScheduler } from './scheduler.js';
import { buildChainApi } from './server.js';
import { ChainStore } from './store.js';
import { QuizChain } from './quiz-chain.js';
import { registerQuizApp } from '../worldbank/quiz-app.js';

export interface ChainNodeOptions {
  readonly port?: number;
  readonly host?: string;
  /** Base interval between blocks in ms (default 3,600,000 ≈ the spec's 60 min). */
  readonly intervalMs?: number;
  readonly jitterMs?: number;
  readonly adminUsername?: string;
  readonly adminPassword?: string;
  readonly dataDir?: string;
  /** Base PoW difficulty bits (default from POW_BITS, else 12). */
  readonly powBits?: number;
  /**
   * Milestone anchor client (Amoy testnet). Default: built from
   * ANCHOR_CONTRACT_ADDRESS + ANCHOR_PRIVATE_KEY when both are set; anchoring
   * stays disabled when they are absent. Pass `null` to force-disable.
   */
  readonly anchorClient?: MilestoneAnchorClient | null;
  /** Absolute peer node URLs to sync from (default: PEER_URLS, CSV). */
  readonly peerUrls?: readonly string[];
  /** How often to poll peers (ms; default PEER_SYNC_INTERVAL_MS or 30,000). */
  readonly peerSyncIntervalMs?: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** A running quiz-chain node (returned by {@link startChainNode}). */
export interface ChainNode {
  readonly port: number;
  /** Milestone anchoring queue/status (enabled or disabled). */
  readonly anchor: MilestoneAnchorCoordinator;
  /** The peer-sync engine (inspect peers/decisions in tests). */
  readonly peerSync: PeerSyncEngine;
  /** Runs one peer-sync round on demand (used by tests). */
  readonly runPeerSyncRound: () => Promise<void>;
  /** Stops the scheduler + peer sync, drains anchor txs, closes API + store. */
  readonly close: () => Promise<void>;
}

/**
 * Wires the full quiz-chain node: chain + scheduler (60 min ± jitter, strict
 * sequencing) + admin console + HTTP API, and serves a Thai dashboard.
 */
export async function startChainNode(options: ChainNodeOptions = {}): Promise<ChainNode> {
  const port = options.port ?? Number(process.env.PORT ?? 4100);
  const host = options.host ?? '0.0.0.0';
  const intervalMs = options.intervalMs ?? Number(process.env.BLOCK_INTERVAL_MS ?? BLOCK_INTERVAL_MS_DEFAULT);
  const jitterMs = options.jitterMs ?? Number(process.env.BLOCK_JITTER_MS ?? BLOCK_JITTER_MS_DEFAULT);
  const dataDir = options.dataDir ?? process.env.CHAIN_DATA_DIR ?? path.resolve(HERE, '../../../.chain-data');
  const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD ?? 'change-me-now';

  await mkdir(dataDir, { recursive: true });
  const admin = new AdminConsole({
    username: options.adminUsername ?? process.env.ADMIN_USERNAME ?? 'admin',
    password: adminPassword,
    dataDir: path.join(dataDir, 'admin'),
  });
  await admin.initialize();

  const questionFactory = new QuestionFactory();
  const baseDifficultyBits = options.powBits ?? Number(process.env.POW_BITS ?? 12);
  const chain = new QuizChain({ baseDifficultyBits, questionFactory });
  const store = new ChainStore(dataDir);

  // Boot: the durable log is the single source of truth. Load, repair any
  // torn tail, restore all derived state from the blocks, and verify BEFORE
  // mining continues. A chain that fails verification is fatal — the node
  // refuses to extend a chain it cannot validate.
  const diskBlocks = await store.loadBlocks();
  if (diskBlocks.length > 0) {
    chain.restoreFromBlocks(diskBlocks);
    const verdict = chain.verifyChain();
    if (!verdict.valid) {
      throw new Error(`CHAIN_VERIFY_FAILED_AT_BOOT: ${verdict.errors.join(', ')}`);
    }
    console.log(`[chain] restored ${diskBlocks.length} block(s) from ${dataDir} — verifyChain OK`);
  }
  await store.open();

  // Amoy anchor: configured via env (contract + key + optional RPC). Missing
  // env simply disables anchoring; a malformed env fails the boot loudly so
  // a half-typed key can never silently drop milestones.
  let anchorClient: MilestoneAnchorClient | null;
  if (options.anchorClient !== undefined) {
    anchorClient = options.anchorClient;
  } else {
    const envAddress = process.env.ANCHOR_CONTRACT_ADDRESS?.trim() ?? '';
    const envKey = process.env.ANCHOR_PRIVATE_KEY?.trim() ?? '';
    if (envAddress !== '' && envKey !== '') {
      anchorClient = createMilestoneAnchor({
        contractAddress: envAddress,
        privateKey: envKey,
        rpcUrl: process.env.AMOY_RPC_URL?.trim() || undefined,
      });
      console.log(`[anchor] enabled — MilestoneAnchor ${envAddress} on Polygon Amoy (wallet ${anchorClient.anchorAddress})`);
    } else {
      anchorClient = null;
      console.log('[anchor] disabled — set ANCHOR_CONTRACT_ADDRESS + ANCHOR_PRIVATE_KEY to anchor milestones on Amoy');
    }
  }
  const anchorCoordinator = new MilestoneAnchorCoordinator(anchorClient);

  // Peer sync: poll configured peers, adopt their chain ONLY when it passes
  // the full verifyChain rule set AND carries more cumulative PoW work than
  // our own (fork choice = heaviest valid chain).
  const peerUrls = (options.peerUrls ?? (process.env.PEER_URLS ?? '').split(',').map((url) => url.trim()).filter((url) => url.length > 0));
  const peerSyncIntervalMs = options.peerSyncIntervalMs ?? Number(process.env.PEER_SYNC_INTERVAL_MS ?? 30_000);
  const peerSync = new PeerSyncEngine({
    baseDifficultyBits,
    questionFactory,
    peerUrls,
    log: (message) => console.log(message),
  });
  let peerSyncTimer: ReturnType<typeof setInterval> | null = null;
  let peerSyncBusy = false;
  const runSyncRound = async (): Promise<void> => {
    if (peerUrls.length === 0 || peerSyncBusy) return;
    peerSyncBusy = true;
    try {
      await peerSync.syncRound({
        ownHeight: chain.height,
        ownWork: chain.totalCumulativeWork,
        adopt: async (blocks) => {
          // Defensive re-validation at the commit point (fail-closed) with the
          // SAME rules as verifyChain, incl. question/answer-commitment checks.
          const verdict = validateCandidateBlocks(blocks, baseDifficultyBits, questionFactory);
          if (!verdict.valid) throw new Error(`PEER_CHAIN_INVALID: ${verdict.errors.join(', ')}`);
          // Disk first: if the durable swap fails, memory stays untouched.
          await store.rewriteBlocks(blocks); // atomic temp+rename swap
          chain.replaceFromBlocks(blocks);
          // Re-open a window from the NEW tip (the old open block belonged
          // to the discarded fork). Scheduling window restarts cleanly.
          chain.startNextBlock('peer-sync');
        },
      });
    } catch (error) {
      console.error('[peer-sync] round failed:', error instanceof Error ? error.message : error);
    } finally {
      peerSyncBusy = false;
    }
  };

  const scheduler = new QuizScheduler({ intervalMs, jitterMs }, {
    mineBlock: async () => {
      // Window lifecycle: a tick SEALS the block that has been open for the
      // whole interval, makes it durable, then opens the next one so miners
      // again get the full ~60 s to answer. (Opening + sealing inside the
      // same tick would leave every block a 0 ms answer window.)
      if (chain.openQuestion !== null) {
        const block = chain.sealCurrentBlock();
        try {
          await store.appendBlock(block);
        } catch (storeError) {
          // Fail-stop: never keep mining on top of a block that is not durable.
          console.error('[chain] FATAL: append failed — halting scheduler:', storeError instanceof Error ? storeError.message : storeError);
          scheduler.stop();
          throw storeError;
        }
        // Fire-and-forget: anchoring a milestone must never stall mining.
        if (block.milestone !== null) anchorCoordinator.enqueue(block.milestone);
      }
      chain.startNextBlock('scheduler');
    },
    onError: (error) => {
      console.error('[chain] mine failed:', error instanceof Error ? error.message : error);
    },
  });
  // Open the next block right away so the first window is playable (height 1
  // on a fresh chain, or the successor of the restored tip).
  chain.startNextBlock('scheduler');

  const app = await buildChainApi({
    chain,
    admin,
    questionFactory,
    totalCumulativeWork: () => chain.totalCumulativeWork,
    sealAndAdvance: async () => {
      if (chain.openQuestion === null) throw new Error('NO_OPEN_BLOCK');
      const block = chain.sealCurrentBlock();
      await store.appendBlock(block);
      if (block.milestone !== null) anchorCoordinator.enqueue(block.milestone);
      chain.startNextBlock('scheduler');
      return { sealedHeight: block.height, nextHeight: block.height + 1 };
    },
  });

  const dashboard = buildDashboardHtml();
  app.get('/', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return dashboard;
  });
  app.get('/admin', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return buildAdminHtml();
  });

  // Local world-v1 quiz trainer for Windows 11 browsers: http://localhost:<port>/quiz
  registerQuizApp(app, { allowRemote: process.env.NEXUS_QUIZ_ALLOW_REMOTE === '1' });

  scheduler.start();
  await app.listen({ port, host });
  const address = app.server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  console.log(`[chain] quiz-chain node listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${boundPort} (block ≈ ${Math.round(intervalMs / 1000)}s ± ${Math.round(jitterMs / 1000)}s)`);
  if (peerUrls.length > 0) {
    console.log(`[peer-sync] polling ${peerUrls.length} peer(s) every ${Math.round(peerSyncIntervalMs / 1000)}s`);
    peerSyncTimer = setInterval(() => {
      void runSyncRound();
    }, peerSyncIntervalMs);
    await runSyncRound(); // one round right away (awaited so tests/boot are deterministic)
  }

  return {
    port: boundPort,
    anchor: anchorCoordinator,
    peerSync,
    runPeerSyncRound: runSyncRound,
    close: async () => {
      if (peerSyncTimer !== null) clearInterval(peerSyncTimer);
      scheduler.stop();
      // Give a pending milestone tx a chance to land before shutting down.
      await anchorCoordinator.close();
      await app.close();
      await store.close();
    },
  };
}

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: 'Sarabun','Noto Sans Thai',system-ui,sans-serif; background:#0b1020; color:#e8ecff; margin:0; padding:24px; }
  h1 { font-size:1.5rem; margin:0 0 4px; } h2 { font-size:1.1rem; margin:24px 0 8px; color:#9fb4ff; }
  .card { background:#141b33; border:1px solid #2a3560; border-radius:14px; padding:16px; margin-bottom:16px; }
  .muted { color:#8a94b8; font-size:0.85rem; }
  .pill { display:inline-block; padding:2px 10px; border-radius:999px; font-size:0.78rem; margin-right:6px; }
  .pill.hard { background:#3a1d2e; color:#ff9db1; border:1px solid #7c2d4e; }
  .pill.milestone { background:#173a2f; color:#7dffc4; border:1px solid #1f6f52; }
  code, .hash { font-family:ui-monospace,monospace; font-size:0.78rem; color:#9fb4ff; word-break:break-all; }
  table { width:100%; border-collapse:collapse; font-size:0.88rem; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #232c52; }
  th { color:#8a94b8; font-weight:500; }
  input, button { font:inherit; border-radius:8px; padding:8px 10px; border:1px solid #2a3560; background:#0e1530; color:#e8ecff; }
  button { background:#2c4bd8; border:none; cursor:pointer; } button:hover { background:#3c5cf0; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .ok { color:#7dffc4; } .bad { color:#ff9db1; }
`;

function buildDashboardHtml(): string {
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nexus Quiz Chain — ขุดความรู้</title><style>${STYLE}</style></head><body>
<h1>⛓️ Nexus Quiz Chain</h1><div class="muted">บล็อกเชนขุดความรู้ (SHA-256) — 1 บล็อก ≈ 60 วินาที · ทุก 10 บล็อกเป็นบล็อกยาก · ทุก 1,000 บล็อกมีแฮชไมล์สโตน</div>
<div id="app"><div class="card muted">กำลังโหลด…</div></div>
<script>
async function j(url, opt) { const r = await fetch(url, opt); return { status: r.status, body: await r.json().catch(() => ({})) }; }
function pill(b) { return (b.isHard ? '<span class="pill hard">บล็อกยาก</span>' : '') + (b.isMilestone ? '<span class="pill milestone">ไมล์สโตน</span>' : ''); }
async function refresh() {
  const s = await j('/api/status');
  if (s.status !== 200) { document.getElementById('app').innerHTML = '<div class="card bad">เชื่อมต่อไม่ได้</div>'; return; }
  const st = s.body;
  const q = await j('/api/question/current');
  const blocks = await j('/api/blocks?limit=10');
  let qHtml = '<div class="card muted">ยังไม่มีบล็อกที่กำลังขุด — รอบล็อกถัดไป (บล็อกใหม่เริ่มได้เมื่อบล็อกก่อนเสร็จ)</div>';
  if (q.status === 200) {
    const { blockHeight, question } = q.body;
    qHtml = '<div class="card"><div class="muted">บล็อกที่ ' + blockHeight + ' · ' + question.disciplineTh + ' · ระดับ ' + question.difficulty + '/10</div>' +
      '<h2>' + question.promptTh + '</h2><div class="row">' +
      question.options.map((o, i) => '<button onclick="answer(' + blockHeight + ',' + i + ')">' + o + '</button>').join('') +
      '</div><div id="answerMsg" class="muted" style="margin-top:8px"></div></div>';
  }
  const rows = blocks.body.blocks.map((b) => '<tr><td>#' + b.height + pill(b) + '</td><td class="hash">' + b.hash.slice(0, 18) + '…</td><td>' + b.difficultyBits + ' bits</td><td>' + b.attempts.toLocaleString() + '</td><td>' + b.question.disciplineTh + ' · ' + b.question.difficulty + '/10</td><td class="ok">' + (b.revealedAnswerIndex != null ? (b.question.options[b.revealedAnswerIndex] || '—') : '—') + '</td></tr>').join('');
  document.getElementById('app').innerHTML =
    '<div class="card row"><div>ความสูง: <b>#' + st.height + '</b></div><div>แฮชทั้งหมด: <b>' + st.totalAttempts.toLocaleString() + '</b></div>' +
    '<div>คำตอบถูก: <b class="ok">' + st.correctAnswers + '</b>/' + st.totalAnswers + '</div><div>ไมล์สโตนล่าสุด: <b>#' + st.lastMilestoneHeight + '</b></div>' +
    '<div>ตรวจเชน: <a href="/api/verify" style="color:#9fb4ff">/api/verify</a></div></div>' +
    qHtml +
    '<h2>บล็อกล่าสุด</h2><div class="card"><table><tr><th>บล็อก</th><th>แฮช</th><th>PoW</th><th>ลองแฮช</th><th>โจทย์</th><th>เฉลย (สาธารณะ)</th></tr>' + rows + '</table></div>';
}
async function answer(blockHeight, choice) {
  const miner = localStorage.getItem('miner') || ('miner-' + Math.random().toString(36).slice(2, 8));
  localStorage.setItem('miner', miner);
  const r = await j('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blockHeight, miner, choice }) });
  const el = document.getElementById('answerMsg');
  if (el) el.textContent = r.body.messageTh || r.body.error || '';
  setTimeout(refresh, 400);
}
refresh(); setInterval(refresh, 5000);
</script></body></html>`;
}

function buildAdminHtml(): string {
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>หลังบ้าน — Nexus Quiz Chain</title><style>${STYLE}</style></head><body>
<h1>🔐 หลังบ้าน (Admin)</h1><div class="muted">เข้าสู่ระบบเพื่อเปลี่ยน/เพิ่มคำตอบ — การแก้ไขทุกรายการถูกฝังลงบล็อกเชน</div>
<div class="card"><h2>เข้าสู่ระบบ</h2><div class="row">
<input id="u" placeholder="ชื่อผู้ใช้" value="admin"><input id="p" type="password" placeholder="รหัสผ่าน">
<button onclick="login()">เข้าสู่ระบบ</button></div><div id="msg" class="muted" style="margin-top:8px"></div></div>
<div class="card"><h2>เปลี่ยน/เพิ่มคำตอบ</h2><div class="row">
<input id="qid" placeholder="รหัสคำถาม เช่น q-000001" style="min-width:220px">
<select id="ai"><option value="0">ข้อ 1</option><option value="1">ข้อ 2</option><option value="2">ข้อ 3</option><option value="3">ข้อ 4</option></select>
<button onclick="editAnswer()">บันทึกคำตอบ</button></div>
<h2>เพิ่มคำถามใหม่</h2><div class="row">
<input id="np_th" placeholder="โจทย์ (ไทย)" style="min-width:280px"><input id="np_en" placeholder="โจทย์ (EN)" style="min-width:280px"></div>
<div class="row" style="margin-top:8px">
<input id="o0" placeholder="ตัวเลือก 1"><input id="o1" placeholder="ตัวเลือก 2"><input id="o2" placeholder="ตัวเลือก 3"><input id="o3" placeholder="ตัวเลือก 4 (คำตอบ)"></div>
<div class="row" style="margin-top:8px"><button onclick="addQuestion()">เพิ่มคำถาม</button></div></div>
<script>
let TOKEN = sessionStorage.getItem('token') || '';
async function j(url, opt) { const r = await fetch(url, opt); return { status: r.status, body: await r.json().catch(() => ({})) }; }
async function login() {
  const r = await j('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value }) });
  const el = document.getElementById('msg');
  if (r.status === 200) { TOKEN = r.body.token; sessionStorage.setItem('token', TOKEN); el.textContent = '✅ เข้าสู่ระบบสำเร็จ'; el.className = 'ok'; }
  else { el.textContent = r.body.messageTh || 'เข้าสู่ระบบไม่สำเร็จ'; el.className = 'bad'; }
}
async function editAnswer() {
  const r = await j('/api/admin/answers/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN, questionId: document.getElementById('qid').value, answerIndex: Number(document.getElementById('ai').value) }) });
  const el = document.getElementById('msg'); el.textContent = r.body.messageTh || r.body.error || ''; el.className = r.status === 200 ? 'ok' : 'bad';
}
async function addQuestion() {
  const q = { discipline: 'math', difficulty: 5, prompt: { th: document.getElementById('np_th').value, en: document.getElementById('np_en').value }, options: [0,1,2,3].map((i) => document.getElementById('o'+i).value), answerIndex: 3 };
  const r = await j('/api/admin/questions/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN, question: q }) });
  const el = document.getElementById('msg'); el.textContent = r.body.messageTh || r.body.error || ''; el.className = r.status === 200 ? 'ok' : 'bad';
}
</script></body></html>`;
}

// Allow `node dist/chain/node.js` direct execution.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void startChainNode();
}
