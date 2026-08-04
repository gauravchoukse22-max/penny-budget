// Fixture harness for lib/merchant-token.ts — the normaliser that turns a card
// statement description into the keyword a learned category rule is hung on.
// Same shape as test-over-assign.mjs: no test runner, just Node importing the
// REAL source through the type-stripping loader. Run it with:
//
//   node scripts/test-merchant-token.mjs
//
// The invariant that matters most is the substring one. Rules are matched with
// `note.toLowerCase().includes(keyword)`, so a token that is not literally
// present in the note produces a rule that silently never fires — it looks
// saved and does nothing. Every fixture below is checked for it automatically.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transform } from './lib/strip-types.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// merchant-token.ts imports nothing — nothing to stub.
const { merchantToken, merchantRuleId } = await import(await transform(join(root, 'lib/merchant-token.ts'), []));

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, label) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}`);
  }
}

/**
 * Assert the token, and — for every non-null token — the substring invariant.
 * Checking it here rather than in a separate block means no fixture can be
 * added that quietly violates it.
 */
function token(note, expected, label) {
  const actual = merchantToken(note);
  if (actual === expected) passed++;
  else {
    failed++;
    failures.push(`✗ ${label}\n    note:     ${JSON.stringify(note)}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
  if (actual !== null) {
    ok(
      note.toLowerCase().includes(actual),
      `token ${JSON.stringify(actual)} is a substring of ${JSON.stringify(note)} (a rule that isn't would never match)`
    );
  }
}

// ── the plain case ─────────────────────────────────────────────────────────
token('STARBUCKS', 'starbucks', 'a bare merchant name is just lowercased');
token('  Whole Foods  ', 'whole foods', 'surrounding whitespace is trimmed');
token('NETFLIX.COM', 'netflix.com', 'a domain survives intact');

// ── trailing store numbers ─────────────────────────────────────────────────
token('STARBUCKS #04127', 'starbucks', 'a #store number is cut');
token('SAFEWAY 1234', 'safeway', 'a bare store number is cut');
token('WHOLEFDS MKT 10250', 'wholefds mkt', 'the two-word name survives its store number');
token('SHELL OIL 57443210', 'shell oil', 'a long pump id is cut');

// ── dates ──────────────────────────────────────────────────────────────────
token('CHIPOTLE 08/01', 'chipotle', 'a trailing mm/dd is cut');
token('CHIPOTLE 08/01/26', 'chipotle', 'a trailing mm/dd/yy is cut');
token('08/01 CHIPOTLE ONLINE', 'chipotle online', 'a LEADING posting date is stripped, name kept');
token('2026-08-01 TRADER JOES', 'trader joes', 'an ISO leading date is stripped');
token('PURCHASE AUTHORIZED ON 08/01 PEETS COFFEE', 'peets coffee', "Wells Fargo's authorized-on preamble is stripped");
token('AMAZON AUG 04', 'amazon', 'a month word after the name is noise');
token('AUGUST MOON CAFE', 'august moon cafe', 'a month-like word IN the name is kept');

// ── reference ids ──────────────────────────────────────────────────────────
token('AMZN Mktp US*2H4DG5X1', 'amzn mktp us', 'an alphanumeric ref id after * is cut');
token('SPOTIFY REF 88213', 'spotify', 'a REF marker and its number are cut');
token('DOORDASH*ORDER XXXXXX1234', 'doordash*order', 'a masked card fragment is cut');
token('LYFT   RIDE   TRACE 9981', 'lyft   ride', 'a TRACE marker is cut (and the odd spacing is preserved, not collapsed)');

// ── processor prefixes ─────────────────────────────────────────────────────
token('SQ *BLUE BOTTLE COFFEE', 'blue bottle coffee', 'the Square prefix is stripped');
token('TST* PIZZERIA DELFINA', 'pizzeria delfina', 'the Toast prefix is stripped');
token('PAYPAL *STEAM GAMES', 'steam games', 'the PayPal prefix is stripped');
token('POS DEBIT SQ *ACME BAKERY', 'acme bakery', 'stacked prefixes are all peeled');
token('CHECKCARD 0801 UNITED AIRLINES', 'united airlines', 'a checkcard preamble is stripped');
token('UBER *TRIP', 'uber *trip', 'UBER is a merchant, not a processor prefix — its name is kept');

// ── names that look like noise but are not ─────────────────────────────────
token('7-ELEVEN 22193', '7-eleven', 'a digit inside the name does not end it');
token("TRADER JOE'S #182", "trader joe's", 'an apostrophe is preserved (removing it would break the match)');
token('H-E-B GROCERY', 'h-e-b grocery', 'hyphens inside the name survive');

// ── too generic to learn from ──────────────────────────────────────────────
token('PAYMENT THANK YOU', null, 'a card payment teaches nothing');
token('AUTOPAY 08/01', null, 'an autopay line teaches nothing');
token('ONLINE PAYMENT', null, 'a generic online payment teaches nothing');
token('PAYMENT - THANK YOU VISA', null, 'a payment line with trailing words is still refused');
token('INTEREST CHARGED', null, 'interest is refused');
token('ATM', null, 'ATM alone is refused');

// ── nothing to work with ───────────────────────────────────────────────────
token('', null, 'an empty note yields no token');
token('   ', null, 'whitespace alone yields no token');
token('#4412', null, 'a bare store number alone yields no token');
token('123456', null, 'a bare number alone yields no token');
token('XY', null, 'a two-character name is too short to be a rule');

// ── word cap ───────────────────────────────────────────────────────────────
token(
  'THE VERY LONG MERCHANT NAME THAT KEEPS GOING',
  'the very long merchant',
  'the token stops after four words rather than swallowing an address line'
);

// ── derived ids ────────────────────────────────────────────────────────────
ok(merchantRuleId('starbucks') === 'rule-starbucks', 'a simple token gets a simple id');
ok(
  merchantRuleId('blue bottle coffee') === 'rule-blue-bottle-coffee',
  'spaces become hyphens'
);
ok(merchantRuleId("trader joe's") === 'rule-trader-joe-s', 'punctuation becomes hyphens');
ok(merchantRuleId('amzn mktp us') === merchantRuleId('AMZN MKTP US'), 'the id is case-insensitive');
ok(!/^rule--|--$/.test(merchantRuleId('*acme*')), 'leading and trailing hyphens are trimmed');

// Two devices must derive the SAME id for the same merchant, or one keyword
// becomes two rows on sync. This is the whole reason the id is not a uuid.
ok(
  merchantRuleId(merchantToken('STARBUCKS #04127')) === merchantRuleId(merchantToken('Starbucks #98221')),
  'two branches of one merchant derive one shared rule id'
);

// ── report ─────────────────────────────────────────────────────────────────
if (failures.length > 0) console.error(failures.join('\n\n'));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
