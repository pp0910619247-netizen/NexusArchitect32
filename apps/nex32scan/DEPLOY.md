# Deploy nex32scan ขึ้นโฮสติ้งฟรี (Vercel)

**สถานะล่าสุด: ใช้งานได้จริงแล้ว → https://nex32scan.vercel.app** (บิลด์บนคลาวด์ 45 วิ)

อัปเดตล่าสุด (รอบ "explorer มาตรฐาน"): เพิ่มหน้า `/[lang]/blocks`, แถบสถิติทั้งเชน,
ตาราง Latest blocks / Latest answers, หน้าบล็อกแบบ overview + แตก reward 10/40/60,
หน้าคำตอบรายที่อยู่, หน้าการ resolve commitment hash, หน้า tokenomics (ตาราง halving 10 ยุค),
`/api/status`, `/api/answers`, sitemap + robots + security headers
→ **ต้อง `chain:export` + `bake:snapshot` + deploy ใหม่** เว็บ production ถึงจะได้ของใหม่
(รอบนี้ตรวจในเครื่องครบทุกหน้า EN/TH แล้ว)

## โหมดข้อมูล (เลือกอัตโนมัติจาก env)

| โหมด | เงื่อนไข | ใช้เมื่อ |
|---|---|---|
| `hybrid` | มี `QUIZ_CHAIN_API_URL` + มีสแนปชอตอบ | **แนะนำ** — live ก่อน, โหนดล่ม = แสดงสแนปชอตล่าสุด |
| `remote` | มี `QUIZ_CHAIN_API_URL` (ไม่มีสแนปชอตอบ) | โหนดเปิดสู่อินเทอร์เน็ตผ่าน tunnel |
| `file` | มี `INDEXER_SNAPSHOT_PATH` | รันบนเครื่องเราเอง (หาไฟล์ไม่เจอ = ถอยไปใช้สแนปชอตอบอัตโนมัติ) |
| `baked` | ไม่มีทั้งสอง | ค่า default คลาวด์ — แสดงสแนปชอตที่อบตอน build |

สแนปชอตถูก "อบ" ลงบิลด์ผ่าน `next.config.mjs` → `BAKED_SNAPSHOT_JSON`
(ไฟล์ `src/generated/explorer-snapshot.json`, commit ไว้ใน git) และ runtime override ได้ด้วย `EXPLORER_RUNTIME_JSON`

> **สำคัญ:** ระหว่าง `next build` ระบบ **ไม่ใช้** `QUIZ_CHAIN_API_URL` (ดู `remoteApiUrl()` ใน `src/lib/explorer.ts`)
> เพื่อให้หน้า home / impact / token ถูก prerender เป็น static ไม่กลายเป็น serverless function
> ส่วนตอน runtime (โหนด 4100 ในเครื่อง) ยังอ่านสดตามปกติ

## วิธี deploy (ใช้คำสั่งนี้เท่านั้น)

```bash
# จาก root ของ repo — อัปเดตข้อมูลก่อน (ถ้าต้องการสแนปชอตใหม่)
pnpm --filter @nexus/backend chain:export
pnpm --filter @nexus/nex32scan bake:snapshot

# deploy (บิลด์บนคลาวด์ Vercel)
pnpm dlx vercel deploy --prod --yes
# หรือ: pnpm --filter @nexus/nex32scan deploy:vercel
```

## ค่าที่ตั้งไว้บนโปรเจกต์ Vercel (`nex32scan`)

| ค่า | ที่ตั้งไว้ | หมายเหตุ |
|---|---|---|
| Root Directory | `apps/nex32scan` | ตั้งผ่าน API แล้ว — อัปโหลดทั้ง monorepo แต่บิลด์ในโฟลเดอร์แอป |
| Framework | `nextjs` | |
| Install Command | `pnpm install --no-frozen-lockfile` | pnpm 12 ไม่รับ `--frozen-lockfile=false` (พังตอนแรก) |
| Build Command | `node scripts/bake-explorer-snapshot.mjs && pnpm --filter @nexus/indexer build && pnpm --filter @nexus/shared build && next build` | ตรงกับ `apps/nex32scan/vercel.json` |
| Node | 24.x | |
| Deployment Protection | **ปิดแล้ว** (`ssoProtection: null`) | ไม่งั้นเว็บต้องล็อกอิน Vercel ก่อนเปิด |
| Environment Variables | ไม่มี | ข้อมูลมาจากสแนปชอตที่อบไว้ |

## กับดักที่เจอมาแล้ว (อย่าล้มซ้ำ)

1. **ห้ามใช้ `vercel deploy --prebuilt` จาก Windows** — `vercel build` สร้าง `.rsc.func` เป็น symlink
   พออัปโหลดแล้วฝั่ง Vercel stat ไม่เจอ (`ENOENT … [lang]/address/[addr].func`); ถ้าไป materialize
   เป็นโฟลเดอร์จริงก็จะโดนลิมิต 12 ฟังก์ชัน → ใช้ **cloud build** เท่านั้น
2. **เพดาน 12 serverless functions (Hobby)** — ตอนนี้ใช้ 6-7: dynamic 5 ตัวคือ `/api/[[...path]]`,
   `/[lang]/block/[height]`, `/[lang]/address/[addr]`, `/[lang]/blocks`, `/[lang]/search`
   บวก `/_not-found` และ `/sitemap.xml`
   - หน้า static: `/[lang]`, `/[lang]/impact`, `/[lang]/token` (มี `generateStaticParams` + `dynamicParams = false`)
   - `public/robots.txt` เป็นไฟล์นิ่ง (0 ฟังก์ชัน) — ไม่ใช้ `robots.ts`
   - แถบสถิติ/ตารางคำตอบในหน้า static อ่านจากสแนปชอตที่อบตอน build จึงไม่ทำให้หน้า static กลายเป็น dynamic
   - redirect `/` → `/th` และ `/search` → `/th/search` ทำใน `next.config.mjs` `redirects()` (0 ฟังก์ชัน)
   - API เดิม `/api/explorer` + `/api/search` ถูกรวมเป็น catch-all ไฟล์เดียว
   - **ก่อนเพิ่ม route ใหม่ ให้เช็คว่าจำนวนฟังก์ชันยังไม่เกิน 12**
3. **`.env` ไม่ขึ้นคลาวด์** (gitignore + `.vercelignore`) และบิลด์บนคลาวด์ไม่มี `.chain-data`
   → สคริปต์ bake จะ "keep the existing baked file" (ต้อง commit `src/generated/explorer-snapshot.json`)
4. **`.vercelignore` ที่ root** ตัด `.next/`, `dist/`, log, `.chain-data/`, ไฟล์ env ออกจากอัปโหลด (อัปโหลดเหลือ ~2.4 MB)

## API (อ่านอย่างเดียว)

| Endpoint | ผลลัพธ์ |
|---|---|
| `GET /api/explorer` | snapshot ทั้งหมด (`stats`, `quizBlocks`, `problems`, `proposals`) |
| `GET /api/status` | สถิติทั้งเชน (height, blocks, attempts, answers, correct, block time, difficulty, milestone) — `503` เมื่ออ่านแหล่งข้อมูลไม่ได้ |
| `GET /api/answers?limit=20` | คำตอบล่าสุด เรียงใหม่→เก่า (`limit` สูงสุด 200) |
| `GET /api/search?q=` | `200` → `{kind:"block",height}` / `{kind:"address"}` / `{kind:"transaction",hash}` · `404` → `{kind:"notFound"}` · `400` → `{kind:"invalid"}` |

ทั้งหมดใช้ catch-all ไฟล์เดียว (`src/app/api/[[...path]]/route.ts`) เพื่อประหยัดจำนวนฟังก์ชัน

## จำกัดของฟรีที่ควรรู้

- ข้อมูลบนคลาวด์ = สแนปชอต ณ ตอน deploy (ไม่ใช่สดจากโหนดที่บ้าน) — อัปเดตด้วยการ export + bake + deploy ใหม่
  สแนปชอตมี `status` (สถิติทั้งเชน), `recentAnswers` (50 รายการล่าสุด) และ `quizBlocks[].answers`
  ดังนั้นตาราง Latest answers / คำตอบในบล็อกจึงแสดงได้แม้ไม่มีโหนด — ถ้าเชนยังไม่มีคำตอบจริง ตารางจะขึ้น "ยังไม่มีข้อมูล" (ตามจริง)
- ป้ายบนแถบเทสต์เน็ตจะเขียนว่า "โหนดสด" ต่อเมื่ออ่านโหนดสำเร็จจริงเท่านั้น (ตั้ง env ไว้แต่โหนดล่ม = "สแนปชอตที่อบไว้" + ไม่มี auto-refresh)
- ถ้าต้องการสดจริง: เปิด tunnel (ngrok/Cloudflare) แล้วตั้ง env `QUIZ_CHAIN_API_URL` บน Vercel → โหมด hybrid อัตโนมัติ
- Hobby plan ไม่มี persistent disk จึงต้องอบสแนปชอตแบบนี้
