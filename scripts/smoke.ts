/* Quick sanity check of the pure engine against the bundled PURA rules.
   Run: npx tsx scripts/smoke.ts

   Prefix map (old 7-digit -> operator -> new prefix):
     QCell    3, 5              -> 83
     Comium   6, 84, 85, 86, 87 -> 86
     Africell 2, 7, 40, 41, 45  -> 87
   A longer prefix always wins (e.g. "87" -> Comium beats "7" -> Africell). */
import { BUNDLED_RULES } from '../src/modules/gnm/MigrationRules';
import { computePlan, previewNumber } from '../src/modules/gnm/GNMEngine';

const rules = BUNDLED_RULES;

const cases: [string, string | null][] = [
  ['6123456', '866123456'], // Comium prefix 6 -> 86
  ['8612345', '868612345'], // Comium prefix 86 -> 86
  ['8712345', '868712345'], // Comium "87" (2 chars) beats Africell "7" (1 char)
  ['3123456', '833123456'], // QCell prefix 3 -> 83
  ['5123456', '835123456'], // QCell prefix 5 -> 83
  ['2123456', '872123456'], // Africell prefix 2 -> 87
  ['7123456', '877123456'], // Africell prefix 7 -> 87
  ['4512345', '874512345'], // Africell prefix 45 -> 87
  ['9999999', null], // no rule matches
  ['+220 6123456', '866123456'], // country code stripped
  ['00220 3123456', '833123456'],
];

let fails = 0;
for (const [input, want] of cases) {
  const got = previewNumber(input, rules).result;
  const pass = got === want;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${input.padEnd(15)} -> ${String(got)}  (want ${String(want)})`);
}

const plan = computePlan(
  [
    { id: 'c1', name: 'Ada', phoneNumbers: [{ number: '6123456' }] }, // Ready
    { id: 'c2', name: 'Bem', phoneNumbers: [{ number: '6123456' }, { number: '866123456' }] }, // Duplicate Pair Found
    { id: 'c3', name: 'Cham', phoneNumbers: [{ number: '9999999' }] }, // Manual Review
    { id: 'c4', name: 'Dodou', phoneNumbers: [{ number: '12345' }] }, // 5 digits -> invalid, produces no candidate
  ],
  rules,
  'add',
);
console.log('plan.summary =', JSON.stringify(plan.summary));

const filtered = computePlan(
  [{ id: 'c1', name: 'Ada', phoneNumbers: [{ number: '3123456' }] }], // QCell
  rules,
  'add',
  ['COMIUM'],
);
console.log('QCell number with operatorFilter=[COMIUM] ->', filtered.candidates[0].status);

const good =
  fails === 0 &&
  plan.summary.ready === 1 &&
  plan.summary.alreadyUpdated === 1 && // the Duplicate Pair Found on c2
  plan.summary.review === 1 &&
  filtered.candidates[0].status === 'Skipped';

console.log(good ? '\nALL GOOD' : '\nPROBLEM');
process.exit(good ? 0 : 1);
