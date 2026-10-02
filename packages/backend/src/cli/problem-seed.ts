import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProblemBank } from '../problem-bank/ProblemBank.js';
import type { ProblemInput } from '../problem-bank/types.js';

const disciplines = [
  ['Physics', 'Mathematics'], ['Chemistry', 'Biology'], ['Economics', 'Statistics'],
  ['Computer Science', 'Mathematics'], ['Philosophy', 'History'], ['Environmental Science', 'Biology'],
  ['Psychology', 'Neuroscience'], ['Astronomy', 'Physics'], ['Linguistics', 'Philosophy'],
  ['Sociology', 'Economics'], ['Data Science', 'Computer Science'], ['Earth Science', 'Geography'],
  ['Medicine', 'Biochemistry'], ['Law', 'Philosophy'], ['Education', 'Psychology'],
] as const;
const stems = [
  ['A 2 kg object accelerates at 3 m/s². What net force acts on it, and which mathematical model gives the result?', 'วัตถุมวล 2 กก. มีความเร่ง 3 ม./วินาที² แรงลัพธ์ที่กระทำคือเท่าไร และใช้แบบจำลองทางคณิตศาสตร์ใด', '6 N; Newton second law'],
  ['At 25°C, dissolving 36 g of NaCl in water changes conductivity. What molecular interaction explains this?', 'ที่ 25°C การละลาย NaCl 36 ก. ในน้ำทำให้การนำไฟฟ้าเปลี่ยนแปลง การโต้ตอบระหว่างโมเลกุลใดอธิบายเหตุนี้', 'ion dissociation'],
  ['A 2% monthly inflation rate compounds for 6 months. What is the approximate purchasing-power multiplier?', 'อัตราเงินเฟ้อรายเดือน 2% ทบต้น 6 เดือน ตัวคูณอำนาจซื้อประมาณเท่าใด', '0.887'],
  ['A hash table has load factor 0.75. What bucket count is nearest for 300 entries?', 'ตารางแฮชมี load factor 0.75 จำนวนช่องใกล้เคียงที่สุดสำหรับ 300 รายการคือเท่าไร', '512'],
  ['If everyone treats a rule as legitimate solely because authorities enforce it, which legitimacy type is shown?', 'ถ้าทุกคนยอมรับกฎเพียงเพราะเจ้าหน้าที่บังคับใช้ เป็นความชอบธรรมแบบใด', 'legal-rational legitimacy'],
  ['Wetland loss increases nutrient runoff. Which feedback mechanism can amplify eutrophication?', 'การสูญเสียพื้นที่ชุ่มทำให้ธาตุอาหารไหลลงแม่น้ำมากขึ้น กลไก feedback ใดทำให้ eutrophication รุนแรงขึ้น', 'positive eutrophication feedback'],
  ['A learner remembers an event better when spaced over several days. Which memory effect explains this?', 'ผู้เรียนจำเหตุการณ์ได้ดีขึ้นเมื่อทบทวนห่างกันหลายวัน ผลของความจำใดอธิบายเรื่องนี้', 'spacing effect'],
  ['A planet receives 1/4 sunlight of Earth. By inverse-square law, what is orbital-radius ratio?', 'ดาวเคราะห์ดาวหนึ่งได้รับแสง 1/4 ของโลก ตามกฎกำลังสองผกผัน อัตราส่วนรัศมีวงโคจรเป็นเท่าไร', '2:1'],
  ['Meaning changes with social context. Which linguistic theory emphasizes this?', 'ความหมายเปลี่ยนแปลงตามบริบททางสังคม ทฤษฎีภาษาศาสตร์ใดเน้นแนวคิดนี้', 'contextualism'],
  ['If participation rises when trust rises, which structural condition can reproduce inequality?', 'เมื่อการมีส่วนร่วมเพิ่มขึ้นตามความไว้ใจ องค์ประกอบเชิงโครงสร้างใดอาจทำให้ความเหลื่อมล้ำถูกทำซ้ำ', 'social closure'],
  ['Training accuracy is high while test accuracy is low. Which diagnosis is most appropriate?', 'ค่าความแม่นยำฝึกสูง แต่ค่าความแม่นยำทดสอบต่ำ ควรวินิจฉัยเป็นอะไร', 'overfitting'],
  ['Mountain glaciers retreat while exposed rock absorbs more solar energy. What is the dominant feedback?', 'ธารน้ำแข็งบนภูเขาถูย่อยจนเผยหินที่ดูดซับแสงอาทิตย์เพิ่ม feedback หลักคืออะไร', 'positive albedo feedback'],
  ['A drug inhibits an enzyme. Which effect is most direct on substrate concentration?', 'ยายับยั้งเอนไซม์ ผลโดยตรงที่สุดต่อความเข้มข้นของซับสเตรตคืออะไร', 'substrate accumulation'],
  ['A norm is valid only when enacted by a legislature. Which school of thought is closest?', 'กฎมีความชอบธรรมเฉพาะเมื่อรัฐบัญญัติออกมา โรงเรียนความคิดใดใกล้เคียงที่สุด', 'legal positivism'],
  ['Retrieval practice improves later retention. Which learning principle supports it?', 'การฝึกเรียกความรู้กลับมาช่วยเพิ่มการจำในภายหลัง หลักการการเรียนรู้ใดสนับสนุนเรื่องนี้', 'testing effect'],
] as const;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bank = new ProblemBank({ rootDir: root });
for (let index = 0; index < 30; index += 1) {
  const item = stems[index % stems.length]!;
  const round = Math.floor(index / stems.length) + 1;
  const input: ProblemInput = { blockHeight: index + 1, type: index % 5 === 0 ? 'OPEN_ENDED' : 'DETERMINISTIC', disciplines: [...disciplines[index % disciplines.length]!], difficulty: (index % 10) + 1, statement: { en: `${item[0]} Variant ${round}.`, th: `${item[1]} รูปแบบที่ ${round}.` }, answerPlain: `${item[2]} variant-${round}`, salt: `seed-salt-${index + 1}` };
  await bank.save(input);
}
console.log(`SEEDED:${30}`);