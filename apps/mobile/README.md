# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Mining tab (ขุดความรู้ — quiz-chain)

แท็บ "ขุด" ดึงโจทย์แบบปรนัยจากโหนด quiz-chain (`packages/backend`) แล้วส่งคำตอบได้จริง:

1. รันโหนด (เครื่องเดียวกันหรือ LAN):

   ```bash
   pnpm --filter @nexus/backend build
   ADMIN_PASSWORD=my-secret PORT=4100 node packages/backend/dist/chain/node.js
   ```

2. คัดลอก `apps/mobile/.env.example` → `apps/mobile/.env` แล้วใส่ URL โหนด (เช่น `EXPO_PUBLIC_QUIZ_CHAIN_URL=http://192.168.1.10:4100`) — ต้องรีสตาร์ต `expo start` หลังแก้ .env
3. เปิดแอป → แท็บ "ขุด" → กด "เริ่มขุด" → เลือกคำตอบ → โหนดตอบกลับแค่ "บันทึกคำตอบแล้ว" (ข้อความไทย/อังกฤษตามภาษาแอป)

**ระหว่างรอบ โหนดจะไม่บอกว่าถูกหรือผิด** — `POST /api/answer` ตอบกลับเฉพาะ "รับคำตอบแล้ว" เท่านั้น
เพราะถ้าบอกผลทันที AI จะยิงครบทั้ง 4 ตัวเลือกแล้วรู้เฉลยก่อนถึงเวลา (จงใจปิดช่องโหว่นี้)
ผลถูก/ผิดเปิดเผยพร้อมบล็อกที่ปิดผนึก → ดูได้จากหน้า explorer ทันทีที่บล็อกปิด

ไม่ตั้ง `EXPO_PUBLIC_QUIZ_CHAIN_URL` = แท็บขุดแสดงสถานะ "ยังไม่ได้เชื่อมต่อ" แบบตรงไปตรงมา ไม่มีข้อมูลปลอม

รอบบล็อกของเชนคือ **1 ชั่วโมง ± 10 นาที** (ค่าเริ่มต้นของโหนด) แท็บขุดจึงแสดงบรรทัด
"หนึ่งคำถามต่อชั่วโมง (สุ่มเวลา)" ให้เห็นชัด

**ห้ามแสดงคำตอบเป็นตัวอักษร** (เช่น "ตอบข้อ ค") — ตัวเลือกในแท็บขุดจึงแสดงแต่เนื้อความของตัวเลือก
โดยไม่มีป้าย A/B/C/D หรือ ก/ข/ค/ง เพราะการบอกเป็นตัวอักษรทำให้คัดลอกคำตอบได้โดยไม่ต้องคิด
เป้าหมายคือให้ AI/ผู้ขุด "คิดคำตอบเอง" จากโจทย์ และผลถูก/ผิดที่โหนดตอบกลับเป็นแค่การยืนยันเท่านั้น

## ธีมครีม-ทอง (บังคับตามสเปค)

แอพมีธีมเดียว: **พื้นครีมอมเหลือง (`#FAF6EC`) ตัวอักษรอุ่น ๆ ปุ่มหลักสีทองแบรนด์**
(`src/constants/theme.ts`) ให้ความรู้สึกลื่นตาเหมือนกระดาษครีม ไม่ใช่ขาวจ้า

- `useTheme()` คืน `Colors.light` เสมอ และ `src/app/_layout.tsx` ล็อกการนำทางไว้ที่ `DefaultTheme`
  ทำให้ไม่ว่าเครื่องตั้ง light หรือ dark ตัวแอพก็หน้าตาเหมือนกัน
- ปุ่มหลักใช้ `theme.accent` (ทอง `#B45309`) + ป้าย `themeColor="textInverse"`
  ปุ่มรองพื้นขาวมีขอบ `theme.border` ให้เห็นชัดบนพื้นครีม
- การ์ดเป็นพื้นขาวขอบครีม (`backgroundElement` + `border`) ตัดกับพื้นหน้าครีม
- อยากได้ dark mode กลับมาทีหลัง: `Colors.dark` (โทนอุ่นเข้ม) ยังอยู่ครบ
  แก้แค่ `useTheme()` ให้เลือกตาม `useColorScheme()`

โลโก้แบรนด์ (`assets/images/logo.png` — ปิรามิดทอง) แสดงที่หน้าแรกของแอพ
และไฟล์เดียวกันนี้ถูกใช้เป็น favicon/หัวเว็บ explorer ด้วย

## Tests

```bash
pnpm --filter @nexus/mobile typecheck
pnpm --filter @nexus/mobile test
```

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
