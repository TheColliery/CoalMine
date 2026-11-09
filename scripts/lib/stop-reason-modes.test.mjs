// UMB3-195 (the owner's two-condition rule, sheet card): the rot-canary Stop report's fix clause follows the EFFECTIVE autoFixMode, the value the config merge already clamped
// (autoFixNote), and tells the agent to sort each finding's file THROWAWAY or INSTRUMENT before anything is fixed or offered. The old clause always demanded the fix menu, so a
// `safe` or `off` user still read "offer the fix menu". Hermetic spawn tests (hooks-safety section 7) on the real Stop hook, both the source and the built plugin copy: the
// effective mode and the language are set in a throwaway HOME and project, and the test reads the block `reason` the hook emits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SURFACES = ['hooks', 'plugin/hooks'];
const LANGS = ['en', 'th', 'ja', 'zh', 'es'];
const MODES = ['off', 'interactive', 'safe'];
const LINE = /^(?:- )?\[CoalMine\] autoFixMode in effect: (\w+) \((.*)\)$/m;

// The house's sentences, per language. The English ones are the ones skills/rot-canary/SKILL.md carries word for word.
const SORT = {
  en: ` Sort each finding's file: THROWAWAY (made for one job: a probe, a scratch script, a one-off harness) or INSTRUMENT (still used or shipped); unsure means INSTRUMENT. Never fix a throwaway, and never delete one on your own.`,
  th: ` จัดไฟล์ของแต่ละปัญหาเป็น THROWAWAY (สร้างไว้ใช้งานครั้งเดียว: ไฟล์ทดลอง สคริปต์ชั่วคราว หรือ harness ใช้ครั้งเดียว) หรือ INSTRUMENT (ยังใช้งานอยู่หรือ ship จริง) ถ้าไม่แน่ใจให้ถือเป็น INSTRUMENT ห้ามแก้ไฟล์ THROWAWAY และห้ามลบเองโดยไม่ได้ถาม`,
  ja: `各問題のファイルを THROWAWAY（一度きりの作業用: プローブ、スクラッチスクリプト、使い捨てのハーネス）または INSTRUMENT（現在も使用中または出荷対象）に分類してください。判断がつかない場合は INSTRUMENT とします。THROWAWAY は修正せず、独断で削除もしないでください。`,
  zh: `将每个问题所在的文件归类为 THROWAWAY（为一次性任务而写：探针、临时脚本、一次性测试工具）或 INSTRUMENT（仍在使用或会发布）；不确定时按 INSTRUMENT 处理。不要修复 THROWAWAY，也不要自行删除它。`,
  es: ` Clasifique el archivo de cada hallazgo como THROWAWAY (hecho para una sola tarea: una sonda, un script temporal, un arnés de un solo uso) o INSTRUMENT (aún en uso o publicado); si hay duda, es INSTRUMENT. Nunca corrija un THROWAWAY ni lo borre por su cuenta.`,
};
// The attended texts: a user can answer, so the mode text may ask for the menu or the gate.
const MODE = {
  en: {
    off: ` autoFixMode is off: report only, with no fixes and no offers.`,
    interactive: ` autoFixMode is interactive: end by offering the fix menu for instruments and a cleanup choice for each throwaway through your question tool; never fix without a chosen option.`,
    safe: ` autoFixMode is safe: apply safe instrument fixes without a menu; offer unsafe ones and each throwaway cleanup via your question tool.`,
  },
  th: {
    off: ` autoFixMode เป็น off: รายงานอย่างเดียว ไม่แก้และไม่เสนอตัวเลือก`,
    interactive: ` autoFixMode เป็น interactive: ให้จบด้วยการเสนอเมนูแก้ไขสำหรับ INSTRUMENT และตัวเลือกการเก็บกวาดสำหรับแต่ละ THROWAWAY ผ่านเครื่องมือคำถาม ห้ามแก้โดยไม่มีตัวเลือกที่ถูกเลือก`,
    safe: ` autoFixMode เป็น safe: แก้จุดที่แก้ได้อย่างปลอดภัยใน INSTRUMENT ได้เลยโดยไม่ต้องแสดงเมนู แล้วเสนอจุดที่ไม่ปลอดภัยและตัวเลือกการเก็บกวาดสำหรับแต่ละ THROWAWAY ผ่านเครื่องมือคำถาม`,
  },
  ja: {
    off: `autoFixMode は off: 報告のみで、修正も提案もしません。`,
    interactive: `autoFixMode は interactive: INSTRUMENT の修正メニューと各 THROWAWAY の後片付けの選択肢を質問ツールで提示して終了 — 選択なしの修正は禁止。`,
    safe: `autoFixMode は safe: INSTRUMENT の安全な修正はメニューなしで適用し、安全でない修正と各 THROWAWAY の後片付けの選択肢を質問ツールで提示してください。`,
  },
  zh: {
    off: `autoFixMode 为 off：只报告，不修复，也不提供选项。`,
    interactive: `autoFixMode 为 interactive：最后用问题工具为 INSTRUMENT 提供修复菜单，并为每个 THROWAWAY 提供清理选项 — 未经选择不得修改。`,
    safe: `autoFixMode 为 safe：对 INSTRUMENT 直接应用安全修复，无需菜单；用问题工具提供不安全的修复和每个 THROWAWAY 的清理选项。`,
  },
  es: {
    off: ` autoFixMode es off: solo informe, sin correcciones ni ofertas.`,
    interactive: ` autoFixMode es interactive: termine ofreciendo con su herramienta de preguntas el menú de correcciones para los INSTRUMENT y una opción de limpieza para cada THROWAWAY; nunca corrija sin una opción elegida.`,
    safe: ` autoFixMode es safe: aplique sin menú las correcciones seguras a los INSTRUMENT y ofrezca con su herramienta de preguntas las correcciones no seguras y una opción de limpieza para cada THROWAWAY.`,
  },
};
// The unattended text: no user can answer, so report only, whatever the mode says.
const UNA = {
  en: ` No user can answer this session, so report only, with no fixes and no offers, whatever autoFixMode says.`,
  th: ` เซสชันนี้ไม่มีผู้ใช้ตอบคำถามได้ จึงรายงานอย่างเดียว ไม่แก้และไม่เสนอตัวเลือก ไม่ว่า autoFixMode จะเป็นค่าใด`,
  ja: `このセッションには回答できるユーザーがいないため、autoFixMode の値にかかわらず報告のみで、修正も提案もしません。`,
  zh: `本会话没有能回答的用户，因此无论 autoFixMode 为何值，都只报告，不修复，也不提供选项。`,
  es: ` Ningún usuario puede responder en esta sesión, así que solo informe, sin correcciones ni ofertas, sea cual sea autoFixMode.`,
};
// The clause the old hook wrote at the end of each language's reason. None of it may survive.
const OLD = {
  en: ` If findings exist and a user is present, end by offering the fix menu via your question tool — never fix without a chosen option.`,
  th: ` หากพบปัญหาและผู้ใช้อยู่ในเซสชัน ให้จบด้วยการเสนอเมนูแก้ไขผ่านเครื่องมือคำถาม — ห้ามแก้โดยไม่มีตัวเลือกที่ถูกเลือก`,
  ja: `問題がありユーザーが在席なら、質問ツールで修正メニューを提示して終了 — 選択なしの修正は禁止。`,
  zh: `若有问题且用户在场，最后用问题工具提供修复菜单 — 未经选择不得修改。`,
  es: ` Si hay hallazgos y el usuario está presente, termine ofreciendo el menú de correcciones — nunca corrija sin una opción elegida.`,
};

function fixture(t, { global, project }) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-stopmodes-'));
  t.after(() => removeTree(root));
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  // LOAD-BEARING: the env below points TEMP, TMP and TMPDIR at `home`, so the hook's marker folder (os.tmpdir() + 'coalmine') is `home/coalmine`, and
  // the `rot-canary-<sid>.touched` fixture file must sit there. ensureMarkerDir refuses that folder unless this user owns it and it carries no group or
  // other write bit (mode & 0o022), so it is created here with 0o700 before the hook runs.
  fs.mkdirSync(path.join(home, 'coalmine'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  if (global !== undefined) fs.writeFileSync(path.join(home, '.claude', '.coalmine.json'), JSON.stringify(global));
  if (project !== undefined) {
    fs.mkdirSync(path.join(proj, '.claude', 'coal'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude', 'coal', 'coalmine.json'), JSON.stringify(project));
  }
  return { home, proj };
}

// Runs the real Stop hook on one touched file and returns the block reason it emits.
// CLAUDE_CODE_SESSION_ATTENDED is set explicitly in every leg ("1" by default, the attended texts). The env is built from scratch, so a seat's own value never reaches the hook.
function stopReason(surface, cfgs, t, attended = '1') {
  const f = fixture(t, cfgs);
  const edited = path.join(f.proj, 'edited.js');
  fs.writeFileSync(edited, 'x\n');
  fs.writeFileSync(path.join(f.home, 'coalmine', 'rot-canary-SM1.touched'), `${edited}\n`);
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: f.home, TMP: f.home, TMPDIR: f.home, USERPROFILE: f.home, HOME: f.home, CLAUDE_CODE_SESSION_ATTENDED: attended };
  const input = JSON.stringify({ session_id: 'SM1', cwd: f.proj, stop_hook_active: false });
  const script = path.join(repo, surface, 'rot-canary-stop.js');
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', script], { cwd: f.proj, input, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env });
  assert.equal(r.status, 0, `stop: exit 0 (${r.stderr.slice(0, 200)})`);
  assert.equal(r.stderr, '', 'stop: no stderr');
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block', 'stop: the scan report is a block with a reason');
  return { reason: out.reason, line: LINE.exec(out.reason) };
}

for (const surface of SURFACES) {
  for (const lang of LANGS) {
    for (const mode of MODES) {
      test(`${surface} stop: ${lang} with autoFixMode ${mode} carries the sort and only its own mode sentence`, (t) => {
        const { reason } = stopReason(surface, { global: { autoFixMode: mode }, project: { language: lang } }, t);
        assert.ok(reason.includes(SORT[lang]), `the ${lang} sort sentence is present`);
        assert.ok(reason.includes(MODE[lang][mode]), `the ${lang} "${mode}" sentence is present`);
        for (const other of MODES) {
          if (other === mode) continue;
          assert.ok(!reason.includes(MODE[lang][other]), `the ${lang} "${other}" sentence is absent under ${mode}`);
        }
        assert.ok(!reason.includes(OLD[lang]), `the old ${lang} clause is gone`);
      });
    }
  }

  test(`${surface} stop: no config reads as interactive and carries no autoFixMode line`, (t) => {
    const { reason, line } = stopReason(surface, { project: { language: 'en' } }, t);
    assert.ok(reason.includes(MODE.en.interactive), 'the factory default is interactive');
    assert.ok(!reason.includes(MODE.en.safe) && !reason.includes(MODE.en.off), 'no other mode sentence');
    assert.equal(line, null, 'no config sets the key, so no autoFixMode line');
  });

  test(`${surface} stop: a project "safe" with no global is lowered to interactive (the clamp)`, (t) => {
    const { reason, line } = stopReason(surface, { project: { language: 'en', autoFixMode: 'safe' } }, t);
    assert.ok(reason.includes(MODE.en.interactive), 'the clamped mode is interactive');
    assert.ok(!reason.includes(MODE.en.safe), 'the project "safe" is not the mode the agent is told');
    assert.ok(line && line[1] === 'interactive' && /lowered/.test(line[2]), `the emitted line names the lowered mode (${line && line[0]})`);
  });
}

// fixClause is not exported: a hook is a script, and hooks-safety section 7 forbids extracting its logic into an importable function. So these legs evaluate the
// shipped text of FIX_SORT, FIX_MODE and fixClause in a bare context. SAFER_ENUM is stubbed to its default, and the stub is pinned to the hook's own line.
function loadFixClause() {
  const src = fs.readFileSync(path.join(repo, 'hooks', 'rot-canary-stop.js'), 'utf8');
  const start = src.indexOf('const FIX_SORT = {');
  const fnAt = src.indexOf('function fixClause(');
  assert.ok(start >= 0 && fnAt > start, 'the hook still defines FIX_SORT and fixClause');
  const end = src.indexOf('\n}\n', fnAt) + 3;
  assert.ok(src.includes("autoFixMode: { order: ['off', 'interactive', 'safe'], default: 'interactive' }"), 'SAFER_ENUM.autoFixMode default is interactive');
  const ctx = vm.createContext({ SAFER_ENUM: { autoFixMode: { order: ['off', 'interactive', 'safe'], default: 'interactive' } } });
  return vm.runInContext(`${src.slice(start, end)}\nfixClause;`, ctx);
}

test('fixClause: the loaded text is the shipped one (a known language, every mode)', () => {
  const fixClause = loadFixClause();
  for (const mode of MODES) {
    assert.equal(fixClause('th', mode, true), SORT.th + MODE.th[mode], `th ${mode} attended`);
  }
});

test('fixClause: an unknown language falls back to the English sort and mode text, and never throws', () => {
  const fixClause = loadFixClause();
  for (const lang of ['xx', 'constructor']) {
    let text;
    assert.doesNotThrow(() => { text = fixClause(lang, 'interactive', true); }, `lang "${lang}" does not throw`);
    assert.equal(text, SORT.en + MODE.en.interactive, `lang "${lang}" reads as English`);
  }
});

// The English sentences are the house's wording, and the skill carries the same wording: whitespace collapsed, a match is a word-for-word match.
const norm = (s) => s.replace(/\s+/g, ' ').trim();
for (const skill of ['skills/rot-canary/SKILL.md', 'plugin/skills/rot-canary/SKILL.md']) {
  test(`${skill} carries the English sort and the three English mode sentences word for word`, () => {
    const text = norm(fs.readFileSync(path.join(repo, skill), 'utf8'));
    for (const sentence of [SORT.en, MODE.en.off, MODE.en.interactive, MODE.en.safe, UNA.en]) {
      assert.ok(text.includes(norm(sentence)), `${skill} carries: ${norm(sentence).slice(0, 60)}...`);
    }
  });
}
