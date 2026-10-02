# Nexus contracts

Solidity 0.8.24 contracts for NEX mining, impact treasury, and quarterly team vesting.

## Commands

```bash
forge build
forge test -vvv
forge coverage --ir-minimum --report summary
```

## Testnet deployment

`script/Deploy.s.sol` accepts only Polygon Amoy (`chainId 80002`). Copy `.env.example` to an ignored `.env`, provide an Amoy deployment key and recipient addresses, then run:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url $AMOY_RPC_URL --broadcast
```

Never commit a private key. This package is testnet-only and does not support mainnet deployment.

## Where the key lives + how to get test POL

- Every script reads its key from **`packages/contracts/.env`** (gitignored) — put `PRIVATE_KEY=0x…`
  on the marked line there. `.env.example` is the committed template and must stay empty (§6).
  `apps/nex32scan/.env` holds explorer settings only and never a key.
- Derive the address to fund: `cast wallet address --private-key $PRIVATE_KEY`.
- Polygon retired the official faucet; use a third-party Amoy faucet:
  [Alchemy](https://www.alchemy.com/faucets/polygon-amoy) (0.1 POL/24h) ·
  [QuickNode](https://faucet.quicknode.com/polygon/amoy) ·
  [Chainstack](https://chainstack.com/amoy-faucet/) ·
  [Chainlink](https://faucets.chain.link/polygon-amoy).
- Check the balance with `cast balance <address> --rpc-url $AMOY_RPC_URL`; one QuizQuestionSet
  deploy plus a reveal costs well under 0.01 POL.

> If a key was ever pasted into `.env.example` or any tracked file, treat it as leaked and
> rotate it — Git history keeps it forever.

## MilestoneAnchor (quiz-chain ↔ Amoy)

`src/MilestoneAnchor.sol` เก็บแฮชไมล์สโตนของ quiz-chain (ทุก 1,000 บล็อก) ลง Amoy:

- `recordMilestone(blockHeight, milestoneHash, spanFromBlockHash, spanToBlockHash, spanBlocks, totalCumulativeWork)` — เฉพาะ owner (wallet ของโหนด), 1 รายการต่อความสูง (`AlreadyAnchored` ทำให้ส่งซ้ำได้อย่างปลอดภัย)
- ผูกกับ Amoy เท่านั้น: constructor revert ถ้า chainId ≠ 80002 และ emit `MilestoneAnchored` ให้ indexer/explorer ติดตาม
- มี `Ownable2Step` + `Pausable` ตามกฎความปลอดภัยของโปรเจ็กต์

Deploy เฉพาะไมล์สโตนแองเคอร์ (แยกจากชุด tokenomics):

```bash
cd packages/contracts
cp .env.example .env   # ใส่ PRIVATE_KEY (wallet กระเป๋าเดียวกับที่โหนดใช้ anchor)
forge script script/DeployMilestoneAnchor.s.sol:DeployMilestoneAnchor --rpc-url $AMOY_RPC_URL --broadcast
# คัดลอก address ที่พิมพ์ออกมาไปวางใน ANCHOR_CONTRACT_ADDRESS ของ packages/backend
```

ทดสอบ: `forge test -vvv --match-contract MilestoneAnchorTest` (ต้องมี forge ติดตั้ง; ชุดเทสต์อยู่ที่ `test/MilestoneAnchor.t.sol`)

> หมายเหตุ: บางเครื่องยังไม่มี foundry — คอนแทร็กนี้คอมไพล์ผ่านแล้วด้วย solc 0.8.24 (standard-JSON, viaIR + optimizer) ให้ bytecode สมบูรณ์
> ถ้า `forge` ไม่อยู่ใน PATH ใช้ `~/.foundry/bin/forge` ได้

## QuizQuestionSet (โจทย์ 1 ชุดขึ้นเชน — Amoy เท่านั้น)

`src/QuizQuestionSet.sol` เอา **1 ชุดข้อสอบ** ขึ้นเชน โดยไม่ยกคลังทั้ง 10,000 ข้อ (53 MB) ขึ้นไป:

- `publishSet(setId, bankRoot, schema, questionCount)` — `bankRoot` = sha256 ของ `manifest.json` ของคลัง คำนวณ off-chain แล้วส่งเป็น `bytes32`
- `storeItem(setId, item)` — ข้อความโจทย์ + 4 ตัวเลือก ทั้ง TH และ EN + `sourceHash` (sha256 ของบรรทัด JSONL ต้นทาง) + `answerCommit`
- `revealAnswer(setId, itemId, answerIndex, salt)` — ตรวจ `keccak256(abi.encode(setId, itemId, answerIndex, salt))` ให้ตรงกับ commitment ก่อน จึง emit เฉลยพร้อม salt (owner เท่านั้น: ถ้าเปิดให้ใครก็ได้ ช้อยส์ 4 ตัวจะถูกเดาแล้วเปิดเฉลยทิ้งได้)
- `commitFor(...)` และ `revealedAnswer(...)` — helper ให้คนนอกคำนวณ commitment ซ้ำได้ และอ่านเฉลยได้เฉพาะหลังเปิด
- เพดาน:prompt ≤ 800 ไบต์, ตัวเลือก ≤ 200 ไบต์, ≤ 64 ข้อต่อชุด และผูกกับ `chainId 80002` ทั้งใน constructor และทุก write
- ราคาจริงที่วัดได้: ข้อ `w2-000001` (ข้อความ 1,756 ไบต์) = **1,683,736 gas**; เทสต์ `testStoredItemGasIsBounded` จะ fail ถ้าเกิน 2M

### วิธีใช้

```bash
cd packages/contracts
node data/make-quiz-set.mjs      # สร้าง data/quiz-set-1.json จากคลัง world-v2 (ไม่มีเฉลยอยู่ในไฟล์)
forge test --match-contract QuizQuestionSetTest     # 18 เทสต์ (happy path + edge + เพดาน gas)

cp .env.example .env
#  ใน .env: PRIVATE_KEY (คีย์เทสต์เท่านั้น) · QUIZ_ANSWER_INDEX · QUIZ_ANSWER_SALT (สุ่ม 32 ไบต์)
forge script script/DeployQuizQuestionSet.s.sol --rpc-url $AMOY_RPC_URL --broadcast
#  แล้วเอา address ที่ได้ไปตั้ง QUIZ_REGISTRY เพื่อเปิดเฉลย
QUIZ_REGISTRY=0x... forge script script/RevealQuizAnswer.s.sol --rpc-url $AMOY_RPC_URL --broadcast
```

**ความปลอดภัย:** `QUIZ_ANSWER_INDEX` และ `QUIZ_ANSWER_SALT` เป็นความลับ — อยู่ใน `.env`/environment เท่านั้น ห้าม commit (ช้อยส์มี 4 ตัว ถ้า salt รั่ว = เฉลยรั่ว) และคำตอบที่ขึ้นเชนแล้วแก้ไม่ได้
`.env.example` เป็น template เปล่าโดยตั้งใจ — ถ้าเคยใส่คีย์จริงไว้ที่ไหน ให้ rotate คีย์นั้นทันที

ซ้อมในเครื่องโดยไม่ต้องใช้คีย์จริง:

```bash
anvil --chain-id 80002
# จากนั้นรัน forge script ข้างบนด้วย --rpc-url http://127.0.0.1:8545
# (คีย์ของ anvil เป็นคีย์สาธารณะที่ทุกคนรู้ ใช้ได้เฉพาะเครื่องนี้เท่านั้น)
```

Deploy script อ่านไฟล์ public ผ่าน `fs_permissions = [{ access = "read", path = "data" }]` ใน `foundry.toml` (อ่านได้อย่างเดียว ไม่มีการเขียนไฟล์)
