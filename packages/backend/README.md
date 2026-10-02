# @nexus/backend

Stateless Node.js 20 / Fastify / TypeScript backend for Nexus Architect **TESTNET ONLY**. It includes the Random Hourly Block Scheduler, the YAML Problem Bank API, and the **Quiz Chain engine** (`src/chain/`) — a SHA-256 knowledge-mining blockchain.

## Quiz Chain (ขุดความรู้)

ระบบบล็อกเชนขุดความรู้ตามสเปคของเจ้าของโปรเจ็กต์:

| กฎ | การ implement |
| --- | --- |
| 1 บล็อก = 1 คำถาม ≈ 60 นาที (สุ่มเวลา) | `QuizScheduler` เว้นช่วง 3,600 s ± 600 s jitter (ปรับได้ `BLOCK_INTERVAL_MS` / `BLOCK_JITTER_MS`) — ตอบไม่ทัน/ไม่มีคนตอบถูก บล็อกถัดไปเปิดต่อด้วยคำถามใหม่ทันที จึงมีโจทย์ค้างได้มากสุดเท่าจำนวนรอบที่ไม่มีผู้ตอบถูก |
| ผู้ชนะ 40% + ผู้ร่วมขุดที่ตอบถูก 60% | `pickWinner` (`src/chain/winner.ts`) เลือกผู้ตอบถูกที่เร็วที่สุดของบล็อกแบบ deterministic (เสมอเวลา = ลำดับที่ส่งก่อน) — ส่วน 40% เป็นของผู้ชนะ 1 ราย และ 60% แบ่งเฉพาะผู้ที่ตอบถูก “ในบล็อกนั้น” เท่านั้น |
| ไม่เปิดเผยผลถูก/ผิดระหว่างรอบ | `POST /api/answer` ตอบกลับแค่ `accepted` (ไม่มีฟิลด์ `correct`), ตัวนับ `totalAnswers` / `correctAnswers` ใน `/api/status` และแดชบอร์ด นับเฉพาะบล็อกที่ปิดผนึกแล้ว — ผลถูก/ผิดเผยแพร่พร้อมบล็อกผ่าน `GET /api/blocks/:height` เท่านั้น กัน AI ยิงครบ 4 ตัวเลือกแล้วเดาเฉลย (มีเทสคุม: `test/answerOracle.test.ts`) |
| บล็อกก่อนไม่จบ = บล็อกถัดไปไม่เกิด | strict sequencing — บล็อกใหม่เริ่มได้เมื่อบล็อกก่อน seal แล้วเท่านั้น (`BLOCK_ALREADY_OPEN`) |
| ทุก 10 บล็อกมี 1 บล็อกยาก | block ÷10 ใช้ PoW ยากขึ้น (+1 bit) และดึงโจทย์จากช่วงอันดับยากของคลัง |
| แฮชพิเศษทุก 1,000 บล็อก | block ÷1,000 มี `milestone.milestoneHash` = แฮชประวัติเชนทั้งหมด + cumulative work (+3 bits) |
| 100,000 คำถาม 12 วิชา | `quiz-bank.ts` เจนแบบ programmatic (deterministic) เรียงง่าย → ยาก, สุ่มวิชาตาม slot |
| คำถามข้ามวิชาไล่ระดับ (bank v2) | slot ≥ 523 ผสมข้ามสาขา **2 → 3 → 4 วิชา** (ทุก 1,000 บล็อก) — โจทย์นำหน้าด้วยชื่อวิชาที่ผสม เช่น `【คณิตศาสตร์ + ภูมิศาสตร์】`; คำตอบมาจากวิชาหลัก ส่วนเฉลยของวิชาอื่นกลายเป็นตัวลวง ทำให้ตอบผิดได้เพราะ "แก้วิชาผิด" — สลับง่าย→ยากครบสเปกของเจ้าของ; slot ที่ถูกขุดไปแล้ว (0–522 และ hard tier 90000–90520) ถูก freeze เป็นสูตร v1 เพื่อไม่ให้ verifyChain ล้มย้อนหลัง |
| คำถาม+คำตอบฝังในเชน (SHA-256) | แฮชบล็อกครอบ payload คำถามเต็ม (ไม่มีเฉลย); เฉลยถูกปิดผนึกด้วย blind commitment ต่อบล็อก + commit hash ต่อคำตอบ |
| ซ่อนเฉลยไม่ให้เดาได้ | `contentHash` ที่เผยแพร่ครอบเฉพาะโจทย์/ตัวเลือก (ไม่มี answerIndex — brute-force 4 ค่าไม่ได้); ส่วน `answerCommitment = sha256({slot, answerIndex, alternatives, v})` ผูก slot ภายในของคลัง ทำให้ตรวจเฉลยจริงได้โดยไม่รู้เฉลย — โหนด/peer ตรวจซ้ำทุกบล็อก (fail-closed) |
| หลังบ้านเปลี่ยน/เพิ่มคำตอบ | `AdminConsole` (scrypt + session token) → action ถูกฝังลงบล็อกถัดไป พร้อม audit hash |
| เชนอยู่รอดรีสตาร์ต | ทุกบล็อกที่ seal ถูก append ลง `CHAIN_DATA_DIR/blocks.jsonl` (write+fsync ต่อบล็อก, กันเสียกลางทาง), บูตใหม่ = โหลด + `verifyChain` ก่อนขุดต่อ (fail-closed) — เชนคือ state เดียว |
| ส่งแฮชไมล์สโตนขึ้น Amoy | ทุกบล็อกไมล์สโตน (÷1,000) ถูก enqueue ไป `recordMilestone(...)` บน contract `MilestoneAnchor` (Polygon Amoy 80002) ด้วย viem — ทำงานเบื้องหลัง ไม่หยุดการขุด, retry + idempotent (`AlreadyAnchored`), ปิดได้โดยไม่ตั้ง env |
| หลายโหนดซิงก์กัน (P2P) | `PEER_URLS` = รายการโหนดเพื่อน — โหนดดึงเชนเพื่อนมาตรวจด้วยกฎ verifyChain ทั้งหมด (ความสูง/parent/แฮชตัวเอง/PoW ตามระดับ/ไมล์สโตน + ความถูกต้องของโจทย์และ answerCommitment กับคลัง deterministic) แล้วรับเฉพาะเชนที่ work สะสมมากกว่า (fork choice = เชนหนักสุดที่ valid), reorg = เขียนดิสก์แบบ atomic (temp+rename) แล้วเปิดบล็อกใหม่จาก tip ใหม่ |

### รันโหนด

```bash
pnpm --filter @nexus/backend build
ADMIN_PASSWORD=my-secret PORT=4100 node packages/backend/dist/chain/node.js
# Dashboard (TH): http://localhost:4100/    หลังบ้าน: http://localhost:4100/admin
```

Endpoints หลัก: `GET /api/status`, `GET /api/blocks`, `GET /api/question/current`, `POST /api/answer`,
`POST /api/admin/login`, `POST /api/admin/answers/edit`, `POST /api/admin/questions/add`, `GET /api/verify`.

`GET /api/blocks/:height` เพิ่ม `winnerMiner` + `winnerAnsweredAt` (ผู้ตอบถูกเร็วที่สุด = ผู้ได้ 40%) ให้ explorer แสดงผู้ชนะได้โดยไม่ต้องคำนวณซ้ำฝั่งเว็บ

ตั้งค่าผ่าน env: `POW_BITS` (ค่าเริ่มต้น 12 — ลดได้สำหรับ dev), `BLOCK_INTERVAL_MS`, `BLOCK_JITTER_MS`, `CHAIN_DATA_DIR`.

### เชื่อม Amoy testnet (anchor ไมล์สโตน)

ทุกครั้งที่บล็อกไมล์สโตน (1,000, 2,000, …) ถูก append ลงดิสก์ โหนดจะส่ง `recordMilestone(blockHeight, milestoneHash, spanFromBlockHash, spanToBlockHash, spanBlocks, totalCumulativeWork)` ไปยัง contract `MilestoneAnchor` บน Polygon Amoy ในแบ็กกราวด์:

- **ไม่บล็อกการขุด** — คิวถูก drain คนละเธรด, tx ล้ม = retry สูงสุด 3 ครั้ง, หมดครั้ง = เลื่อนไปรอบถัดไป (ปิดโหนดจะรอ drain ก่อนออก)
- **idempotent** — ก่อนส่งจะอ่าน `isAnchored(height)` ก่อน ส่งซ้ำหลังรีสตาร์ตได้อย่างปลอดภัย
- **TESTNET ONLY** — chain ถูก fix เป็น Amoy (80002), RPC mainnet จะถูกปฏิเสธ (`ANCHOR_MAINNET_RPC_FORBIDDEN`), key อยู่ในหน่วยความจำเท่านั้น ไม่ลง log/ดิสก์

ตั้งค่า (ดู `.env.example`):

```bash
AMOY_RPC_URL=https://rpc-amoy.polygon.technology
ANCHOR_CONTRACT_ADDRESS=0x…        # deploy ด้วย script ใน packages/contracts (DeployMilestoneAnchor)
ANCHOR_PRIVATE_KEY=0x…             # wallet ที่เป็น owner ของ contract และมี Amoy POL สำหรับ gas
```

ไม่ตั้งสองตัวหลัง = anchor ปิด (โหนดขุดต่อได้ปกติ) • ตั้งครึ่ง ๆ / key เพี้ยน = บูตไม่ผ่าน (fail-closed)

ทดสอบ: unit tests (`pnpm --filter @nexus/backend test`) ครอบคลุมคิว/retry/idempotence/กรอง mainnet ด้วย fake client — ส่วนการยิงจริงบน Amoy ให้ deploy contract ก่อนแล้วรันโหนดจนถึงบล็อก 1,000 (หรือใช้ `POST /api/admin/mine` ถ้าตั้ง POW_BITS ต่ำและขุดเร็ว) แล้วดู log `[anchor] ✅ milestone #1000 anchored — tx 0x…`

### P2P peer sync (fork choice ด้วย verifyChain)

โหนดหนึ่ง ๆ สามารถตั้ง `PEER_URLS` ชี้ไปโหนดอื่นได้ เช่น `PEER_URLS=http://192.168.1.10:4100,http://192.168.1.11:4100`:

- โปรโตคอล peer (read-only): `GET /api/peer/status` → `{height, totalCumulativeWork, protocol}` และ `GET /api/peer/blocks?offset&limit` → บล็อกที่ seal แล้วทั้งหมดแบบแบ่งหน้า
- **เกณฑ์ตัดสิน**: เชนเพื่อนต้องผ่านกฎเดียวกับ `verifyChain` ทั้งหมดก่อน (`validateCandidateBlocks`) จากนั้นเทียบ **work สะสม** (ผลรวม attempts ทุกบล็อก) — รับเฉพาะเมื่อหนักกว่าเชนตัวเอง ไม่เช่นนั้นคงเชนตัวเอง (`kept-own`)
- **การ reorg**: เขียนบล็อกใหม่ทั้งชุดลง `blocks.jsonl` แบบ atomic (temp + fsync + rename) ก่อน แล้วค่อยแทน state ในหน่วยความจำ (`replaceFromBlocks`) และเปิดบล็อกใหม่จาก tip ใหม่ — ถ้าเขียนดิสก์พัง state เดิมยังอยู่ (fail-closed)
- **ปลอดภัยตอนบูต**: เชนที่ยืมมาถูกตรวจซ้ำอีกชั้นที่ commit point; เชนไม่ผ่าน = ไม่มีการเปลี่ยน และยัง fail-stop ตามปกติถ้าดิสก์เขียนไม่ได้
- ทดสอบแล้ว E2E: โหนด A ขุด 3 บล็อก, โหนด B ว่าง → B รับเชน A (แฮชตรงกันทุกบล็อก) + โหนดที่มีเชนยาวกว่าจะไม่ยอมรับเชนสั้นกว่า (`peer-not-ahead`)

## World-v1 question bank (10,000 ข้อ — คลัง "ความรู้รอบโลก")

คลังคำถามชุดแรกสำหรับเชนขุดความรู้: 10,000 ข้อ 2 ภาษา (ไทย/อังกฤษ) สร้างแบบ deterministic จาก fact base ในเรโป
(`src/worldbank/facts.ts` — 82 entities / 288 facts) ผ่าน `ladder.ts` → `compose.ts` → `flagship.ts`

- **รูปแบบ**: match-the-following — prompt ไล่ k รายการ (entity × attribute) และตัวเลือกคือ "ลำดับคำตอบ" k ค่า คั่นด้วย ` · `
  ตัวลวงทุกตัวเป็น **ค่าจริง** จาก attribute หมวดเดียวกัน (สลับ 1 ค่า; difficulty 9–10 สลับ 2 ค่า) ไม่มีการประดิษฐ์ข้อมูลปลอม
- **ความยากไต่ระดับ**: d1 → d10 ตามลำดับ index (k = 2 → 3 → 4 รายการย่อย); 900 ข้อแรก d1–2, 7,799 ข้อกลาง d3–8, 1,300 ข้อท้าย d9–10 (frontier tier)
- **wk-000001**: flagship 5 ชั้นต่อเนื่อง (philosophy → math → ict → science → geography) — ตั้งใจให้ยากเกินมนุษย์/AI ตามคำสั่งเจ้าของโปรเจกต์
- **วิชา**: ล็อก 12 วิชาจาก `src/chain/disciplines.ts` (primary ต่อวิชา 833–834 ข้อ ≈ 8.3%), subjectCount 2/3/4 = 60/30/10%
- **เฉลย**: ไม่มีตำแหน่งใดเกิน 40% ต่อไฟล์ (จริง ≈25% ทุกตำแหน่ง); ไฟล์ JSONL ไม่มี slot/hash/commitment ของเชน
- **dedupe**: normalize prompt.en (ตัดช่องว่าง/เครื่องหมาย/ตัวเลข รวม ๐–๙) + ชุดตัวเลือก → 0 collision ทั้ง 10,000 ข้อ

```bash
pnpm --filter @nexus/backend build
pnpm --filter @nexus/backend world:generate   # เขียน 10 JSONL ลง packages/backend/questions/world-v1/
pnpm --filter @nexus/backend world:validate   # self-check 9 ข้อ + audit A1 → manifest.json + report.md (exit ≠ 0 ถ้าไม่ผ่าน)
```

ผลลัพธ์อยู่ที่ `packages/backend/questions/world-v1/` (gitignored — รันซ้ำได้เหมือนเดิมทุกไบต์):

| ไฟล์ | เนื้อหา |
| --- | --- |
| `questions-00001-01000.jsonl` … `questions-09001-10000.jsonl` | 1,000 ข้อ/ไฟล์ (UTF-8 ไม่มี BOM, LF, 1 บรรทัด = 1 JSON object) |
| `manifest.json` | schemaVersion `world-v1`, SHA-256 ของทุกไฟล์, สถิติต่อวิชา/difficulty/subjectCount/ตำแหน่งเฉลย |
| `report.md` | สรุป self-check 9 ข้อ + A1, วิธีนับ dedupe, สิ่งที่ถูกตัดออก, ข้อจำกัด |

`world:validate` ตรวจเพิ่มชั้น A1: recompose ทั้ง 10,000 ข้อจาก source of truth แล้วเทียบ byte ต่อ byte กับไฟล์บนดิสก์

Tests: `test/worldbank.test.ts` — flagship 5 ชั้น (รวมเลขโรมัน MMCLXXXVII = 3^7), ladder ramp + 40% cap,
schema/options/tags ของ composer, dedupe edge case, และ acceptance test ทั้งคลัง 10,000 ข้อ

### ทดสอบคลังกับ AI จริง (world:ai-eval)

สคริปต์วัด **อัตราความแม่นยำ (accuracy) ของ AI** บนคลัง world-v1: สุ่มคำถามแบบ **stratified ตามระดับความยาก** (d1…d10 — ไม่สุ่มล้วน เพราะคลังเอียงช่วง d3–8 ถึง 78% และ frontier tier d9–10 มีแค่ 13%) ส่งให้โมเดลจริงตอบทีละข้อ ขอคำตอบเป็นตัวอักษร A–D แล้วเทียบกับ `answerIndex` ในคลัง จากนั้นสรุปเป็นรายงานแยกตามระดับ

```bash
pnpm --filter @nexus/backend build

# 1) ดูรายชื่อคำถามที่จะส่ง + prompt ตัวอย่าง โดยไม่ต้องมี API key (ไม่เขียนรายงาน)
pnpm --filter @nexus/backend world:ai-eval -- --dry-run

# 2) รันจริง (ต้องมี key) — ค่าเริ่มต้น: d1–d8 ระดับละ 5, d9–d10 ระดับละ 20, รวม flagship = 81 ข้อ
GEMINI_API_KEY=… pnpm --filter @nexus/backend world:ai-eval -- --provider gemini --model gemini-2.5-flash
OPENAI_API_KEY=… pnpm --filter @nexus/backend world:ai-eval -- --provider openai --model gpt-4o-mini
ANTHROPIC_API_KEY=… pnpm --filter @nexus/backend world:ai-eval -- --provider claude --model claude-3-5-haiku-latest
```

| เรื่อง | รายละเอียด |
| --- | --- |
| ผู้ให้บริการ | `gemini` / `openai` / `claude` ผ่าน global `fetch` ของ Node — **ไม่เพิ่ม dependency**; key อ่านจาก env เท่านั้น (`GEMINI_API_KEY`/`GOOGLE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY`) — ไม่มี flag `--api-key` และไม่ถูก log ลงรายงาน |
| การสุ่ม | seed คงที่ (`--seed`, ค่าเริ่มต้น `world-v1-ai-eval`) → รันซ้ำได้คำถามชุดเดิม; โควตาตั้งได้ (`--per-difficulty`, `--frontier`, `--limit`); ถ้าคลังมีข้อไม่พอจะรายงาน shortfall ไม่เงียบ ๆ |
| ความถูกต้องของข้อมูล | ก่อนยิงทุกครั้ง สคริปต์ re-hash 10 ไฟล์เทียบ `manifest.json` — คลังเพี้ยน = ไม่รัน (`--allow-bank-drift` ถ้าตั้งใจ) และรายงานบันทึก manifest SHA-256 + จำนวนไฟล์ที่ตรวจผ่าน |
| การอ่านคำตอบ | parse ได้ทั้ง `B`, `(B)`, `**D**`, `Option 3`, `คำตอบ: C`, `B is correct`, และการ copy ตัวเลือกทั้งข้อ; ถ้ากำกวม = `parse_failure` (ไม่เดา) พร้อมแยก `refusal` และ `error` (เน็ต/HTTP/timeout) ออกจาก "ตอบผิด" — retry เฉพาะ 429/5xx/เน็ต, 4xx ล้มทันที |
| ผลลัพธ์ | `questions/world-v1/ai-eval-report.md` (accuracy ภาพรวม / ต่อระดับ / ต่อช่วง easy-mid-frontier / flagship, รายการข้อที่ตอบผิด + คำตอบดิบ, ข้อจำกัด) และ `ai-eval-results.json` (ผลดิบทุกข้อ) — ทั้งคู่อยู่ในโฟลเดอร์ gitignored |
| Exit code | `0` สำเร็จ · `1` รันไม่ได้ (ไม่มี key / คลังเพี้ยน / flag ผิด) · `2` รันจบแต่มีบางคำขอ error |
| ไม่มี mock | ถ้าไม่มี key สคริปต์ **ไม่รันและไม่เขียนรายงาน** (ไม่มีการสร้างตัวเลขปลอม) — `--dry-run` แสดงเฉพาะรายการคำถามที่สุ่มได้ |

**ข้อจำกัดที่ต้องอ่านก่อนอ้างตัวเลข:** โมเดลไม่ deterministic (ตัวเลขคือ **หนึ่งรอบ** ไม่ใช่ค่าประมาณเชิงสถิติ) · n ต่อระดับเล็กตามค่าเริ่มต้น (ช่วงความเชื่อมั่นกว้าง) · ground truth คือคลังเอง ยังไม่มี human review · ตัวเลือกเป็นภาษาไทยล้วนแต่ส่ง prompt เป็น `--lang en|th`

Tests ของ eval: `test/aiEval.test.ts` — sampler แบบ stratified (determinism, โควตาต่อระดับ, shortfall, flagship, ไม่ซ้ำ), parser 13 รูปแบบคำตอบ + เคสกำกวม/เกินช่วง, extractor ของทั้ง 3 ผู้ให้บริการ, retry/backoff ด้วย fake fetch, scoring + รายงาน, และ integration test กับคลังจริง 10,000 ข้อ (ข้ามอัตโนมัติถ้าคลังยังไม่ถูก generate)

## World-v2 — 12 วิชาพร้อมกัน + คำตอบเป็นตัวเลข 1–10,000,000 (`world2:*`)

คลังที่สอง (แยกจาก world-v1 คนละโฟลเดอร์ คนละสคีมา): แกนความยากคือ **จำนวนวิชาที่ข้อเดียวต้องใช้พร้อมกัน** และทุกคำตอบเป็น **จำนวนเต็มในช่วง 1–10,000,000** ที่ระบบพิสูจน์ได้เองด้วยเครื่อง

```bash
pnpm --filter @nexus/backend build
pnpm --filter @nexus/backend world2:generate    # เขียน questions/world-v2/ 10 ไฟล์ + manifest.json
pnpm --filter @nexus/backend world2:validate    # ตรวจซ้ำแบบอิสระ (ดูตาราง)
```

| เรื่อง | รายละเอียด |
| --- | --- |
| ขนาด | 10,000 ข้อ / 10 ไฟล์ JSONL (1,000 ข้อต่อไฟล์) + `manifest.json` เก็บ SHA-256 ต่อไฟล์ — ค่าเริ่มต้น `packages/backend/questions/world-v2/` (gitignored) |
| 12 วิชาใหม่ | `physics` (ฟิสิกส์และควอนตัม) · `chemistry` · `biology` · `math` · `computing` · `engineering` · `earthSpace` (โลกและอวกาศ) · `medicine` (แพทยศาสตร์และสุขภาพ) · `economics` · `socialHistory` · `philosophyLogic` · `artsLanguage` — ฟิสิกส์/ควอนตัมเป็นวิชาของตัวเอง |
| ขั้นความยาก | 4 ขั้น ขั้นละ 2,500 ข้อ: **4+6** / **6+8** / **8+10** / **10+12** วิชา โดยทุก 10 ข้อเป็นอัตรา 4 ข้อ (จำนวนล่าง) : 6 ข้อ (จำนวนบน) → รวมตามจำนวนวิชา 1,000 / 2,500 / 2,500 / 2,500 / 1,500 |
| คำตอบตัวเลข | clause แต่ละข้อเป็นจำนวนเต็ม 1–10,000,000: `count` = นับจำนวนที่มีคุณสมบัติในช่วงที่ระบุจากตารางบล็อก (100 บล็อก × 100,000 ครอบทั้งพื้นที่ 1–10,000,000) หรือ `formula` = ค่าที่คำนวณจากนิยาม/สูตร/จำนวนเชิงการจัด |
| ภาษาไทย/อังกฤษเต็มชุด | เก็บ `prompt`, `options`, `explanation` สองภาษาแยกกัน (ไม่ใช่แปลจากภาษาเดียว) — หน่วยในตัวเลือกเปลี่ยนตามภาษา เช่น `10,000 ส่วนในล้าน` ↔ `10,000 ppm` |
| ตัวเลือก | 4 ลำดับตัวเลข ถูกต้องเต็มลำดับเดียว อีก 3 ตัวผิดใน 1 / 2 / 3 clause เท่านั้น (ห้ามเกิน 3 เพื่อไม่ให้เดาง่าย) |
| ตรวจได้ด้วยเครื่อง 3 ชั้น | (1) recompute ทุก clause จาก provenance ที่ประกาศในไฟล์ (ไม่เชื่อค่าที่เขียนไว้), (2) `validateEngine` พิสูจน์ตารางทั้งพื้นที่ด้วยสูตรปิด — π(10,000,000) = 664,579, inclusion–exclusion ของ 360, อนุกรม palindrome/no-zero, พหุนามผลรวมเลขโดด, สุทธิการแจกแจงตรง 2,000,000 ตัวแรกสำหรับ `popcountPrime`/`hexHasLetter`, และ sieve ที่สองอิสระสำหรับจำนวนเฉพาะต่ำกว่า 1,000,000, (3) re-enumerate ช่วงจริงของ clause ตัวเลขตามงบสเต็ป 30 ล้าน |
| Determinism | ทั้งคลังเป็นฟังก์ชันบริสุทธิ์ของ index — `world2:generate` รันซ้ำได้ผล byte-identical (เทสต์เทียบกับไฟล์ที่เขียนไว้) |
| เล่นผ่านเครื่องสุ่มเดิม | `http://localhost:4100/quiz?bank=v2&lang=th` (หรือเลือกจาก dropdown "คลังคำถาม" ในหน้าเว็บ) — เฉลยยังไม่ถูกส่งไปเบราว์เซอร์ทั้งชุด |

**ข้อจำกัดที่ต้องรู้:** `formula` บางตัวเป็น *ค่ามาตรฐาน* ที่ประกาศไว้ใน [derived.ts](packages/backend/src/worldbank/v2/derived.ts) (มวลโมลาร์, รัศมีโลก, จำนวนกระดูก, ปีทางประวัติศาสตร์ ฯลฯ) — ตัวตรวจสอบคำนวณซ้ำได้จากตารางเดียวกัน แต่ไม่ได้พิสูจน์ค่านั้นจากการค้นหาเหมือน clause แบบ `count`; ส่วน `count` ทั้งหมดพิสูจน์ได้ด้วยการแจกแจงในช่วง 1–10,000,000

Tests: [test/worldbank2.test.ts](packages/backend/test/worldbank2.test.ts) — 12 วิชาและแผนความยาก, อัตรา 4:6 ครบทุก 10 ข้อตลอด 10,000 index, ความสมดุลของ primary subject, ตัวคลังตัวเลขเทียบลูปอิสระในพื้นที่เล็ก, anchor ทั้งพื้นที่, การันตีค่า/ตัวลวงในสเปซ, determinism, ตัวเลือกถูกเดียว/ไม่ซ้ำ, และ acceptance ทั้งคลังที่เขียนจริง (hash + histogram)

## Quiz trainer บน Windows 11 (`/quiz`)

เปิดโหนดแล้วเล่นควิซจากคลัง world-v1 ได้ทันทีในเบราว์เซอร์ — ไม่เพิ่ม dependency ใหม่ และ **ไม่ส่งเฉลยไปที่เบราว์เซอร์เลย**:

```bash
pnpm --filter @nexus/backend build
ADMIN_PASSWORD=dev-secret POW_BITS=8 PORT=4100 node packages/backend/dist/chain/node.js
# เปิด http://localhost:4100/quiz  (อังกฤษ: /quiz?lang=en)
```

| เรื่อง | รายละเอียด |
| --- | --- |
| การสุ่ม | ใช้ sampler ตัวเดียวกับ `world:ai-eval` (stratified 10 ข้อ/ระดับ, seed `world-v1-ai-eval` → รันซ้ำได้ข้อเดิม) เลือกจำนวนต่อรอบ 20/50/100/200 ผ่าน `GET /api/quiz/sample?count=` |
| เฉลย | `GET /api/quiz/sample` ไม่มี `answerIndex`/`explanation` เด็ดขาด — เฉลยมาทีละข้อจาก `POST /api/quiz/reveal { "id": "wk-000006" }` เท่านั้น (กันการดึงทั้งคีย์) |
| เปอร์เซ็นต์ | แสดงคะแนนรายระดับความยากของรอบนั้น และสัดส่วนของทั้งคลัง (`GET /api/quiz/stats` → ตัวอักษรเฉลย A–D ละ 25%, ระดับ d3–d8 ละ 13%, d1 5%, d9–d10 ละ 6.5% รวม 10,000 ข้อ) |
| ความปลอดภัย | ทุกเส้นทาง `/quiz` และ `/api/quiz/*` รับเฉพาะ loopback (127.0.0.1 / ::1) เพราะโหนดผูก `0.0.0.0` — เปิดให้เครื่องอื่นในวงต้องตั้ง `NEXUS_QUIZ_ALLOW_REMOTE=1` และยอมรับว่า endpoint เฉลยจะเข้าถึงได้จาก LAN |
| i18n | ข้อความ UI ทั้งหมดอยู่ใน `@nexus/shared` คีย์ `quiz.*` ครบทั้ง en/th (parity บังคับด้วย `test/i18n.test.ts`) |
| หน้าจอ | vanilla JS ล้วน — เลือกคำตอบแล้วรู้ผลทันที (ถูก/ผิด + เฉลย + คำอธิบาย) แล้วสรุปผลรายระดับเมื่อจบรอบ |
| เลือกคลัง | dropdown "คลังคำถาม" สลับ world-v1 ↔ world-v2 ผ่าน `?bank=v1|v2` (ค่าเริ่มต้น v1); โหมดเทียบกับ AI ใช้ชุดคำตอบของ world-v1 — เล่น v2 จะขึ้นว่าไม่มีข้อมูลอ้างอิงต่อข้อ ไม่เดาคำตอบให้ |
| เทียบกับ AI | หลังจบรอบ กด **"เทียบกับ AI"** → `POST /api/quiz/compare` เทียบคำตอบของคุณกับชุดคำตอบ AI ของ **ข้อเดียวกัน** แบบข้อต่อข้อ แล้วสรุปว่าใครพลาดข้อไหน (ดูหัวข้อถัดไป) |

Tests: `test/quizApp.test.ts` — guard loopback (ผู้เรียกจากระยะไกลได้ 403 ทุกเส้นทาง), payload ห้ามมีเฉลย, reveal ตรงกับคลังจริงทีละข้อ, determinism ของการสุ่ม, เปอร์เซ็นต์รวมเป็น 100, และเส้นทางคลังหาย (503)

### โหมด "เทียบกับ AI" (`POST /api/quiz/compare`)

ชุดอ้างอิงคือ **คำตอบ 100 ข้อที่ coding agent ตอบไว้** ซึ่งเก็บเป็นไฟล์ local (gitignored) ในโฟลเดอร์คลัง:
`packages/backend/questions/world-v1/answers-01.json` … `answers-05.json` (หรือ `ai-answers.json` ไฟล์เดียว) — รูปแบบ `[{ "id": "wk-000006", "pick": 2, "feel": "easy" }]`

```bash
# เล่นรอบ 100 ข้อ (ค่าเริ่มต้น seed world-v1-ai-eval, 10 ข้อ/ระดับ) → ชุดเดียวกับที่ AI ตอบไว้
# จบรอบแล้วกด "เทียบกับ AI" ในหน้า /quiz หรือเรียกตรง ๆ:
curl -s -X POST http://localhost:4100/api/quiz/compare -H 'content-type: application/json' \
  -d '{"answers":[{"id":"wk-000006","pick":2},{"id":"wk-000146","pick":0}]}' | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.stringify(JSON.parse(d).summary)))'
```

| เรื่อง | รายละเอียด |
| --- | --- |
| ขอบเขต | เทียบ **เฉพาะข้อที่ผู้เล่นส่งมาและมีในชุดอ้างอิง** — ข้อที่ไม่มีในชุดอ้างอิงได้ `verdict: "no-reference"`, id ที่ไม่อยู่ในคลังได้ `"unknown-item"`; ไม่มีการเดาหรือแทนค่า |
| คำตัดสิน | ตัดสินจาก **key ในคลัง** ไม่ใช่จากคำตอบ AI — `both-correct` / `ai-correct-only` (AI ถูก คุณพลาด) / `player-correct-only` (คุณถูก AI พลาด) / `both-wrong` |
| สรุปที่คืน | `summary`: จำนวนข้อที่เทียบได้, นับแยก 4 แบบ, `agreement`/`agreementPercent` (เลือกตรงกับ AI), `aiAccuracy`, `playerAccuracy`, `missed` (id ที่ AI ถูกแต่คุณพลาด), `aiMissed`, และ `byDifficulty` (อัตราการเลือกตรงกับ AI รายระดับ) + `rows` ต่อข้อ (คำตอบ AI, คำตอบคุณ, เฉลย, คำอธิบาย en/th) |
| ข้อจำกัดความปลอดภัย | endpoint นี้ไม่ล็อกว่าต้องเป็นข้อที่เซิร์ฟเวอร์เพิ่งเสิร์ฟให้ (`/api/quiz/reveal` ก็เป็นแบบเดียวกัน) — ใครก็ตามที่เข้าถึง loopback ได้และเดา id (`wk-000001`…) สามารถไล่ขอดูเฉลยได้ทีละข้อ ระบบจึงผูกกับ loopback เท่านั้น; ถ้าจะเปิด LAN ควรปิดช่องนี้ก่อน (ดู `NEXUS_QUIZ_ALLOW_REMOTE`) |
| ตรวจสอบ | `--limit` ของ `world:ai-eval` ยังมีบั๊กเดิม: ข้อความสรุปบอกว่า "flagship รวม" แต่ flagship ถูก slice ทิ้งเมื่อกำหนด limit — ชุดอ้างอิง 100 ข้อนี้ไม่ได้รวม flagship (`wk-000001`) |

Tests: `test/quizCompare.test.ts` — อ่าน/รวมไฟล์ `answers-*.json` (ไฟล์ key ถูกเมิน, entry เพี้ยนถูกนับเป็น skipped), validation payload (id/pick ผิด → 400, เกิน 200 ข้อ → `TOO_MANY_ANSWERS`), แยก 4 verdict + `no-reference`/`unknown-item`, AI ที่ตอบผิดถูกนับว่าผิด (ไม่ใช้ AI เป็นความจริง), รอบว่างไม่หารศูนย์, 403 สำหรับผู้เรียกจากระยะไกล, 503 เมื่อไม่มีชุดอ้างอิง, และ integration กับคลังจริง 10,000 ข้อ

## Problem Bank security

Public problem metadata is stored at `problems/{blockHeight}.yaml` and may be committed. `answerPlain` and `salt` are written with mode `0600` to `private/problems/{blockHeight}.yaml`, which must never be committed.

The root `.gitignore` blocks every copy of that private material, not only the canonical one: `packages/private/` (a legacy duplicate that stays on disk), `**/private/problems/`, `**/.problem-secrets/` and `**/*.secrets.yaml`. `test/secretHygiene.test.ts` asserts that those paths stay ignored, that the public YAML and `.env.example` stay committable, and that no file inside any `private/problems` directory is tracked by Git. The public YAML contains `answerCommitHash = sha256(answerPlain + salt)` but never plaintext answers or salts.

## Offline admin CLI

Build the package, prepare a UTF-8 JSON file matching `ProblemInput`, and run:

```bash
pnpm --filter @nexus/backend build
pnpm --filter @nexus/backend problem:add -- ./problem.json
```

The command writes public/private YAML and prints `{ blockHeight, answerCommitHash, calldata }`. The calldata targets `submitProblemCommitment(uint256,bytes32)`; adjust the ABI in `src/problem-bank/ProblemBank.ts` if the final contract interface differs.

Generate the 30-item, 12-discipline bilingual seed set:

```bash
pnpm --filter @nexus/backend problem:seed
```

The set cycles difficulty 1–10 and uses 2 disciplines per item. The deterministic answers/salts remain ignored.

## API

| Method | Route | Result |
| --- | --- | --- |
| GET | `/problems/current` | Bilingual public problem, never plaintext answer |
| GET | `/problems/:height` | Historical problem; plaintext only after `isRevealed(height)` is true |
| POST | `/verify` | `{ "blockHeight": 7, "answerCommitHash": "0x..." }` → `{ "correct": true }` |

Responses use a process-local 60-second TTL cache. `@fastify/rate-limit` enforces 60 requests/minute per IP. Current height and reveal state are injected providers; the default server reads `NEXUS_CURRENT_BLOCK_HEIGHT` and `NEXUS_REVEALED_THROUGH`, keeping deployment stateless and suitable for serverless environments.

```bash
pnpm --filter @nexus/backend start
```

## Explorer snapshot (`chain:export`)

`pnpm --filter @nexus/backend chain:export` maps `CHAIN_DATA_DIR/blocks.jsonl` to the JSON nex32scan reads. Besides `quizBlocks` it now carries the two views the explorer's stat bar and "latest answers" table need, so a build that cannot reach the node still renders like an explorer:

| Field | Meaning |
| --- | --- |
| `status` | chain-wide aggregates: `height`, `totalBlocks`, `totalAttempts`, `totalAnswers`, `correctAnswers`, `avgAttemptsPerBlock`, `avgBlockIntervalMs`, `difficultyBits`, `lastMilestoneHeight`, `lastBlockAt` |
| `recentAnswers` | newest answers across the chain (default 50), newest first: `height`, `miner`, `choice`, `correct`, `answeredAt`, `commitmentHash` |
| `quizBlocks[].answers` | per-block answer detail (optional; older snapshots omit it) |

Only public data is written: sealed blocks publish `revealedAnswerIndex` plus the blind `answerCommitment`, and the open block's key never appears. `summarizeChain()` and `latestAnswers()` are pure functions covered by `test/explorerExport.test.ts` (aggregates, empty chain, ordering, limit, and one end-to-end file write).

## BlockScheduler

`BlockScheduler` closes exactly one block per 60-minute window, samples a fresh 0–3,599 second offset after each attempt, calls `prepareProblems` before `closeBlock`, and immediately arms the next random hour. Hooks are injected, so the service is stateless and deterministic under tests.

## Verification

```bash
pnpm --filter @nexus/backend typecheck
pnpm --filter @nexus/backend test
pnpm --filter @nexus/backend build
```

Vitest covers SHA-256 commitment equality, secret/public separation, bilingual current data, 60-second caching, reveal gating, true/false verification, malformed input, 60-request rate limiting, calldata, and the existing scheduler.
