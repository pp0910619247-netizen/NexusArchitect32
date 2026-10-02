// SPDX-License-Identifier: MIT
/**
 * World-v1 fact base — real, verifiable world knowledge in Thai + English.
 *
 * Everything here is hand-authored reference data (no copyrighted text, no
 * fabricated numbers). Values are the widely accepted ones; year-sensitive
 * figures carry `asOf` so prompts can state the reference year.
 *
 * Entities are grouped into categories; distractors for an attribute are the
 * same attribute's values from sibling entities in the same category, so a
 * wrong pick always looks plausible. Multi-hop chains reuse single numeric
 * facts via FACT_INDEX for frontier-tier questions.
 */

/** A Thai/English text pair. */
export interface Pair {
  readonly th: string;
  readonly en: string;
}

/** One verifiable fact about an entity (the candidate question slots). */
export interface Fact {
  /** Stable attribute id, e.g. `capital` — shared across sibling entities. */
  readonly id: string;
  /** The correct value. */
  readonly value: Pair;
  /** The fact as TH/EN noun phrases, e.g. `เมืองหลวง` / `capital city`. */
  readonly label: Pair;
  /** TH/EN verb/attributive phrasing (see STYLE_IDS). */
  readonly style: StyleId;
  /** Data source class used in explanation sentences. */
  readonly source: SourceId;
  /** Reference year when the value is year-sensitive (prompt states it). */
  readonly asOf?: number;
  /** Unit appended after numeric values inside option text. */
  readonly unit?: Pair;
}

export type StyleId =
  | 'WHICH_IS' // ข้อใดคือ {label} ของ {entity}
  | 'WHAT_IS' // {label} ของ {entity} คือข้อใด
  | 'IS_KNOWN' // {entity} เป็นที่รู้จักในฐานะ… / {entity} is known as…
  | 'PRODUCES' // {entity} ผลิต/มี {label} มากที่สุดในโลก
  | 'DEFINED' // ข้อใดให้นิยาม {label} ของ {entity} ได้ถูกต้องที่สุด
  | 'UNIT' // หน่วยวัด
  | 'NONE';

export type SourceId =
  | 'UN' // UN / UNCTAD / FAO statistics (asOf year stated)
  | 'ISO' // ISO standard
  | 'ENCYCLOPEDIA'
  | 'SCIENCE' // physical constants / IUPAC
  | 'SPORT' // competition records
  | 'CONVENTION' // SI / standards bodies
  | 'DOC';

/** Distractor phrasing mirrors the correct option's shape. */
export const STYLE_IDS: readonly StyleId[] = ['WHICH_IS', 'WHAT_IS', 'IS_KNOWN', 'PRODUCES', 'DEFINED', 'UNIT', 'NONE'];

export const SOURCE_IDS: readonly SourceId[] = ['UN', 'ISO', 'ENCYCLOPEDIA', 'SCIENCE', 'SPORT', 'CONVENTION', 'DOC'];

/** World entity: one row of the fact base. */
export interface WorldEntity {
  /** TH/EN name, e.g. ญี่ปุ่น / Japan. */
  readonly name: Pair;
  /** Category id — distractor pools are per (category, fact.id). */
  readonly category: CategoryId;
  /** Primary discipline id (must be one of the 12 ids). */
  readonly discipline: DisciplineId;
  /** Secondary disciplines woven into prompt phrasing (2–4 subject sets). */
  readonly secondary: readonly DisciplineId[];
  /** Common tags (lowercase English, never a discipline id). */
  readonly tags: readonly string[];
  /** At least 5 facts per entity in production use. */
  readonly facts: readonly Fact[];
}

export type DisciplineId =
  | 'math' | 'science' | 'thai' | 'english' | 'social' | 'health' | 'art'
  | 'career' | 'ict' | 'econ' | 'geography' | 'philosophy';

export type CategoryId =
  | 'country' | 'city' | 'planet' | 'element' | 'river' | 'organelle' | 'food'
  | 'vitamin' | 'physicist' | 'philosopher' | 'author' | 'painter' | 'composer'
  | 'empire' | 'battle' | 'agreement' | 'wonder' | 'datastructure' | 'protocol'
  | 'bodyorgan' | 'sport' | 'sportevent' | 'instrument' | 'siproduct'
  | 'currencyarea' | 'plantcrop' | 'browserengine';

const p = (th: string, en: string): Pair => ({ th, en });

const CAP = (city: Pair): Fact => ({ id: 'capital', value: city, label: p('เมืองหลวง', 'capital city'), style: 'WHAT_IS', source: 'UN' });
const CUR = (cur: Pair): Fact => ({ id: 'currency', value: cur, label: p('สกุลเงินที่ใช้', 'official currency'), style: 'WHAT_IS', source: 'ISO' });
const LANG = (langs: Pair, count: number): Fact => {
  void count; // count mirrors the value text; kept for future numeric reuse
  return {
    id: 'officialLanguages', value: langs, label: p('จำนวนภาษาราชการ', 'number of official languages'),
    style: 'WHAT_IS', source: 'UN', unit: p('ภาษา', 'language(s)'),
  };
};
const POP = (millions: number, asOf: number): Fact => ({
  id: 'population', value: p(`${millions} ล้านคน`, `${millions} million people`), label: p('ประชากรโดยประมาณ', 'approximate population'),
  style: 'WHAT_IS', source: 'UN', asOf, unit: p('ล้านคน', 'million people'),
});
const GEO = (fact: Fact): Fact => ({ ...fact, source: 'ENCYCLOPEDIA' });

export const ENTITIES: readonly WorldEntity[] = Object.freeze([
  {
    name: p('ญี่ปุ่น', 'Japan'), category: 'country', discipline: 'social', secondary: ['geography', 'econ', 'ict'],
    tags: ['asia', 'island-nation'], facts: [
      CAP(p('โตเกียว', 'Tokyo')), CUR(p('เยน', 'yen')), LANG(p('1 ภาษา', '1 language'), 1),
      POP(124, 2024), GEO({ id: 'largestIsland', value: p('เกาะฮนชู', 'Honshu'), label: p('เกาะที่ใหญ่ที่สุด', 'largest island'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'tallestPeak', value: p('ภูเขาไฟฟูจิ', 'Mount Fuji'), label: p('ภูเขาสูงที่สุด', 'highest mountain'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('ไทย', 'Thailand'), category: 'country', discipline: 'social', secondary: ['geography', 'econ', 'health'],
    tags: ['southeast-asia', 'rice-exporter'], facts: [
      CAP(p('กรุงเทพมหานคร', 'Bangkok')), CUR(p('บาท', 'baht')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'longestRiver', value: p('แม่น้ำเจ้าพระยา', 'Chao Phraya River'), label: p('แม่น้ำสายหลักที่ยาวที่สุดทั้งสาย', 'longest river entirely within the country'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'topExport', value: p('ข้าวสาร', 'rice'), label: p('สินค้าเกษตรส่งออกสำคัญอันดับต้น', 'leading agricultural export'), style: 'PRODUCES', source: 'UN', asOf: 2024 }),
    ],
  },
  {
    name: p('ออสเตรเลีย', 'Australia'), category: 'country', discipline: 'geography', secondary: ['science', 'econ'],
    tags: ['oceania', 'continent-country'], facts: [
      CAP(p('แคนเบอร์รา', 'Canberra')), CUR(p('ดอลลาร์ออสเตรเลีย', 'Australian dollar')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'largestReef', value: p('เกรตแบริเออร์รีฟ', 'Great Barrier Reef'), label: p('แนวปะการังที่ใหญ่ที่สุดในโลก', 'largest coral reef system'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'desert', value: p('ทะเลทรายเกรตวิกตอเรีย', 'Great Victoria Desert'), label: p('ทะเลทรายที่ใหญ่ที่สุดในประเทศ', 'largest desert in the country'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('บราซิล', 'Brazil'), category: 'country', discipline: 'geography', secondary: ['econ', 'science'],
    tags: ['south-america', 'amazon'], facts: [
      CAP(p('บราซิเลีย', 'Brasilia')), CUR(p('เรอัล', 'real')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'topExport', value: p('ถั่วเหลือง', 'soybeans'), label: p('สินค้าส่งออกอันดับหนึ่งเชิงมูลค่า', 'top export by value'), style: 'PRODUCES', source: 'UN', asOf: 2024 }),
      GEO({ id: 'biome', value: p('ป่าแอมะซอน', 'the Amazon rainforest'), label: p('ระบบนิเวศป่าที่ครอบคลุมพื้นที่มากที่สุด', 'largest forest biome in the country'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('สวิตเซอร์แลนด์', 'Switzerland'), category: 'country', discipline: 'social', secondary: ['econ', 'philosophy'],
    tags: ['europe', 'alps'], facts: [
      CAP(p('แบร์น', 'Bern')), CUR(p('ฟรังก์สวิส', 'Swiss franc')), LANG(p('4 ภาษา', '4 languages'), 4),
      GEO({ id: 'highestPeak', value: p('ยอดเขามัตเทอร์ฮอร์น', 'the Matterhorn'), label: p('ยอดเขาซึ่งเป็นสัญลักษณ์ของประเทศ', 'iconic alpine peak'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'governmentType', value: p('สหพันธ์สาธารณรัฐ (ระบบประชาธิปไตยครึ่งทาง)', 'federal republic (semi-direct democracy)'), label: p('รูปแบบการปกครอง', 'form of government'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('แคนาดา', 'Canada'), category: 'country', discipline: 'social', secondary: ['geography', 'english'],
    tags: ['north-america', 'bilingual'], facts: [
      CAP(p('ออตตาวา', 'Ottawa')), CUR(p('ดอลลาร์แคนาดา', 'Canadian dollar')), LANG(p('2 ภาษา', '2 languages'), 2),
      GEO({ id: 'longestCoastline', value: p('ทะเลสาบสุพีเรียร์', 'Lake Superior'), label: p('ทะเลสาบน้ำจืดที่ใหญ่ที่สุดตามพื้นที่ผิว', 'largest freshwater lake by surface area'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'governmentType', value: p('ประชาธิปไตยแบบรัฐสภา', 'parliamentary democracy'), label: p('รูปแบบการปกครอง', 'form of government'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('อียิปต์', 'Egypt'), category: 'country', discipline: 'social', secondary: ['geography', 'art'],
    tags: ['africa', 'ancient-civilization'], facts: [
      CAP(p('ไคโร', 'Cairo')), CUR(p('ปอนด์อียิปต์', 'Egyptian pound')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'ancientScript', value: p('อักษร hieroglyph', 'hieroglyphic writing'), label: p('ระบบเขียนโบราณ', 'ancient writing system'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'river', value: p('แม่น้ำไนล์', 'the Nile'), label: p('แม่น้ำสายหลักที่ไหลผ่านประเทศ', 'major river flowing through'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('อินเดีย', 'India'), category: 'country', discipline: 'social', secondary: ['econ', 'ict'],
    tags: ['south-asia', 'democracy'], facts: [
      CAP(p('นิวเดลี', 'New Delhi')), CUR(p('รูปีอินเดีย', 'Indian rupee')), LANG(p('22 ภาษา', '22 languages'), 22),
      GEO({ id: 'governmentType', value: p('สหพันธ์สาธารณรัฐแบบรัฐสภา', 'federal parliamentary republic'), label: p('รูปแบบการปกครอง', 'form of government'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'filmIndustry', value: p('โบลลีวูด', 'Bollywood'), label: p('อุตสาหกรรมภาพยนตร์ที่ใหญ่ที่สุดของประเทศ', 'largest film industry of the country'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('เยอรมนี', 'Germany'), category: 'country', discipline: 'social', secondary: ['econ', 'philosophy'],
    tags: ['europe', 'engineering'], facts: [
      CAP(p('เบอร์ลิน', 'Berlin')), CUR(p('ยูโร', 'euro')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'governmentType', value: p('สหพันธ์สาธารณรัฐแบบรัฐสภา', 'federal parliamentary republic'), label: p('รูปแบบการปกครอง', 'form of government'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'river', value: p('แม่น้ำไรน์', 'the Rhine'), label: p('แม่น้ำสายการเดินเรือสำคัญที่สุด', 'most important navigable river'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('เกาหลีใต้', 'South Korea'), category: 'country', discipline: 'ict', secondary: ['social', 'econ'],
    tags: ['east-asia', 'semiconductors'], facts: [
      CAP(p('โซล', 'Seoul')), CUR(p('วอน', 'won')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'topExport', value: p('เซมิคอนดักเตอร์', 'semiconductors'), label: p('สินค้าส่งออกอันดับหนึ่งเชิงมูลค่า', 'top export by value'), style: 'PRODUCES', source: 'UN', asOf: 2024 }),
      GEO({ id: 'writingSystem', value: p('ฮันกึล', 'Hangul'), label: p('ระบบการเขียนหลัก', 'primary writing system'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('ไอซ์แลนด์', 'Iceland'), category: 'country', discipline: 'geography', secondary: ['science', 'social'],
    tags: ['nordic', 'volcanic'], facts: [
      CAP(p('เรคยาวิก', 'Reykjavik')), CUR(p('โครนาไอซ์แลนด์', 'Icelandic krona')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'energySource', value: p('พลังงานน้ำและพลังงานความร้อนใต้พิภพ', 'hydro and geothermal power'), label: p('แหล่งพลังงานไฟฟ้าหลัก', 'main sources of electricity'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'governmentType', value: p('สาธารณรัฐแบบรัฐสภา', 'parliamentary republic'), label: p('รูปแบบการปกครอง', 'form of government'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('เปรู', 'Peru'), category: 'country', discipline: 'geography', secondary: ['social', 'art'],
    tags: ['south-america', 'andes'], facts: [
      CAP(p('ลิมา', 'Lima')), CUR(p('ซอลเปรู', 'Peruvian sol')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'ancientSite', value: p('มาชู ปิชชู', 'Machu Picchu'), label: p('แหล่งโบราณสถานสำคัญของอารยธรรมอินคา', 'major Inca archaeological site'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'desert', value: p('ทะเลทรายอาตากามา', 'the Atacama Desert'), label: p('ทะเลทรายแห้งสุดในโลกที่ขยายเข้าชายฝั่งประเทศ', 'driest desert reaching its coast'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('โมร็อกโก', 'Morocco'), category: 'country', discipline: 'social', secondary: ['geography', 'art'],
    tags: ['north-africa', 'atlas'], facts: [
      CAP(p('ราบัต', 'Rabat')), CUR(p('ดีร์แฮมโมร็อกโก', 'Moroccan dirham')), LANG(p('2 ภาษา', '2 languages'), 2),
      GEO({ id: 'mountainRange', value: p('เทือกเขาแอตลาส', 'the Atlas Mountains'), label: p('เทือกเขาสำคัญที่สุดของประเทศ', 'most significant mountain range'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'city', value: p('มาร์ราคิช', 'Marrakesh'), label: p('เมืองมรดกโลกชื่อดังด้านสถาปัตยกรรม', 'famous UNESCO city of architecture'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('เวียดนาม', 'Vietnam'), category: 'country', discipline: 'social', secondary: ['econ', 'geography'],
    tags: ['southeast-asia', 'coffee-exporter'], facts: [
      CAP(p('ฮานอย', 'Hanoi')), CUR(p('ดองเวียดนาม', 'Vietnamese dong')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'topExport', value: p('กาแฟ', 'coffee'), label: p('พืชเศรษฐกิจส่งออกอันดับหนึ่งของโลกที่ประเทศนี้ผลิต', 'global top-2 export crop produced'), style: 'PRODUCES', source: 'UN', asOf: 2024 }),
      GEO({ id: 'bay', value: p('อ่าวฮาลอง', 'Ha Long Bay'), label: p('อ่าวมรดกโลกที่มีหินปูนยื่นขึ้นเป็นพันเกาะ', 'UNESCO bay with limestone karst islands'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('นอร์เวย์', 'Norway'), category: 'country', discipline: 'geography', secondary: ['econ', 'science'],
    tags: ['nordic', 'fjords'], facts: [
      CAP(p('ออสโล', 'Oslo')), CUR(p('โครนนอร์เวย์', 'Norwegian krone')), LANG(p('2 ภาษา', '2 languages'), 2),
      GEO({ id: 'feature', value: p('ฟยอร์ด', 'fjords'), label: p('ลักษณะภูมิประเทศชายฝั่งที่มีชื่อเสียงที่สุด', 'most famous coastal landform'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'governmentType', value: p('ราชอาณาจักรแบบรัฐสภา', 'parliamentary monarchy'), label: p('รูปแบบการปกครอง', 'form of government'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('เอธิโอเปีย', 'Ethiopia'), category: 'country', discipline: 'social', secondary: ['geography', 'health'],
    tags: ['east-africa', 'coffee-origin'], facts: [
      CAP(p('อาดดิสอาบาบา', 'Addis Ababa')), CUR(p('เบอร์เอธิโอเปีย', 'Ethiopian birr')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'coffeeOrigin', value: p('คาลดี้ (ตำนานคนเลี้ยงแพะ)', 'Kaldi (the goat-herder legend)'), label: p('ตำนานที่มาของกาแฟ', 'legendary origin of coffee'), style: 'IS_KNOWN', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'calendar', value: p('ปฏิทินเก่าแก่ของตนเองที่เริ่มนับต่างจากสากลราว 7–8 ปี', 'its own ancient calendar offset ~7–8 years from the Gregorian'), label: p('ระบบปฏิทิน', 'calendar system'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('เม็กซิโก', 'Mexico'), category: 'country', discipline: 'social', secondary: ['art', 'econ'],
    tags: ['north-america', 'mayan'], facts: [
      CAP(p('เม็กซิโกซิตี', 'Mexico City')), CUR(p('เปโซเม็กซิโก', 'Mexican peso')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'ancientSite', value: p('ชิเชน อิตซา', 'Chichen Itza'), label: p('แหล่งโบราณสถานของอารยธรรมมายา', 'major Maya archaeological site'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'cuisineOrigin', value: p('ช็อกโกแลต (โกโก้)', 'chocolate (cocoa)'), label: p('อาหาร/เครื่องดื่มที่โลกรู้จักซึ่งมีต้นกำเนิดจากดินแดนนี้', 'food/drink originating there'), style: 'IS_KNOWN', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('อินโดนีเซีย', 'Indonesia'), category: 'country', discipline: 'geography', secondary: ['social', 'health'],
    tags: ['southeast-asia', 'archipelago'], facts: [
      CAP(p('จาการ์ตา', 'Jakarta')), CUR(p('รูเปียห์', 'rupiah')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'feature', value: p('กลุ่มเกาะภูเขาไฟโค้งแปซิฟิก', 'a volcanic archipelago on the Ring of Fire'), label: p('ลักษณะทางภูมิศาสตร์ของประเทศ', 'geographic character'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'islands', value: p('กว่า 17,000 เกาะ', 'over 17,000 islands'), label: p('จำนวนเกาะโดยประมาณ', 'approximate number of islands'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('คีร์กีซสถาน', 'Kyrgyzstan'), category: 'country', discipline: 'social', secondary: ['geography', 'career'],
    tags: ['central-asia', 'nomadic'], facts: [
      CAP(p('บิชเคก', 'Bishkek')), CUR(p('โซมคีร์กีซ', 'Kyrgyzstani som')), LANG(p('2 ภาษา', '2 languages'), 2),
      GEO({ id: 'epic', value: p('มหากาพย์มานัส', 'the Epic of Manas'), label: p('วรรณกรรมพื้นบ้านที่ยิ่งใหญ่ที่สุด', 'greatest folk epic'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'heritage', value: p('การเลี้ยงม้าเร่ร่อนกับเกมโคกบอรู', 'nomadic horse culture and kok-boru'), label: p('มรดกวัฒนธรรมที่ขึ้นทะเบียน UNESCO', 'UNESCO-listed heritage'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('บอตสวานา', 'Botswana'), category: 'country', discipline: 'geography', secondary: ['econ', 'social'],
    tags: ['southern-africa', 'diamonds'], facts: [
      CAP(p('กาโบโรเน', 'Gaborone')), CUR(p('พูลาบอตสวานา', 'Botswana pula')), LANG(p('2 ภาษา', '2 languages'), 2),
      GEO({ id: 'topExport', value: p('เพชร', 'diamonds'), label: p('สินค้าส่งออกอันดับหนึ่งเชิงมูลค่า', 'top export by value'), style: 'PRODUCES', source: 'UN', asOf: 2024 }),
      GEO({ id: 'delta', value: p('ดินดอนสามเหลี่ยมโอกาวังโก', 'the Okavango Delta'), label: p('ระบบนิเวศมรดกโลกที่มีน้ำท่วมตามฤดู', 'UNESCO inland delta that floods seasonally'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('กรีซ', 'Greece'), category: 'country', discipline: 'philosophy', secondary: ['social', 'art'],
    tags: ['europe', 'antiquity'], facts: [
      CAP(p('เอเธนส์', 'Athens')), CUR(p('ยูโร', 'euro')), LANG(p('1 ภาษา', '1 language'), 1),
      GEO({ id: 'ancientGame', value: p('กีฬาโอลิมปิกโบราณ (โอลิมเปีย)', 'the ancient Olympic Games (Olympia)'), label: p('การแข่งขันโบราณที่มีต้นกำเนิดในประเทศ', 'ancient competition originating there'), style: 'IS_KNOWN', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'governmentType', value: p('สาธารณรัฐแบบรัฐสภา', 'parliamentary republic'), label: p('รูปแบบการปกครอง', 'form of government'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('บอตสวานา (เมืองหลวง)', 'Gaborone (capital)'), category: 'city', discipline: 'geography', secondary: ['social'],
    tags: ['city', 'africa'], facts: [
      { id: 'country', value: p('บอตสวานา', 'Botswana'), label: p('ประเทศที่ตั้งอยู่', 'country'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'riverFeature', value: p('แม่น้ำโนตวาเน', 'the Notwane River'), label: p('แม่น้ำใกล้เมือง', 'nearby river'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ดาวพฤหัสบดี', 'Jupiter'), category: 'planet', discipline: 'science', secondary: ['math', 'geography'],
    tags: ['gas-giant', 'solar-system'], facts: [
      GEO({ id: 'moons', value: p('95 ดวง', '95 moons'), label: p('จำนวนดวงจันทร์บริวารที่ได้รับการรับรอง (ปี 2024)', 'confirmed moons (as of 2024)'), style: 'WHAT_IS', source: 'SCIENCE', asOf: 2024, unit: p('ดวง', 'moons') }),
      GEO({ id: 'greatSpot', value: p('จุดแดงใหญ่ (พายุหมุน)', 'the Great Red Spot'), label: p('ลักษณะอากาศที่มีชื่อเสียงที่สุด', 'most famous storm feature'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'position', value: p('ดาวเคราะห์ลำดับที่ 5 จากดวงอาทิตย์', 'the 5th planet from the Sun'), label: p('ลำดับจากดวงอาทิตย์', 'order from the Sun'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('ดาวเสาร์', 'Saturn'), category: 'planet', discipline: 'science', secondary: ['art', 'math'],
    tags: ['gas-giant', 'rings'], facts: [
      GEO({ id: 'moons', value: p('146 ดวง', '146 moons'), label: p('จำนวนดวงจันทร์บริวารที่ได้รับการรับรอง (ปี 2024)', 'confirmed moons (as of 2024)'), style: 'WHAT_IS', source: 'SCIENCE', asOf: 2024, unit: p('ดวง', 'moons') }),
      GEO({ id: 'feature', value: p('ระบบวงแหวนที่ใหญ่และสว่างที่สุดในระบบสุริยะ', 'the largest and brightest ring system'), label: p('ลักษณะเด่นที่สุด', 'defining feature'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'moonTitan', value: p('ไททัน — มีชั้นบรรยากาศหนาแน่น', 'Titan — has a dense atmosphere'), label: p('ดวงจันทร์ที่ใหญ่ที่สุดของดาว', 'largest moon of the planet'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('ดาวอังคาร', 'Mars'), category: 'planet', discipline: 'science', secondary: ['geography', 'ict'],
    tags: ['red-planet', 'exploration'], facts: [
      GEO({ id: 'moons', value: p('2 ดวง (โฟบอสและดีมอส)', '2 (Phobos and Deimos)'), label: p('จำนวนดวงจันทร์บริวาร', 'number of moons'), style: 'WHAT_IS', source: 'SCIENCE', unit: p('ดวง', 'moons') }),
      GEO({ id: 'mountain', value: p('ภูเขาไฟโอลิมปัสมอนส์', 'Olympus Mons'), label: p('ภูเขาไฟที่ใหญ่ที่สุดในระบบสุริยะซึ่งอยู่บนดาว', 'largest volcano in the solar system, located on it'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'colorCause', value: p('เหล็กออกไซด์ (สนิมเหล็ก) ในดิน', 'iron oxide (rust) in the soil'), label: p('สาเหตุของสีแดงทั่วพื้นผิว', 'cause of the reddish surface'), style: 'WHAT_IS', source: 'SCIENCE' }),
    ],
  },
  {
    name: p('ดาวเนปจูน', 'Neptune'), category: 'planet', discipline: 'science', secondary: ['math', 'philosophy'],
    tags: ['ice-giant', 'discovery-by-math'], facts: [
      GEO({ id: 'moons', value: p('16 ดวง', '16 moons'), label: p('จำนวนดวงจันทร์บริวารที่ได้รับการรับรอง (ปี 2024)', 'confirmed moons (as of 2024)'), style: 'WHAT_IS', source: 'SCIENCE', asOf: 2024, unit: p('ดวง', 'moons') }),
      GEO({ id: 'discovery', value: p('ค้นพบด้วยการคำนวณทางคณิตศาสตร์ก่อนมองเห็นจริง', 'predicted mathematically before being observed'), label: p('วิธีการค้นพบ', 'method of discovery'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'wind', value: p('ลมแรงที่สุดในระบบสุริยะ (ราว 2,100 กม./ชม.)', 'the fastest winds in the solar system (~2,100 km/h)'), label: p('สถิติสภาพอากาศ', 'weather record'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('ทองคำ (Au)', 'Gold (Au)'), category: 'element', discipline: 'science', secondary: ['econ', 'career'],
    tags: ['noble-metal', 'periodic-table'], facts: [
      { id: 'symbol', value: p('Au', 'Au'), label: p('สัญลักษณ์ธาตุ', 'element symbol'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'atomicNumber', value: p('79', '79'), label: p('เลขอะตอม', 'atomic number'), style: 'WHAT_IS', source: 'SCIENCE', unit: p('', '') },
      { id: 'conductivityRank', value: p('โลหะที่นำไฟฟ้าได้ดีเป็นอันดับต้น ๆ (รองจากเงินและทองแดงในการใช้งานจริง)', 'among the best electrical conductors'), label: p('สมบัติการนำไฟฟ้า', 'electrical conductivity'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('เงิน (Ag)', 'Silver (Ag)'), category: 'element', discipline: 'science', secondary: ['career', 'art'],
    tags: ['metal', 'conductor'], facts: [
      { id: 'symbol', value: p('Ag', 'Ag'), label: p('สัญลักษณ์ธาตุ', 'element symbol'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'atomicNumber', value: p('47', '47'), label: p('เลขอะตอม', 'atomic number'), style: 'WHAT_IS', source: 'SCIENCE', unit: p('', '') },
      { id: 'conductivityRank', value: p('โลหะที่นำไฟฟ้าได้ดีที่สุด', 'the best electrical conductor among metals'), label: p('สมบัติการนำไฟฟ้า', 'electrical conductivity'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('ทองแดง (Cu)', 'Copper (Cu)'), category: 'element', discipline: 'science', secondary: ['career', 'econ'],
    tags: ['wiring', 'conductor'], facts: [
      { id: 'symbol', value: p('Cu', 'Cu'), label: p('สัญลักษณ์ธาตุ', 'element symbol'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'atomicNumber', value: p('29', '29'), label: p('เลขอะตอม', 'atomic number'), style: 'WHAT_IS', source: 'SCIENCE', unit: p('', '') },
      { id: 'use', value: p('สายไฟฟ้าและท่อน้ำ', 'electrical wiring and pipes'), label: p('การใช้งานเชิงอุตสาหกรรมหลัก', 'primary industrial use'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ไนโตรเจน (N)', 'Nitrogen (N)'), category: 'element', discipline: 'science', secondary: ['health', 'math'],
    tags: ['gas', 'atmosphere'], facts: [
      { id: 'symbol', value: p('N', 'N'), label: p('สัญลักษณ์ธาตุ', 'element symbol'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'atomicNumber', value: p('7', '7'), label: p('เลขอะตอม', 'atomic number'), style: 'WHAT_IS', source: 'SCIENCE', unit: p('', '') },
      { id: 'atmosphereShare', value: p('ราว 78% ของชั้นบรรยากาศโลก', 'about 78% of Earth\'s atmosphere'), label: p('สัดส่วนในชั้นบรรยากาศโลก', 'share of Earth\'s atmosphere'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('คาร์บอน (C)', 'Carbon (C)'), category: 'element', discipline: 'science', secondary: ['ict', 'art'],
    tags: ['chemistry', 'diamond'], facts: [
      { id: 'symbol', value: p('C', 'C'), label: p('สัญลักษณ์ธาตุ', 'element symbol'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'atomicNumber', value: p('6', '6'), label: p('เลขอะตอม', 'atomic number'), style: 'WHAT_IS', source: 'SCIENCE', unit: p('', '') },
      { id: 'forms', value: p('แกรไฟต์และเพชร (อัญรูปเดียวกันต่างโครงสร้าง)', 'graphite and diamond (same element, different structure)'), label: p('อัญรูปที่รู้จักกันดี', 'well-known allotropes'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('แม่น้ำไนล์', 'the Nile'), category: 'river', discipline: 'geography', secondary: ['social', 'math'],
    tags: ['africa', 'long-river'], facts: [
      GEO({ id: 'continent', value: p('ทวีปแอฟริกา', 'Africa'), label: p('ทวีปที่ไหลผ่าน', 'continent'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'direction', value: p('ไหลจากใต้ขึ้นเหนือ', 'flows south to north'), label: p('ทิศทางการไหลหลัก', 'general flow direction'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'deltaCountry', value: p('สาธารณรัฐอาหรับเอียงตอนเหนือ — ปากแม่น้ำอยู่ที่เมืองพอร์ตไซด์ อียิปต์', 'its delta empties into the Mediterranean in Egypt'), label: p('บริเวณปากแม่น้ำ', 'river mouth region'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('แม่น้ำแอมะซอน', 'the Amazon River'), category: 'river', discipline: 'geography', secondary: ['science', 'math'],
    tags: ['south-america', 'discharge'], facts: [
      GEO({ id: 'discharge', value: p('สายที่มีปริมาณน้ำมากที่สุดในโลก', 'the river with the largest discharge volume'), label: p('สถิติปริมาณน้ำ', 'discharge record'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'continent', value: p('ทวีปอเมริกาใต้', 'South America'), label: p('ทวีปที่ไหลผ่าน', 'continent'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'estuary', value: p('มหาสมุทรแอตแลนติก', 'the Atlantic Ocean'), label: p('ทะเล/มหาสมุทรปลายทาง', 'final receiving ocean'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('แม่น้ำโขง', 'the Mekong River'), category: 'river', discipline: 'geography', secondary: ['social', 'econ'],
    tags: ['asia', 'transboundary'], facts: [
      GEO({ id: 'countries', value: p('6 ประเทศ (จีน เมียนมา ไทย ลาว กัมพูชา เวียดนาม)', '6 countries (China, Myanmar, Thailand, Laos, Cambodia, Vietnam)'), label: p('จำนวนประเทศที่ไหลผ่าน', 'number of countries it flows through'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA', unit: p('ประเทศ', 'countries') }),
      GEO({ id: 'continent', value: p('ทวีปเอเชีย', 'Asia'), label: p('ทวีปที่ไหลผ่าน', 'continent'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'delta', value: p('สามเหลี่ยมปากแม่น้ำในเวียดนามใต้ตอนใต้ (ดินดอนสามเหลี่ยมโขง)', 'its delta in southern Vietnam'), label: p('รูปแบบปากแม่น้ำสำคัญ', 'notable delta'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('แม่น้ำดานูบ', 'the Danube River'), category: 'river', discipline: 'geography', secondary: ['social', 'english'],
    tags: ['europe', 'transboundary'], facts: [
      GEO({ id: 'countries', value: p('10 ประเทศ — มากที่สุดในโลก', '10 countries — the most in the world'), label: p('จำนวนประเทศที่ไหลผ่าน', 'countries flowed through'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA', unit: p('ประเทศ', 'countries') }),
      GEO({ id: 'source', value: p('ป่าดำ (Black Forest) ในเยอรมนี', 'the Black Forest in Germany'), label: p('ต้นน้ำ', 'source region'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
      GEO({ id: 'estuary', value: p('ทะเลดำ', 'the Black Sea'), label: p('ทะเลปลายทาง', 'receiving sea'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' }),
    ],
  },
  {
    name: p('ไมโทคอนเดรีย', 'mitochondria'), category: 'organelle', discipline: 'science', secondary: ['health', 'philosophy'],
    tags: ['cell', 'atp'], facts: [
      { id: 'function', value: p('ผลิตพลังงาน ATP ด้วยการหายใจระดับเซลล์', 'produce ATP via cellular respiration'), label: p('หน้าที่หลัก', 'main function'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'genome', value: p('มีดีเอ็นเอของตัวเอง (ถ่ายทอดทางแม่)', 'carry their own DNA (maternally inherited)'), label: p('ลักษณะพิเศษทางพันธุกรรม', 'genetic peculiarity'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'nickname', value: p('โรงไฟฟ้าของเซลล์', 'the powerhouse of the cell'), label: p('ฉายาที่ใช้เรียก', 'common nickname'), style: 'IS_KNOWN', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ไรโบโซม', 'ribosomes'), category: 'organelle', discipline: 'science', secondary: ['health', 'ict'],
    tags: ['cell', 'protein'], facts: [
      { id: 'function', value: p('แปลรหัส mRNA เป็นสายโปรตีน', 'translate mRNA into protein chains'), label: p('หน้าที่หลัก', 'main function'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'location', value: p('ลอยอยู่ในไซโทพลาซึมหรือเกาะบนเอนโดพลาสมิกเรติคูลัม', 'free in cytoplasm or bound to the ER'), label: p('ตำแหน่งในเซลล์', 'location in the cell'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'structure', value: p('ประกอบจาก rRNA และโปรตีน ไม่มีเยื่อหุ้ม', 'made of rRNA and protein, with no membrane'), label: p('โครงสร้าง', 'structure'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('คลอโรพลาสต์', 'chloroplasts'), category: 'organelle', discipline: 'science', secondary: ['art', 'math'],
    tags: ['cell', 'photosynthesis'], facts: [
      { id: 'function', value: p('สังเคราะห์แสงเปลี่ยนพลังงานแสงเป็นน้ำตาลกลูโคส', 'perform photosynthesis, turning light into glucose'), label: p('หน้าที่หลัก', 'main function'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'pigment', value: p('คลอโรฟิลล์', 'chlorophyll'), label: p('สารสีสำคัญที่ดูดกลืนแสง', 'light-absorbing pigment'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'foundIn', value: p('เซลล์พืชและสาหร่าย', 'plant and algal cells'), label: p('พบในสิ่งมีชีวิตกลุ่มใด', 'found in'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('ไลโซโซม', 'lysosomes'), category: 'organelle', discipline: 'science', secondary: ['health', 'philosophy'],
    tags: ['cell', 'digestion'], facts: [
      { id: 'function', value: p('ย่อยสลายของเสียและออร์แกเนลล์ที่เสื่อมสภาพด้วยเอนไซม์', 'digest waste and worn-out organelles with enzymes'), label: p('หน้าที่หลัก', 'main function'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'ph', value: p('เป็นกรด (pH ราว 4.5–5)', 'acidic (pH ~4.5–5)'), label: p('สภาพแวดล้อมภายใน', 'internal environment'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'nickname', value: p('ศูนย์กำจัดขยะของเซลล์', 'the recycling center of the cell'), label: p('ฉายาที่ใช้เรียก', 'common nickname'), style: 'IS_KNOWN', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('วิตามินซี', 'Vitamin C'), category: 'vitamin', discipline: 'health', secondary: ['science', 'social'],
    tags: ['nutrition', 'immunity'], facts: [
      { id: 'deficiency', value: p('โรคลักปิดลักเปิด (เลือดออกตามไรฟัน)', 'scurvy'), label: p('โรคจากการขาด', 'deficiency disease'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'source', value: p('ผลไม้ตระกูลส้มและพริกหวาน', 'citrus fruits and bell peppers'), label: p('แหล่งอาหารที่อุดม', 'rich food sources'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'property', value: p('ละลายน้ำและถูกทำลายด้วยความร้อนได้ง่าย', 'water-soluble and easily destroyed by heat'), label: p('สมบัติเด่น', 'notable property'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('วิตามินดี', 'Vitamin D'), category: 'vitamin', discipline: 'health', secondary: ['science', 'geography'],
    tags: ['nutrition', 'sunlight'], facts: [
      { id: 'deficiency', value: p('โรคกระดูกอ่อนในเด็ก (rickets)', 'rickets in children'), label: p('โรคจากการขาด', 'deficiency disease'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'source', value: p('การสังเคราะห์ใต้ผิวหนังเมื่อโดนแสงแดด UV-B', 'skin synthesis from UV-B sunlight'), label: p('แหล่งหลักที่พึ่งได้', 'primary natural source'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'property', value: p('ละลายในไขมันและช่วยดูดซึมแคลเซียม', 'fat-soluble and aids calcium absorption'), label: p('สมบัติเด่น', 'notable property'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('ธาตุเหล็ก', 'Iron'), category: 'vitamin', discipline: 'health', secondary: ['science', 'social'],
    tags: ['mineral', 'blood'], facts: [
      { id: 'deficiency', value: p('โรคโลหิตจางจากการขาดเหล็ก', 'iron-deficiency anemia'), label: p('โรคจากการขาด', 'deficiency condition'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'source', value: p('ตับสัตว์ ผักใบเขียวเข้ม', 'liver and dark leafy greens'), label: p('แหล่งอาหารที่อุดม', 'rich food sources'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'role', value: p('เป็นส่วนประกอบของฮีโมโกลบินลำเลียงออกซิเจน', 'a hemoglobin component that carries oxygen'), label: p('บทบาทในร่างกาย', 'role in the body'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('แคลเซียม', 'Calcium'), category: 'vitamin', discipline: 'health', secondary: ['science', 'math'],
    tags: ['mineral', 'bone'], facts: [
      { id: 'deficiency', value: p('กระดูกพรุนและกระดูกอ่อนแรง', 'osteoporosis and weak bones'), label: p('ผลจากการขาดเรื้อรัง', 'chronic-deficiency outcome'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'source', value: p('นมและผลิตภัณฑ์นม', 'milk and dairy products'), label: p('แหล่งอาหารที่อุดม', 'rich food sources'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'role', value: p('สร้างกระดูกและควบคุมการหดเกร็งกล้ามเนื้อ', 'building bone and controlling muscle contraction'), label: p('บทบาทในร่างกาย', 'role in the body'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('ไอโอดีน', 'Iodine'), category: 'vitamin', discipline: 'health', secondary: ['geography', 'social'],
    tags: ['mineral', 'thyroid'], facts: [
      { id: 'deficiency', value: p('โรคคอพอกจากต่อมไทรอยด์ทำงานผิดปกติ', 'goiter from thyroid dysfunction'), label: p('โรคจากการขาด', 'deficiency condition'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'source', value: p('เกลือเสริมไอโอดีนและอาหารทะเล', 'iodized salt and seafood'), label: p('แหล่งอาหารที่อุดม', 'rich food sources'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'role', value: p('เป็นองค์ประกอบของฮอร์โมนไทรอยด์ควบคุมเมตาบอลิซึม', 'a thyroid-hormone component regulating metabolism'), label: p('บทบาทในร่างกาย', 'role in the body'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('มารี กูรี', 'Marie Curie'), category: 'physicist', discipline: 'science', secondary: ['philosophy', 'social'],
    tags: ['nobel', 'radioactivity'], facts: [
      { id: 'nobel', value: p('ได้รางวัลโนเบล 2 สาขา (ฟิสิกส์ 1903 และเคมี 1911)', 'two Nobel Prizes (Physics 1903, Chemistry 1911)'), label: p('สถิติรางวัลโนเบล', 'Nobel record'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'discovery', value: p('บุกเบิกคำว่า "กัมมันตรังสี" และค้นพบธาตุโพโลเนียม-เรเดียม', 'coined "radioactivity" and discovered polonium and radium'), label: p('ผลงานวิจัยสำคัญ', 'key research achievement'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'nationality', value: p('เกิดในโปแลนด์ ทำงานหลักในฝรั่งเศส', 'born in Poland, worked mainly in France'), label: p('ประเทศที่เกี่ยวข้อง', 'associated countries'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('อัลเบิร์ต ไอน์สไตน์', 'Albert Einstein'), category: 'physicist', discipline: 'science', secondary: ['math', 'philosophy'],
    tags: ['relativity', 'nobel'], facts: [
      { id: 'nobel', value: p('โนเบลฟิสิกส์ 1921 จากผลของปรากฏการณ์โฟโตอิเล็กทริก', 'the 1921 Physics Nobel for the photoelectric effect'), label: p('สาเหตุที่ได้รางวัลโนเบล', 'Nobel citation'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'theory', value: p('ทฤษฎีสัมพัทธภาพ (พิเศษและทั่วไป)', 'relativity (special and general)'), label: p('ทฤษฎีที่มีชื่อเสียงที่สุด', 'most famous theory'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'equation', value: p('E = mc²', 'E = mc²'), label: p('สมการที่เป็นสัญลักษณ์ของเขา', 'his signature equation'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('อิสซัค นิวตัน', 'Isaac Newton'), category: 'physicist', discipline: 'science', secondary: ['math', 'philosophy'],
    tags: ['gravity', 'calculus'], facts: [
      { id: 'laws', value: p('กฎการเคลื่อนที่ 3 ข้อของนิวตัน', 'Newton\'s three laws of motion'), label: p('ผลงานที่รู้จักกันดีที่สุด', 'best-known contribution'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'math', value: p('เป็นผู้บุกเบิกแคลคูลัสร่วมกับไลบ์นิซ (คนละสาย)', 'co-invented calculus independently of Leibniz'), label: p('ผลงานด้านคณิตศาสตร์', 'mathematical achievement'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'optics', value: p('แสดงว่าแสงขาวประกอบจากสเปกตรัมสี', 'showed white light splits into a spectrum of colors'), label: p('ผลงานด้านทัศนศาสตร์', 'optics achievement'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ซิกมุนด์ ฟรอยด์', 'Sigmund Freud'), category: 'philosopher', discipline: 'philosophy', secondary: ['health', 'thai'],
    tags: ['psychoanalysis', 'mind'], facts: [
      { id: 'field', value: p('บุกเบิกจิตวิเคราะห์ (psychoanalysis)', 'founded psychoanalysis'), label: p('สาขาที่บุกเบิก', 'founded field'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'model', value: p('โครงสร้างจิต 3 ส่วน: อิด เอโก ซูเปอร์เอโก', 'the id, ego, and superego model of the psyche'), label: p('แบบจำลองที่เสนอ', 'proposed model'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'method', value: p('การตีความความฝันเป็นหน้าต่างสู่จิตไร้สำนึก', 'dream interpretation as a window to the unconscious'), label: p('เทคนิควิเคราะห์ที่เป็นเอกลักษณ์', 'signature analytic technique'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('อริสโตเติล', 'Aristotle'), category: 'philosopher', discipline: 'philosophy', secondary: ['social', 'science'],
    tags: ['logic', 'greek'], facts: [
      { id: 'logic', value: p('บุกเบิกตรรกศาสตรนิรนัยแบบนิยามเชิงหมวดหมู่', 'founded formal deductive logic'), label: p('ผลงานด้านตรรกศาสตร์', 'logic contribution'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'student', value: p('เป็นอาจารย์ของอเล็กซานเดอร์มหาราช', 'tutored Alexander the Great'), label: p('บทบาทประวัติศาสตร์', 'historical role'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'school', value: p('ก่อตั้งสำนักไลเซียม (Lyceum) ในเอเธนส์', 'founded the Lyceum in Athens'), label: p('สถาบันที่ก่อตั้ง', 'institution founded'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('อิมมานูเอล แคนต์', 'Immanuel Kant'), category: 'philosopher', discipline: 'philosophy', secondary: ['math', 'social'],
    tags: ['enlightenment', 'ethics'], facts: [
      { id: 'ethics', value: p('จริยวิทยาหน้าที่นิยม (deontology) กับหลักนิยัตินัย', 'deontological ethics with the categorical imperative'), label: p('ทฤษฎีจริยธรรมที่เสนอ', 'ethical theory'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'work', value: p('หนังสือ "วิจารณญาณบริสุทธิ์" (Critique of Pure Reason)', 'the Critique of Pure Reason'), label: p('ผลงานชิ้นเอก', 'magnum opus'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'epistemology', value: p('ความรู้เกิดจากประสบการณ์บวกโครงสร้างความคิดในตัว', 'knowledge arises from experience shaped by innate structures'), label: p('ทฤษฎีความรู้', 'epistemology'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('วิลเลียม เชกสเปียร์', 'William Shakespeare'), category: 'author', discipline: 'english', secondary: ['art', 'thai'],
    tags: ['drama', 'elizabethan'], facts: [
      { id: 'tragedies', value: p('แฮมเลต แมคเบธ และคิงเลียร์', 'Hamlet, Macbeth, and King Lear'), label: p('บทละครโศกที่รู้จักกันดี', 'famous tragedies'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'language', value: p('บุกเบิกคำศัพท์และสำนวนอังกฤษนับพันคำ', 'introduced thousands of English words and phrases'), label: p('ผลกระทบต่อภาษา', 'linguistic impact'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'venue', value: p('โรงละครเดอะโกลบ (The Globe)', 'the Globe Theatre'), label: p('โรงละครที่ผูกพันที่สุด', 'associated playhouse'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ซุนจื่อ', 'Sun Tzu'), category: 'author', discipline: 'social', secondary: ['philosophy', 'career'],
    tags: ['strategy', 'classic'], facts: [
      { id: 'work', value: p('ตำราพิชัยสงคราม "อารต์ออฟวอร์"', 'The Art of War'), label: p('ตำราที่เขียน', 'authored treatise'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'era', value: p('ยุคชุนชิวของจีนโบราณ', 'China\'s Spring and Autumn period'), label: p('ยุคสมัย', 'era'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'principle', value: p('ชนะโดยไม่ต้องรบจริงคือชัยชนะสูงสุด', 'winning without fighting is the supreme victory'), label: p('หลักคิดที่โด่งดัง', 'famous doctrine'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('หลุยส์ คาร์โรล', 'Lewis Carroll'), category: 'author', discipline: 'english', secondary: ['math', 'ict'],
    tags: ['children', 'logic'], facts: [
      { id: 'work', value: p('อลิซในแดนมหัศจรรย์', 'Alice\'s Adventures in Wonderland'), label: p('นวนิยายที่เขียน', 'authored novel'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'profession', value: p('เป็นนักคณิตศาสตร์ (ชื่อจริง ชาลส์ ดอจสัน)', 'a mathematician (real name Charles Dodgson)'), label: p('อาชีพจริง', 'day profession'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'style', value: p('เล่นคำและตรรกะแบบไร้สาระที่ซ้อนตรรกะจริง', 'nonsense wordplay layered with real logic puzzles'), label: p('สไตล์การเขียน', 'writing style'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('เลโอนาร์โด ดา วินชี', 'Leonardo da Vinci'), category: 'painter', discipline: 'art', secondary: ['science', 'career'],
    tags: ['renaissance', 'polymath'], facts: [
      { id: 'painting', value: p('โมนาลิซา', 'the Mona Lisa'), label: p('ภาพวาดที่มีชื่อเสียงที่สุด', 'most famous painting'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'fresco', value: p('ภาพ "เดอะลาสต์ซัพเพอร์"', 'The Last Supper'), label: p('ภาพฝาผนังชิ้นเอก', 'famous fresco'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'notebooks', value: p('สมุดบันทึกภาพร่างเครื่องบินและเครื่องกลก่อนยุคของมัน', 'notebooks sketching flying machines centuries early'), label: p('หลักฐานความเป็นอัจฉริยะรอบด้าน', 'evidence of polymath genius'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('วินเซนต์ แวน โกะ', 'Vincent van Gogh'), category: 'painter', discipline: 'art', secondary: ['philosophy', 'health'],
    tags: ['post-impressionist', 'netherlands'], facts: [
      { id: 'painting', value: p('คืนแห่งดวงดาว (The Starry Night)', 'The Starry Night'), label: p('ภาพที่มีชื่อเสียงที่สุด', 'most famous painting'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'sales', value: p('ขายภาพได้เพียงไม่กี่ภาพตลอดชีวิต', 'sold only a few paintings while alive'), label: p('ชะตากรรมการตลาดระหว่างมีชีวิต', 'commercial fate in his lifetime'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'style', value: p('ปื้นสีหนาจังหวะแรงแบบโพสต์อิมเพรสชันนิสต์', 'thick expressive impasto brushwork'), label: p('เทคนิคเด่น', 'signature technique'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ลุดวิจ ฟาน เบโทเฟน', 'Ludwig van Beethoven'), category: 'composer', discipline: 'art', secondary: ['health', 'philosophy'],
    tags: ['classical', 'symphony'], facts: [
      { id: 'deafness', value: p('ประพันธ์ซิมโฟนีชิ้นเอกทั้งที่สูญเสียการได้ยิน', 'composed masterworks while going deaf'), label: p('เรื่องเล่าที่โด่งดัง', 'famous life story'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'work', value: p('ซิมโฟนีที่ 9 ที่มีเพลง "โอดทูจอย"', 'the Ninth Symphony with "Ode to Joy"'), label: p('ผลงานชิ้นเอก', 'celebrated work'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'era', value: p('เชื่อมดนตรีคลาสสิกเข้าสู่ยุคโรแมนติก', 'bridged the Classical and Romantic eras'), label: p('บทบาทในดนตรีตะวันตก', 'historical role'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('โมทสาร์ต', 'Mozart'), category: 'composer', discipline: 'art', secondary: ['math', 'english'],
    tags: ['classical', 'prodigy'], facts: [
      { id: 'prodigy', value: p('เริ่มแต่งเพลงตั้งแต่อายุ 5 ขวบ', 'began composing at age five'), label: p('เรื่องเล่าที่โด่งดัง', 'famous life story'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'work', value: p('อุปรากร "เดอะแมจิกฟลูต"', 'The Magic Flute'), label: p('อุปรากรที่รู้จักกันดี', 'famous opera'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'output', value: p('ผลงานกว่า 600 ชิ้นในชีวิตอันสั้น', 'over 600 works in a short life'), label: p('ปริมาณผลงาน', 'output size'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('จักรวรรดิโรมันตะวันออก (ไบแซนไทน์)', 'the Byzantine Empire'), category: 'empire', discipline: 'social', secondary: ['art', 'geography'],
    tags: ['ancient', 'mediterranean'], facts: [
      { id: 'capital', value: p('คอนสแตนติโนเปิล (อิสตันบูลปัจจุบัน)', 'Constantinople (today\'s Istanbul)'), label: p('เมืองหลวง', 'capital'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'fall', value: p('ล่มในปี 1453 เมื่อออตโตมันยึดเมืองหลวงได้', 'fell in 1453 when the Ottomans took its capital'), label: p('การสิ้นสุด', 'end'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'law', value: p('ประมวลกฎหมายจัสติเนียน (Corpus Juris Civilis)', 'Justinian\'s Corpus Juris Civilis'), label: p('มรดกด้านกฎหมาย', 'legal legacy'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('จักรวรรดิมองโกล', 'the Mongol Empire'), category: 'empire', discipline: 'social', secondary: ['geography', 'econ'],
    tags: ['steppe', 'largest-land'], facts: [
      { id: 'founder', value: p('เจงกีสข่าน', 'Genghis Khan'), label: p('ผู้ก่อตั้ง', 'founder'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'size', value: p('จักรวรรดิต่อเนื่องทางบกที่ใหญ่ที่สุดในประวัติศาสตร์', 'the largest contiguous land empire in history'), label: p('สถิติขนาด', 'size record'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'trade', value: p('เปิดเส้นทางสายไหมให้ปลอดภัย ("สันติภาพมองโกล")', 'secured the Silk Road ("Pax Mongolica")'), label: p('มรดกด้านการค้า', 'trade legacy'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ราชวงศ์โชเซ็น', 'the Joseon Dynasty'), category: 'empire', discipline: 'social', secondary: ['thai', 'ict'],
    tags: ['korea', 'dynasty'], facts: [
      { id: 'alphabet', value: p('รับสั่งให้ประดิษฐ์อักษรฮันกึล (ชุดพระราชโองการฮุนมินจองอึม)', 'commissioned the Hangul alphabet (Hunminjeongeum)'), label: p('มรดกด้านภาษา', 'language legacy'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'capital', value: p('ฮันยาง (โซลปัจจุบัน)', 'Hanyang (today\'s Seoul)'), label: p('เมืองหลวง', 'capital'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'duration', value: p('ปกครองราว 500 ปี (1392–1897)', 'ruled roughly five centuries (1392–1897)'), label: p('ช่วงเวลา', 'duration'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('สงครามโลกครั้งที่สอง', 'World War II'), category: 'battle', discipline: 'social', secondary: ['ict', 'philosophy'],
    tags: ['history', 'wwii'], facts: [
      { id: 'codebreaking', value: p('เครื่องอัลตราของอังกฤษถอดรหัสเอนิกมา', 'Britain\'s Ultra program broke Enigma'), label: p('ปัจจัยด้านสารสนเทศ', 'intelligence factor'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'end', value: p('จบลงในปี 1945 ทั้งยุโรป (พฤษภาคม) และแปซิฟิก (กันยายน)', 'ended in 1945 (May in Europe, September in the Pacific)'), label: p('การสิ้นสุด', 'end'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'conference', value: p('การประชุมยัลตาวางแผนหลังสงคราม', 'the Yalta Conference planned the postwar order'), label: p('การประชุมสำคัญ', 'key summit'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('สนธิสัญญาเวอร์ซาย', 'the Treaty of Versailles'), category: 'agreement', discipline: 'social', secondary: ['econ', 'philosophy'],
    tags: ['history', 'treaty'], facts: [
      { id: 'year', value: p('1919', '1919'), label: p('ปีที่ลงนาม', 'year signed'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA', unit: p('', '') },
      { id: 'target', value: p('กำหนดความรับผิดชอบสงครามแก่เยอรมนี', 'assigned war guilt to Germany'), label: p('ข้อกำหนดที่โด่งดัง', 'famous provision'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'league', value: p('ก่อตั้งสันนิบาตชาติขึ้นเป็นครั้งแรก', 'created the League of Nations'), label: p('สถาบันที่ก่อตั้ง', 'institution created'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ประกาศศักดิ์สิทธิแห่งมนุษยชน', 'the Universal Declaration of Human Rights'), category: 'agreement', discipline: 'social', secondary: ['philosophy', 'thai'],
    tags: ['human-rights', 'un'], facts: [
      { id: 'year', value: p('1948', '1948'), label: p('ปีที่รับรอง', 'year adopted'), style: 'WHAT_IS', source: 'UN', unit: p('', '') },
      { id: 'drafter', value: p('มีเออร์รี ชากาเรียสเป็นผู้ร่างหลัก', 'Hersch Lauterpacht and René Cassin shaped the text; Eleanor Roosevelt chaired the committee'), label: p('ผู้ร่างหลัก', 'principal drafters'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'record', value: p('เป็นเอกสารที่ถูกแปลเป็นภาษามากที่สุดในโลก (กว่า 500 ภาษา)', 'the most translated document in the world (500+ languages)'), label: p('สถิติการแปล', 'translation record'), style: 'WHAT_IS', source: 'UN' },
    ],
  },
  {
    name: p('สุสานหลวงชินและกองทัพทหารดินเผา', 'the Terracotta Army'), category: 'wonder', discipline: 'art', secondary: ['social', 'career'],
    tags: ['unesco', 'china'], facts: [
      { id: 'purpose', value: p('ฝังร่วมสุสานจักรพรรดิชินสื่อหวงเพื่อคุ้มกันในปรโลก', 'built to guard Emperor Qin Shi Huang in the afterlife'), label: p('จุดประสงค์', 'purpose'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'discovery', value: p('ชาวนาขุดบ่อพบโดยบังเอิญในปี 1974', 'discovered by farmers digging a well in 1974'), label: p('การค้นพบ', 'discovery'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'detail', value: p('ทหารแต่ละนายมีใบหน้าไม่ซ้ำกัน', 'each soldier has a distinct face'), label: p('รายละเอียดที่น่าทึ่ง', 'remarkable detail'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('แฮชเซ็ต (Hash Set)', 'Hash Set'), category: 'datastructure', discipline: 'ict', secondary: ['math', 'philosophy'],
    tags: ['data-structure', 'algorithms'], facts: [
      { id: 'lookup', value: p('เฉลี่ย O(1) ต่อการค้นหา', 'O(1) average lookup'), label: p('ความเร็วการค้นหาเฉลี่ย', 'average lookup complexity'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'duplicates', value: p('เก็บสมาชิกซ้ำไม่ได้', 'cannot store duplicate members'), label: p('กฎการเก็บสมาชิก', 'membership rule'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'basis', value: p('ใช้ฟังก์ชันแฮชเลือกบักเก็ต', 'uses a hash function to pick buckets'), label: p('กลไกหลัก', 'core mechanism'), style: 'WHAT_IS', source: 'DOC' },
    ],
  },
  {
    name: p('คิว (Queue)', 'Queue'), category: 'datastructure', discipline: 'ict', secondary: ['math', 'philosophy'],
    tags: ['data-structure', 'fifo'], facts: [
      { id: 'order', value: p('เข้าก่อนออกก่อน (FIFO)', 'first in, first out (FIFO)'), label: p('ลำดับการทำงาน', 'ordering principle'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'ops', value: p('enqueue และ dequeue', 'enqueue and dequeue'), label: p('ปฏิบัติการหลัก', 'primary operations'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'use', value: p('จัดคิวงานพิมพ์และตัวกลางข้อความ (message broker)', 'print queues and message brokers'), label: p('การใช้งานจริงทั่วไป', 'typical real-world use'), style: 'WHAT_IS', source: 'DOC' },
    ],
  },
  {
    name: p('โปรโตคอล HTTP/2', 'HTTP/2'), category: 'protocol', discipline: 'ict', secondary: ['math', 'career'],
    tags: ['web', 'protocol'], facts: [
      { id: 'feature', value: p('มัลติเพล็กซ์ — หลายคำขอคุยกันบนการเชื่อมต่อเดียว', 'multiplexing — many requests share one connection'), label: p('ฟีเจอร์ใหม่ที่สำคัญ', 'headline feature'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'header', value: p('บีบอัดเฮดเดอร์ด้วย HPACK', 'compresses headers with HPACK'), label: p('การจัดการเฮดเดอร์', 'header handling'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'transport', value: p('ยังวิ่งบน TCP (ต่างจาก HTTP/3 ที่ใช้ QUIC)', 'runs over TCP (unlike HTTP/3\'s QUIC)'), label: p('ชั้นขนส่ง', 'transport layer'), style: 'WHAT_IS', source: 'DOC' },
    ],
  },
  {
    name: p('โปรโตคอล TLS', 'TLS'), category: 'protocol', discipline: 'ict', secondary: ['math', 'philosophy'],
    tags: ['security', 'encryption'], facts: [
      { id: 'purpose', value: p('เข้ารหัสและตรวจสอบความถูกต้องของการสื่อสาร', 'encrypts and authenticates communication'), label: p('จุดประสงค์', 'purpose'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'handshake', value: p('แลกเปลี่ยนกุญแจแบบ Diffie–Hellman ก่อนส่งข้อมูล', 'performs a Diffie–Hellman key exchange first'), label: p('ขั้นตอนเริ่มต้น', 'initial step'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'version', value: p('TLS 1.3 ตัดอัลกอริทึมเก่าและลดรอบการจับมือ', 'TLS 1.3 dropped legacy ciphers and cut round trips'), label: p('เวอร์ชันปัจจุบันที่แนะนำ', 'current recommended version'), style: 'WHAT_IS', source: 'DOC' },
    ],
  },
  {
    name: p('หัวใจ', 'the human heart'), category: 'bodyorgan', discipline: 'health', secondary: ['science', 'math'],
    tags: ['circulation', 'anatomy'], facts: [
      { id: 'chambers', value: p('4 ห้อง (เอเทรียม 2 และเวนทริเคิล 2)', '4 chambers (two atria, two ventricles)'), label: p('จำนวนห้อง', 'number of chambers'), style: 'WHAT_IS', source: 'SCIENCE', unit: p('ห้อง', 'chambers') },
      { id: 'output', value: p('สูบเลือดราว 5 ลิตรต่อนาทีในผู้ใหญ่พักผ่อน', 'pumps roughly 5 liters per minute at rest'), label: p('อัตราการสูบฉีดเฉลี่ย', 'average output'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'pacemaker', value: p('โหนด SA เป็นจังหวะธรรมชาติ', 'the SA node sets its natural rhythm'), label: p('ระบบนาฬิกาภายใน', 'internal pacemaker'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('ปอด', 'the lungs'), category: 'bodyorgan', discipline: 'health', secondary: ['science', 'geography'],
    tags: ['respiration', 'anatomy'], facts: [
      { id: 'lobes', value: p('ปอดขวา 3 พู ปอดซ้าย 2 พู', 'three lobes on the right, two on the left'), label: p('จำนวนพู', 'lobe count'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'alveoli', value: p('ถุงลม (alveoli) ราว 300 ล้านถุงต่อปอดหนึ่งข้าง', 'around 300 million alveoli per lung'), label: p('หน่วยแลกเปลี่ยนแก๊ส', 'gas-exchange units'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'surface', value: p('พื้นที่แลกเปลี่ยนแก๊สรวมราว 70 ตารางเมตร', 'a total gas-exchange area of about 70 m²'), label: p('พื้นที่แลกเปลี่ยนแก๊ส', 'exchange surface area'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('ตับ', 'the liver'), category: 'bodyorgan', discipline: 'health', secondary: ['science', 'career'],
    tags: ['metabolism', 'anatomy'], facts: [
      { id: 'function', value: p('กำจัดพิษและสร้างน้ำดีย่อยไขมัน', 'detoxifies and produces bile for fat digestion'), label: p('หน้าที่หลัก', 'main function'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'regeneration', value: p('งอกคืนได้จากเนื้อเยื่อที่เหลือ', 'regenerates from remaining tissue'), label: p('ความสามารถพิเศษ', 'special ability'), style: 'WHAT_IS', source: 'SCIENCE' },
      { id: 'store', value: p('เก็บไกลโคเจนและวิตามินที่ละลายในไขมัน', 'stores glycogen and fat-soluble vitamins'), label: p('บทบาทการสะสม', 'storage role'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('กีฬาโอลิมปิก', 'the Olympic Games'), category: 'sport', discipline: 'health', secondary: ['social', 'geography'],
    tags: ['sports', 'international'], facts: [
      { id: 'cycle', value: p('จัดทุก 4 ปี', 'held every four years'), label: p('ความถี่การจัด', 'cadence'), style: 'WHAT_IS', source: 'SPORT' },
      { id: 'motto', value: p('เร็วกว่า สูงกว่า แข็งแกร่งกว่า — พร้อมกันไปด้วยกัน (เพิ่มปี 2021)', 'Faster, Higher, Stronger — Together (added 2021)'), label: p('คำขวัญ', 'motto'), style: 'WHAT_IS', source: 'SPORT' },
      { id: 'rings', value: p('5 วงแหวน แทนทวีป 5 กลุ่ม', 'five rings for five continental groups'), label: p('สัญลักษณ์', 'symbol'), style: 'WHAT_IS', source: 'SPORT' },
    ],
  },
  {
    name: p('ฟุตบอลโลก', 'the FIFA World Cup'), category: 'sportevent', discipline: 'health', secondary: ['social', 'math'],
    tags: ['sports', 'tournament'], facts: [
      { id: 'first', value: p('จัดครั้งแรกในปี 1930 ที่อุรุกวัย', 'first held in 1930 in Uruguay'), label: p('ครั้งแรก', 'first edition'), style: 'WHAT_IS', source: 'SPORT' },
      { id: 'wins', value: p('บราซิลชนะมากที่สุด 5 สมัย', 'Brazil leads with five titles'), label: p('สถิติแชมป์', 'title record'), style: 'WHAT_IS', source: 'SPORT' },
      { id: 'trophy', value: p('ถ้วยปัจจุบันชื่อ "ฟีฟ่าเวิลด์คัพ" ทองคำ 18 กะรัต', 'the current trophy is 18-carat gold'), label: p('ถ้วยรางวัล', 'trophy'), style: 'WHAT_IS', source: 'SPORT' },
    ],
  },
  {
    name: p('เปียโน', 'the piano'), category: 'instrument', discipline: 'art', secondary: ['math', 'career'],
    tags: ['music', 'keyboard'], facts: [
      { id: 'keys', value: p('88 คีย์ในแบบมาตรฐานสมัยใหม่', '88 keys on the modern standard'), label: p('จำนวนคีย์', 'key count'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA', unit: p('คีย์', 'keys') },
      { id: 'inventor', value: p('บาร์โตโลเมโอ คริสโตฟอรี ราวปี 1700', 'Bartolomeo Cristofori around 1700'), label: p('ผู้ประดิษฐ์', 'inventor'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'mechanism', value: p('ค้อนตีสายโลหะตามแรงกดคีย์', 'hammers strike strings with key pressure'), label: p('กลไกเสียง', 'sound mechanism'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('กีตาร์', 'the guitar'), category: 'instrument', discipline: 'art', secondary: ['science', 'math'],
    tags: ['music', 'strings'], facts: [
      { id: 'strings', value: p('6 สายในแบบมาตรฐาน', 'six strings in the standard tuning'), label: p('จำนวนสาย', 'string count'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA', unit: p('สาย', 'strings') },
      { id: 'families', value: p('อะคูสติกและไฟฟ้าเป็นสองสายหลัก', 'acoustic and electric are the two main families'), label: p('ประเภทหลัก', 'main families'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'pitch', value: p('ความยาวสายและแรงตึงกำหนดระดับเสียง', 'string length and tension set the pitch'), label: p('หลักฟิสิกส์ของเสียง', 'physics of pitch'), style: 'WHAT_IS', source: 'SCIENCE' },
    ],
  },
  {
    name: p('หน่วยนิวตัน (N)', 'the newton (N)'), category: 'siproduct', discipline: 'science', secondary: ['math', 'career'],
    tags: ['si-unit', 'force'], facts: [
      { id: 'measures', value: p('วัดแรง', 'measures force'), label: p('ปริมาณที่วัด', 'quantity measured'), style: 'WHAT_IS', source: 'CONVENTION' },
      { id: 'definition', value: p('1 N = กก.·ม./วินาที²', '1 N = kg·m/s²'), label: p('นิยามจากหน่วยฐาน', 'base-unit definition'), style: 'UNIT', source: 'CONVENTION' },
      { id: 'namesake', value: p('ตั้งชื่อตามเซอร์ไอแซก นิวตัน', 'named after Sir Isaac Newton'), label: p('ที่มาชื่อ', 'namesake'), style: 'WHAT_IS', source: 'CONVENTION' },
    ],
  },
  {
    name: p('หน่วยวัตต์ (W)', 'the watt (W)'), category: 'siproduct', discipline: 'science', secondary: ['math', 'econ'],
    tags: ['si-unit', 'power'], facts: [
      { id: 'measures', value: p('วัดกำลัง (อัตราการใช้พลังงาน)', 'measures power (energy per time)'), label: p('ปริมาณที่วัด', 'quantity measured'), style: 'WHAT_IS', source: 'CONVENTION' },
      { id: 'definition', value: p('1 W = 1 จูลต่อวินาที', '1 W = 1 joule per second'), label: p('นิยาม', 'definition'), style: 'UNIT', source: 'CONVENTION' },
      { id: 'namesake', value: p('ตั้งชื่อตามเจมส์ วัตต์', 'named after James Watt'), label: p('ที่มาชื่อ', 'namesake'), style: 'WHAT_IS', source: 'CONVENTION' },
    ],
  },
  {
    name: p('โซนยูโร', 'the eurozone'), category: 'currencyarea', discipline: 'econ', secondary: ['social', 'geography'],
    tags: ['currency', 'europe'], facts: [
      { id: 'members', value: p('20 ประเทศ (ณ ปี 2024)', '20 countries (as of 2024)'), label: p('จำนวนสมาชิก', 'member count'), style: 'WHAT_IS', source: 'UN', asOf: 2024, unit: p('ประเทศ', 'countries') },
      { id: 'policy', value: p('ธนาคารกลางยุโรปกำหนดนโยบายการเงินร่วม', 'the ECB sets shared monetary policy'), label: p('ผู้กำหนดนโยบาย', 'policy setter'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'launch', value: p('เงินเหรียญ-ธนบัตรวางจำหน่ายปี 2002', 'cash launched in 2002'), label: p('ปีเริ่มใช้เงินสด', 'cash launch year'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA', unit: p('', '') },
    ],
  },
  {
    name: p('กาแฟ', 'coffee'), category: 'plantcrop', discipline: 'econ', secondary: ['geography', 'health'],
    tags: ['commodity', 'agriculture'], facts: [
      { id: 'producers', value: p('บราซิลผลิตมากที่สุด', 'Brazil produces the most'), label: p('ผู้ผลิตอันดับหนึ่ง', 'top producer'), style: 'PRODUCES', source: 'UN', asOf: 2024 },
      { id: 'species', value: p('อาราบิกาและโรบัสตาเป็นสองสายหลัก', 'arabica and robusta are the two main species'), label: p('สายพันธุ์หลัก', 'main species'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
      { id: 'origin', value: p('มีต้นกำเนิดในเอธิโอเปีย', 'originated in Ethiopia'), label: p('ต้นกำเนิด', 'origin'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('ท่องเที่ยวเชิงเกษตร — ข้าว', 'rice'), category: 'plantcrop', discipline: 'econ', secondary: ['geography', 'social'],
    tags: ['commodity', 'agriculture'], facts: [
      { id: 'producers', value: p('จีนและอินเดียผลิตมากที่สุด', 'China and India lead production'), label: p('ผู้ผลิตอันดับต้น', 'top producers'), style: 'PRODUCES', source: 'UN', asOf: 2024 },
      { id: 'exports', value: p('อินเดียส่งออกมากที่สุด', 'India exports the most'), label: p('ผู้ส่งออกอันดับหนึ่ง', 'top exporter'), style: 'PRODUCES', source: 'UN', asOf: 2024 },
      { id: 'water', value: p('ปลูกแบบนาดำใช้น้ำมากที่สุดในพืชอาหารหลัก', 'paddy cultivation is the thirstiest staple system'), label: p('ลักษณะการปลูก', 'cultivation trait'), style: 'WHAT_IS', source: 'ENCYCLOPEDIA' },
    ],
  },
  {
    name: p('เบราว์เซอร์เอนจิน V8', 'the V8 engine'), category: 'browserengine', discipline: 'ict', secondary: ['career', 'math'],
    tags: ['javascript', 'runtime'], facts: [
      { id: 'developer', value: p('กูเกิลพัฒนา', 'developed by Google'), label: p('ผู้พัฒนา', 'developer'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'role', value: p('คอมไพล์จาวาสคริปต์เป็นโค้ดเครื่อง (JIT)', 'JIT-compiles JavaScript to machine code'), label: p('หน้าที่หลัก', 'main role'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'usage', value: p('ใช้ใน Chrome และ Node.js', 'powers Chrome and Node.js'), label: p('ที่ใช้งาน', 'used by'), style: 'WHAT_IS', source: 'DOC' },
    ],
  },
  {
    name: p('เบราว์เซอร์เอนจิน WebKit', 'the WebKit engine'), category: 'browserengine', discipline: 'ict', secondary: ['career', 'english'],
    tags: ['browser', 'apple'], facts: [
      { id: 'developer', value: p('แอปเปิลพัฒนา', 'developed by Apple'), label: p('ผู้พัฒนา', 'developer'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'usage', value: p('ใช้ใน Safari และเบราว์เซอร์ iOS ทุกตัวตามนโยบายแอปเปิล', 'powers Safari and, by policy, every iOS browser'), label: p('ที่ใช้งาน', 'used by'), style: 'WHAT_IS', source: 'DOC' },
      { id: 'fork', value: p('แยกตัวจาก KHTML ของโปรเจกต์ KDE', 'forked from KDE\'s KHTML'), label: p('ที่มา', 'origin'), style: 'WHAT_IS', source: 'DOC' },
    ],
  },
]);

/** Cross-category multi-hop chains for frontier-tier questions. */
export interface MultiHop {
  readonly id: string;
  readonly disciplines: readonly DisciplineId[]; // 3–4, ordered
  readonly prompt: Pair;
  readonly answer: Pair;
  readonly distractors: readonly Pair[];
  readonly explanation: Pair;
  readonly tags: readonly string[];
}

export const MULTI_HOPS: readonly MultiHop[] = Object.freeze([
  {
    id: 'mh-mars-soil-iron',
    disciplines: ['science', 'geography', 'math'],
    prompt: p(
      'สีแดงของดาวอังคารเกิดจากสารประกอบใด ซึ่งเป็นธาตุชนิดเดียวกับที่พบมากในตับสัตว์ (อาหารที่ช่วยป้องกันโลหิตจาง)',
      'Mars owes its red color to a compound of which element — the same element rich in liver, a food that prevents anemia?',
    ),
    answer: p('เหล็ก (สนิมเหล็ก/เหล็กออกไซด์)', 'iron (iron oxide / rust)'),
    distractors: [
      p('ทองแดง', 'copper'), p('อะลูมิเนียม', 'aluminium'), p('แคลเซียม', 'calcium'),
    ],
    explanation: p(
      'ดินของดาวอังคารมีเหล็กออกไซด์ และเหล็กเป็นองค์ประกอบของฮีโมโกลบินที่ขาดแล้วเกิดโลหิตจาง',
      'Martian soil is rich in iron oxide, and iron is the hemoglobin component whose deficiency causes anemia.',
    ),
    tags: ['mars', 'iron', 'nutrition'],
  },
  {
    id: 'mh-atmosphere-78-currency',
    disciplines: ['science', 'math', 'social'],
    prompt: p(
      'แก๊สที่คิดเป็นราว 78% ของชั้นบรรยากาศโลกคือธาตุใด และเลข 78 นี้เขียนเป็นเลขโรมันได้ว่าอะไร',
      'Which gas makes up about 78% of Earth\'s atmosphere, and how is 78 written in Roman numerals?',
    ),
    answer: p('ไนโตรเจน — LXXVIII', 'nitrogen — LXXVIII'),
    distractors: [
      p('ออกซิเจน — LXXVIII', 'oxygen — LXXVIII'),
      p('ไนโตรเจน — LXXVII', 'nitrogen — LXXVII'),
      p('คาร์บอนไดออกไซด์ — LXXVIII', 'carbon dioxide — LXXVIII'),
    ],
    explanation: p(
      'ไนโตรเจนคิดเป็น 78% ของอากาศ และ 78 = 50+10+10+5+1+1+1 = LXXVIII',
      'Nitrogen is ~78% of air, and 78 = LXXVIII in Roman numerals.',
    ),
    tags: ['nitrogen', 'roman-numerals'],
  },
  {
    id: 'mh-nile-roman',
    disciplines: ['geography', 'math', 'social'],
    prompt: p(
      'แม่น้ำที่ไหลจากใต้ขึ้นเหนือและปากอยู่ในอียิปต์คือสายใด และปีที่สนธิสัญญาเวอร์ซายลงนาม (1919) เขียนเลขโรมันอย่างถูกต้องได้ว่าอะไร',
      'Which south-to-north river empties in Egypt, and how is the year of the Treaty of Versailles (1919) written in Roman numerals?',
    ),
    answer: p('แม่น้ำไนล์ — MCMXIX', 'the Nile — MCMXIX'),
    distractors: [
      p('แม่น้ำคองโก — MCMXIX', 'the Congo — MCMXIX'),
      p('แม่น้ำไนล์ — MCMXVIII', 'the Nile — MCMXVIII'),
      p('แม่น้ำไนล์ — MMXIX', 'the Nile — MMXIX'),
    ],
    explanation: p(
      'ไนล์ไหลใต้ขึ้นเหนือลงเมดิเตอร์เรเนียนที่อียิปต์ และ 1919 = MCMXIX',
      'The Nile flows south to north into the Mediterranean at Egypt, and 1919 = MCMXIX.',
    ),
    tags: ['nile', 'roman-numerals'],
  },
  {
    id: 'mh-jupiter-moons-5th',
    disciplines: ['science', 'math', 'ict'],
    prompt: p(
      'ดาวเคราะห์ที่มีบริวารได้รับการรับรองมากที่สุดอันดับหนึ่ง (146 ดวง ปี 2024) อยู่ลำดับที่เท่าไรจากดวงอาทิตย์ และต้องใช้บิตอย่างน้อยกี่บิตจึงเข้ารหัสลำดับนั้นได้ (เลขลำดับเป็นเลขฐานสิบธรรมดา)',
      'The planet with the most confirmed moons (146 in 2024) is which position from the Sun, and how many bits are needed to encode that position number in binary?',
    ),
    answer: p('ดาวเสาร์ลำดับที่ 6 — ต้องใช้ 3 บิต', 'Saturn is 6th — 3 bits'),
    distractors: [
      p('ดาวพฤหัสบดีลำดับที่ 5 — ต้องใช้ 3 บิต', 'Jupiter is 5th — 3 bits'),
      p('ดาวเสาร์ลำดับที่ 6 — ต้องใช้ 6 บิต', 'Saturn is 6th — 6 bits'),
      p('ดาวเนปจูนลำดับที่ 8 — ต้องใช้ 4 บิต', 'Neptune is 8th — 4 bits'),
    ],
    explanation: p(
      'ดาวเสาร์มีบริวาร 146 ดวง (มากสุด ปี 2024) อยู่ลำดับ 6 ซึ่งเข้ารหัสด้วย 3 บิต (2³ = 8 ≥ 6)',
      'Saturn leads with 146 moons (2024), sits 6th from the Sun, and 6 fits in 3 bits (2³ = 8 ≥ 6).',
    ),
    tags: ['saturn', 'binary', 'solar-system'],
  },
  {
    id: 'mh-mitochondria-atp-organ',
    disciplines: ['science', 'health', 'philosophy'],
    prompt: p(
      'ออร์แกเนลล์ที่ฉายาว่า "โรงไฟฟ้าของเซลล์" ผลิตโมเลกุลพลังงานชนิดใด และอวัยวะที่สูบเลือดโมเลกุลนั้นไปเลี้ยงทั้งร่างกายมีกี่ห้อง',
      'Which energy molecule does the organelle nicknamed the "powerhouse of the cell" produce, and how many chambers has the organ that pumps it?',
    ),
    answer: p('ATP — หัวใจมี 4 ห้อง', 'ATP — the heart has 4 chambers'),
    distractors: [
      p('กลูโคส — หัวใจมี 4 ห้อง', 'glucose — the heart has 4 chambers'),
      p('ATP — หัวใจมี 2 ห้อง', 'ATP — the heart has 2 chambers'),
      p('NADH — ปอดมี 3 พู', 'NADH — the lungs have 3 lobes'),
    ],
    explanation: p(
      'ไมโทคอนเดรียผลิต ATP ด้วยการหายใจระดับเซลล์ และหัวใจมนุษย์มี 4 ห้อง',
      'Mitochondria produce ATP via cellular respiration, and the human heart has four chambers.',
    ),
    tags: ['mitochondria', 'atp', 'heart'],
  },
  {
    id: 'mh-mekong-countries-binary',
    disciplines: ['geography', 'ict', 'math'],
    prompt: p(
      'แม่น้ำที่ไหลผ่าน 6 ประเทศและออกสู่ทะเลในเวียดนามคือสายใด และต้องใช้บิตอย่างน้อยกี่บิตจึงเข้ารหัสจำนวนประเทศนั้นได้',
      'Which river flows through six countries and exits in Vietnam, and what is the minimum number of bits needed to encode that count?',
    ),
    answer: p('แม่น้ำโขง — 3 บิต', 'the Mekong — 3 bits'),
    distractors: [
      p('แม่น้ำโขง — 6 บิต', 'the Mekong — 6 bits'),
      p('แม่น้ำดานูบ — 3 บิต', 'the Danube — 3 bits'),
      p('แม่น้ำโขง — 2 บิต', 'the Mekong — 2 bits'),
    ],
    explanation: p(
      'โขงไหลผ่าน 6 ประเทศ และ 2² = 4 < 6 ≤ 8 = 2³ จึงต้องใช้ 3 บิต',
      'The Mekong crosses six countries, and 2² = 4 < 6 ≤ 8 = 2³, so 3 bits are needed.',
    ),
    tags: ['mekong', 'binary'],
  },
  {
    id: 'mh-silver-conductor-symbol',
    disciplines: ['science', 'ict', 'career'],
    prompt: p(
      'โลหะที่นำไฟฟ้าได้ดีที่สุดคือธาตุใด และสัญลักษณ์ธาตุนั้นมาจากชื่อละตินคำว่าอะไร',
      'Which metal is the best electrical conductor, and from which Latin word does its symbol derive?',
    ),
    answer: p('เงิน — สัญลักษณ์ Ag จาก argentum', 'silver — the symbol Ag comes from argentum'),
    distractors: [
      p('ทองแดง — สัญลักษณ์ Cu จาก cuprum', 'copper — the symbol Cu comes from cuprum'),
      p('เงิน — สัญลักษณ์ Si จาก silicium', 'silver — the symbol Si comes from silicium'),
      p('ทองคำ — สัญลักษณ์ Au จาก aurum', 'gold — the symbol Au comes from aurum'),
    ],
    explanation: p(
      'เงินนำไฟฟ้าดีที่สุดในบรรดาโลหะ และสัญลักษณ์ Ag มาจากชื่อละติน argentum',
      'Silver is the best metallic conductor, and its symbol Ag derives from Latin argentum.',
    ),
    tags: ['silver', 'conductivity', 'latin'],
  },
  {
    id: 'mh-danube-countries-siproduct',
    disciplines: ['geography', 'social', 'career'],
    prompt: p(
      'แม่น้ำสายใดไหลผ่านประเทศมากที่สุดในโลก (10 ประเทศ) และเมืองหลวงของประเทศต้นน้ำคือเมืองใด',
      'Which river crosses the most countries (ten), and what is the capital of its source country?',
    ),
    answer: p('แม่น้ำดานูบ — กรุงเบอร์ลิน', 'the Danube — Berlin'),
    distractors: [
      p('แม่น้ำดานูบ — กรุงเวียนนา', 'the Danube — Vienna'),
      p('แม่น้ำไรน์ — กรุงเบอร์ลิน', 'the Rhine — Berlin'),
      p('แม่น้ำดานูบ — กรุงปารีส', 'the Danube — Paris'),
    ],
    explanation: p(
      'ดานูบไหลผ่าน 10 ประเทศมากที่สุดในโลก และต้นน้ำอยู่ในเยอรมนีซึ่งมีเบอร์ลินเป็นเมืองหลวง',
      'The Danube crosses ten countries, and its source lies in Germany, whose capital is Berlin.',
    ),
    tags: ['danube', 'capitals'],
  },
  {
    id: 'mh-neptune-moons-binary',
    disciplines: ['science', 'math', 'philosophy'],
    prompt: p(
      'ดาวเคราะห์ที่ถูกค้นพบด้วยการคำนวณก่อนมองเห็นคือดาวใด และจำนวนบริวารที่ได้รับการรับรอง (ปี 2024) ของดาวนั้นเขียนเป็นเลขโรมันได้ว่าอะไร',
      'Which planet was found by mathematical prediction before observation, and how is its confirmed moon count (2024) written in Roman numerals?',
    ),
    answer: p('ดาวเนปจูน — XVI', 'Neptune — XVI'),
    distractors: [
      p('ดาวพลูโต — XVI', 'Pluto — XVI'),
      p('ดาวเนปจูน — XIV', 'Neptune — XIV'),
      p('ดาวยูเรนัส — XVI', 'Uranus — XVI'),
    ],
    explanation: p(
      'เนปจูนถูกคำนวณตำแหน่งไว้ก่อนพบจริง และมีบริวารรับรอง 16 ดวง = XVI (ปี 2024)',
      'Neptune was predicted mathematically first and has 16 confirmed moons = XVI (2024).',
    ),
    tags: ['neptune', 'roman-numerals'],
  },
]);

/** Core attributes every strong entity should provide. */
export const CORE_ATTRIBUTES: readonly string[] = Object.freeze(['capital', 'currency', 'officialLanguages', 'population']);

/** Number of entities with the strongest fact coverage. */
export const ENTITY_COUNT = ENTITIES.length;
