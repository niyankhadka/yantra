/**
 * Every built-in language except English (which lives in ../i18n.js). Each module's
 * default export is its interface string table; its named export `LINT` holds the
 * translated validator messages (../lintmessages.js). The viewer bundle is built
 * without this module (vite.config.js); built files embed only the tables they need.
 */
import es, { LINT as esLint } from './es.js';
import fr, { LINT as frLint } from './fr.js';
import de, { LINT as deLint } from './de.js';
import pt, { LINT as ptLint } from './pt.js';
import it, { LINT as itLint } from './it.js';
import hi, { LINT as hiLint } from './hi.js';
import bn, { LINT as bnLint } from './bn.js';
import ne, { LINT as neLint } from './ne.js';
import zh, { LINT as zhLint } from './zh.js';
import zhHant, { LINT as zhHantLint } from './zh-Hant.js';
import ja, { LINT as jaLint } from './ja.js';
import ko, { LINT as koLint } from './ko.js';
import id, { LINT as idLint } from './id.js';
import ar, { LINT as arLint } from './ar.js';
import he, { LINT as heLint } from './he.js';
import fa, { LINT as faLint } from './fa.js';
import ur, { LINT as urLint } from './ur.js';

export const TABLES = { es, fr, de, pt, it, hi, bn, ne, zh, 'zh-Hant': zhHant, ja, ko, id, ar, he, fa, ur };

export const LINT_TABLES = {
  es: esLint,
  fr: frLint,
  de: deLint,
  pt: ptLint,
  it: itLint,
  hi: hiLint,
  bn: bnLint,
  ne: neLint,
  zh: zhLint,
  'zh-Hant': zhHantLint,
  ja: jaLint,
  ko: koLint,
  id: idLint,
  ar: arLint,
  he: heLint,
  fa: faLint,
  ur: urLint
};
