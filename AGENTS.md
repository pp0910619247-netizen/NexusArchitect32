AGENTS.md — Nexus Architect
1. Project Identity
Name: Nexus Architect (ticker: NEX)
Type: Knowledge-Mining Blockchain + Personal AI Agent (Digital Twin) + Impact Treasury
Stage: TESTNET ONLY. ห้ามเขียนโค้ดหรือ config ที่ชี้ไป mainnet ทุกกรณี
Languages: ระบบต้องรองรับ English + Thai ตั้งแต่ commit แรก ห้าม hardcode ข้อความใดๆ ในโค้ด
2. Tech Stack (LOCKED — ห้ามเปลี่ยนเองโดยไม่ถาม)
Layer	Technology
Mobile App	React Native (Expo) + TypeScript
Local DB	SQLite (expo-sqlite) + SQLCipher encryption
Secrets	expo-secure-store (iOS Keychain / Android Keystore)
Web Explorer	Next.js 14 App Router + TypeScript + TailwindCSS
Smart Contract	Solidity 0.8.24 + Foundry
Chain	Polygon Amoy Testnet (chainId 80002)
Backend	Node.js 20 + Fastify + TypeScript (stateless, event-driven)
Problem Bank	JSON/YAML files in git + SHA-256 commit hash
Indexer	viem + PostgreSQL (or SQLite for MVP)
Monorepo	pnpm workspaces + Turborepo
3. Repository Structure (ห้ามสร้างโฟลเดอร์นอกโครงนี้)
nexus-architect/ ├── apps/mobile/ # React Native app ├── apps/nex32scan/ # Block Explorer (EN/TH) ├── packages/contracts/ # Solidity + Foundry tests ├── packages/backend/ # Problem Bank API + admin injection ├── packages/indexer/ # อ่าน event จาก chain ป้อน explorer ├── packages/shared/ # types, constants, i18n dictionaries └── AGENTS.md

4. Tokenomics Constants (ใช้ค่าเหล่านี้เท่านั้น ห้ามคิดเลขใหม่)
TOTAL_SUPPLY = 21,000,000 NEX (18 decimals)
Allocation: Mining 50% | Public Sale 30% | Team 20%
Team vesting: cliff 0, unlock เท่าๆ กันทุก 3 เดือน (quarterly) จนครบ
Public Sale proceeds: 50% ล็อกเข้า LP บน DEX, 50% เข้า Dev Treasury
Genesis Era = block 1 ถึง 10,000 แจกรวม 10% ของ TOTAL_SUPPLY = 2,100,000 NEX
HALVING_INTERVAL = 1,000 blocks (ภายใน Genesis Era)
INITIAL_BLOCK_REWARD = 1,051 NEX (คำนวณจาก 2,100,000 / (1000 × (2 − 2⁻⁹)))
เศษที่เหลือจากการปัดเศษให้ทบเข้าบล็อกถัดไป ห้าม mint เกินเพดาน
ลำดับการแบ่งรางวัลต่อบล็อก (สำคัญมาก ทำตามลำดับนี้เป๊ะ)
หัก 10% ของ block reward เข้า ImpactTreasury ก่อนเสมอ
ส่วนที่เหลือ 90% แบ่งเป็น:
40% → ผู้ตอบถูกที่ "แม่นยำ/เร็วที่สุด" 1 ราย (Winner)
60% → กระจายตามสัดส่วนน้ำหนักผู้ร่วมขุดที่ส่งคำตอบถูกในบล็อกนั้น
ทุกการแบ่งใช้เลขจำนวนเต็ม wei เศษที่เหลือส่งเข้า ImpactTreasury
5. Memory Policy (Sliding Window — กฎเหล็ก)
Core Memory: ไม่มีวันหมดอายุ เก็บ identity ของผู้ใช้ (ชื่อ, ชื่อ AI, สิ่งที่รัก/ชอบ, คนสำคัญ, อาชีพ, เป้าหมาย, ข้อจำกัดสุขภาพ/ความเชื่อ)
Rolling Memory: TTL 30 วัน นับรายเรคอร์ดจาก created_at (per-record TTL)
ห้ามทำ batch reset รายเดือน ห้ามผูกกับวันที่ 1 ของเดือนเด็ดขาด
หน้าต่างเลื่อนทุกวัน: เข้าใหม่ 1 วัน หลุดออก 1 วัน
ก่อนเรคอร์ดหมดอายุ ต้องผ่าน Significance Classifier ถ้าคะแนน ≥ threshold ให้ promote เป็น Core Memory ก่อนลบต้นฉบับ
ผู้ใช้ pin / unpin / ลบเองได้ทุกเรคอร์ดผ่านหน้า "Memory Book"
ข้อมูลความทรงจำทั้งหมดอยู่บนเครื่องผู้ใช้เท่านั้น ห้าม sync ขึ้น server ทุกกรณี
6. Security Rules (ละเมิดข้อใดข้อหนึ่ง = งานไม่ผ่าน)
API Key ของผู้ใช้ (Gemini / OpenAI / Claude) ต้องเก็บใน SecureStore เท่านั้น
ห้ามเขียน key, seed phrase, private key ลงไฟล์ config, .env ที่ commit, หรือ log
ห้าม commit ไฟล์ .env ทุกชนิด ให้สร้าง .env.example แทน
Smart Contract ต้องมี ReentrancyGuard + Pausable + Ownable2Step
ทุก external call ใช้ checks-effects-interactions pattern
Wallet Address ที่ผู้ใช้กรอก ต้อง validate checksum (EIP-55) ก่อนบันทึก
7. Definition of Done (ทุกงานต้องผ่านครบ 5 ข้อ)
pnpm typecheck ผ่าน ไม่มี any ที่ไม่จำเป็น
pnpm lint ผ่าน
Unit test ครอบคลุม happy path + edge case อย่างน้อย 1 เคส และรันผ่านจริง
ข้อความ UI ทุกบรรทัดอยู่ใน i18n dictionary ทั้ง en และ th
อัปเดต README ของ package นั้นว่าใช้งาน/รันยังไง
8. Working Rules for the Agent
ทำทีละ 1 งาน ห้ามแตะไฟล์นอกขอบเขตงานที่สั่ง
ก่อนเขียนโค้ด ให้สรุปแผน 5 บรรทัดและรอการยืนยัน
ถ้าสเปคกำกวม ให้ "ถาม" ห้ามเดาแล้วเขียนต่อ
ห้ามติดตั้ง dependency ใหม่โดยไม่แจ้งเหตุผล
ห้ามสร้าง mock data ปลอมแล้วบอกว่าเสร็จ ต้องรันจริงให้ผ่าน
9. Out of Scope (ห้าม agent ทำเอง)
ตรวจคำตอบโจทย์ปลายเปิดโดยอัตโนมัติ (ต้องใช้ Peer Review โดยมนุษย์)
เนื้อหากฎหมาย, KYC, เอกสารเสนอขายเหรียญ, คำแนะนำการลงทุน
Security audit และการ deploy ขึ้น mainnet
การเชื่อมต่อ Mobile Banking API หรือ Digital ID ของรัฐ