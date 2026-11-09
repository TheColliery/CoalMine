// Study q21 (scratchpad/29dx/study.md), the machine gate: the Stop hook decides fix mode from whether a user can answer, read from CLAUDE_CODE_SESSION_ATTENDED.
// Only the exact value "1" is attended. Attended: the attended mode text. Not attended ("0", absent, or any other value) with an effective mode of interactive or safe:
// the UNATTENDED text, report only. off keeps its text either way. The Antigravity branch sets no such variable and gets the unattended text. The conductor's
// rot-canary line follows the same rule. Hermetic spawn tests (hooks-safety section 7) on the real hook and conductor files, both surfaces, every language. The env is
// built from scratch, so a seat's own CLAUDE_CODE_SESSION_ATTENDED is never inherited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeTree } from './test-sandbox.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SURFACES = ['hooks', 'plugin/hooks'];
const LANGS = ['en', 'th', 'ja', 'zh', 'es'];
const MODES = ['interactive', 'safe'];

const SORT = {
  en: ` Sort each finding's file: THROWAWAY (made for one job: a probe, a scratch script, a one-off harness) or INSTRUMENT (still used or shipped); unsure means INSTRUMENT. Never fix a throwaway, and never delete one on your own.`,
  th: ` จัดไฟล์ของแต่ละปัญหาเป็น THROWAWAY (สร้างไว้ใช้งานครั้งเดียว: ไฟล์ทดลอง สคริปต์ชั่วคราว หรือ harness ใช้ครั้งเดียว) หรือ INSTRUMENT (ยังใช้งานอยู่หรือ ship จริง) ถ้าไม่แน่ใจให้ถือเป็น INSTRUMENT ห้ามแก้ไฟล์ THROWAWAY และห้ามลบเองโดยไม่ได้ถาม`,
  ja: `各問題のファイルを THROWAWAY（一度きりの作業用: プローブ、スクラッチスクリプト、使い捨てのハーネス）または INSTRUMENT（現在も使用中または出荷対象）に分類してください。判断がつかない場合は INSTRUMENT とします。THROWAWAY は修正せず、独断で削除もしないでください。`,
  zh: `将每个问题所在的文件归类为 THROWAWAY（为一次性任务而写：探针、临时脚本、一次性测试工具）或 INSTRUMENT（仍在使用或会发布）；不确定时按 INSTRUMENT 处理。不要修复 THROWAWAY，也不要自行删除它。`,
  es: ` Clasifique el archivo de cada hallazgo como THROWAWAY (hecho para una sola tarea: una sonda, un script temporal, un arnés de un solo uso) o INSTRUMENT (aún en uso o publicado); si hay duda, es INSTRUMENT. Nunca corrija un THROWAWAY ni lo borre por su cuenta.`,
};
// The attended texts: a user can answer, so the mode text may ask for the menu or the gate.
const ATT = {
  en: {
    interactive: ` autoFixMode is interactive: end by offering the fix menu for instruments and a cleanup choice for each throwaway through your question tool; never fix without a chosen option.`,
    safe: ` autoFixMode is safe: apply safe instrument fixes without a menu; offer unsafe ones and each throwaway cleanup via your question tool.`,
  },
  th: {
    interactive: ` autoFixMode เป็น interactive: ให้จบด้วยการเสนอเมนูแก้ไขสำหรับ INSTRUMENT และตัวเลือกการเก็บกวาดสำหรับแต่ละ THROWAWAY ผ่านเครื่องมือคำถาม ห้ามแก้โดยไม่มีตัวเลือกที่ถูกเลือก`,
    safe: ` autoFixMode เป็น safe: แก้จุดที่แก้ได้อย่างปลอดภัยใน INSTRUMENT ได้เลยโดยไม่ต้องแสดงเมนู แล้วเสนอจุดที่ไม่ปลอดภัยและตัวเลือกการเก็บกวาดสำหรับแต่ละ THROWAWAY ผ่านเครื่องมือคำถาม`,
  },
  ja: {
    interactive: `autoFixMode は interactive: INSTRUMENT の修正メニューと各 THROWAWAY の後片付けの選択肢を質問ツールで提示して終了 — 選択なしの修正は禁止。`,
    safe: `autoFixMode は safe: INSTRUMENT の安全な修正はメニューなしで適用し、安全でない修正と各 THROWAWAY の後片付けの選択肢を質問ツールで提示してください。`,
  },
  zh: {
    interactive: `autoFixMode 为 interactive：最后用问题工具为 INSTRUMENT 提供修复菜单，并为每个 THROWAWAY 提供清理选项 — 未经选择不得修改。`,
    safe: `autoFixMode 为 safe：对 INSTRUMENT 直接应用安全修复，无需菜单；用问题工具提供不安全的修复和每个 THROWAWAY 的清理选项。`,
  },
  es: {
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
// off keeps its own text whether or not a user is present.
const OFF = {
  en: ` autoFixMode is off: report only, with no fixes and no offers.`,
  th: ` autoFixMode เป็น off: รายงานอย่างเดียว ไม่แก้และไม่เสนอตัวเลือก`,
  ja: `autoFixMode は off: 報告のみで、修正も提案もしません。`,
  zh: `autoFixMode 为 off：只报告，不修复，也不提供选项。`,
  es: ` autoFixMode es off: solo informe, sin correcciones ni ofertas.`,
};
const ROT_OFFER = 'offer the fix menu if a user is present).';
const ROT_REPORT = 'report only: no user can answer this session).';

// The env is built from scratch: a seat's own value never reaches the hook. `attended` undefined = the variable is absent.
function hookEnv(home, attended) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: home, TMP: home, TMPDIR: home, USERPROFILE: home, HOME: home };
  if (attended !== undefined) env.CLAUDE_CODE_SESSION_ATTENDED = attended;
  return env;
}

function fixture(t, { mode, lang }) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'cm-attended-'));
  t.after(() => removeTree(root));
  const home = path.join(root, 'home');
  const proj = path.join(root, 'proj');
  fs.mkdirSync(path.join(home, 'coalmine'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', '.coalmine.json'), JSON.stringify({ autoFixMode: mode, language: lang }));
  const edited = path.join(proj, 'edited.js');
  fs.writeFileSync(edited, 'x\n');
  fs.writeFileSync(path.join(home, 'coalmine', 'rot-canary-AT1.touched'), `${edited}\n`);
  return { home, proj };
}

// Runs the real Stop hook. `event` set = the Antigravity branch (its argv carries an event name); it answers decision "continue", the Claude Code branch "block".
function stopReason(surface, { mode, lang, attended, event }, t) {
  const { home, proj } = fixture(t, { mode, lang });
  const args = ['--max-old-space-size=512', path.join(repo, surface, 'rot-canary-stop.js')];
  if (event) args.push(event);
  const input = JSON.stringify({ session_id: 'AT1', cwd: proj, stop_hook_active: false });
  const r = spawnSync(process.execPath, args, { cwd: proj, input, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: hookEnv(home, attended) });
  assert.equal(r.status, 0, `stop: exit 0 (${r.stderr.slice(0, 200)})`);
  assert.equal(r.stderr, '', 'stop: no stderr');
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, event ? 'continue' : 'block', 'stop: the decision names the branch');
  return out.reason;
}

// Runs the real conductor (SessionStart) and returns its plain-text context.
function conductorText(surface, attended, t) {
  const { home, proj } = fixture(t, { mode: 'interactive', lang: 'en' });
  const r = spawnSync(process.execPath, [path.join(repo, surface, 'coalmine-conductor.js')], { cwd: proj, input: '', encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', env: hookEnv(home, attended) });
  assert.equal(r.status, 0, `conductor: exit 0 (${r.stderr.slice(0, 200)})`);
  assert.equal(r.stderr, '', 'conductor: no stderr');
  return r.stdout;
}

// Attendance cases: "1" is the only attended value. Every other value, and an absent variable, reads as not attended.
const ATTENDED_CASES = [['1', true], ['0', false], [undefined, false]];

for (const surface of SURFACES) {
  for (const lang of LANGS) {
    for (const mode of MODES) {
      for (const [attended, isAttended] of ATTENDED_CASES) {
        const label = attended === undefined ? 'absent' : `ATTENDED=${attended}`;
        test(`${surface} stop: ${lang} ${mode}, ${label}: ${isAttended ? 'the attended text' : 'the unattended text, report only'}`, (t) => {
          const reason = stopReason(surface, { mode, lang, attended }, t);
          assert.ok(reason.includes(SORT[lang]), 'the sort sentence is always present');
          if (isAttended) {
            assert.ok(reason.includes(ATT[lang][mode]), `${lang} ${mode} attended sentence`);
            assert.ok(!reason.includes(UNA[lang]), 'an attended session is not told report only');
          } else {
            assert.ok(reason.includes(UNA[lang]), `${lang} unattended sentence`);
            assert.ok(!reason.includes(ATT[lang][mode]), 'an unattended session is never told to apply or offer');
          }
        });
      }
    }
    test(`${surface} stop: ${lang} off keeps its text, attended or not`, (t) => {
      for (const attended of ['1', '0']) {
        const reason = stopReason(surface, { mode: 'off', lang, attended }, t);
        assert.ok(reason.includes(OFF[lang]), `off text under ATTENDED=${attended}`);
        assert.ok(!reason.includes(UNA[lang]), 'off is not rewritten as unattended');
      }
    });
  }
  test(`${surface} stop: only the exact "1" is attended (true, " 1" and "01" are not)`, (t) => {
    for (const attended of ['true', ' 1', '01']) {
      const reason = stopReason(surface, { mode: 'safe', lang: 'en', attended }, t);
      assert.ok(reason.includes(UNA.en), `ATTENDED=${JSON.stringify(attended)} reads as not attended`);
    }
  });
  test(`${surface} stop, Antigravity branch: attended "1" still gets the unattended text (AG sets no such variable)`, (t) => {
    const reason = stopReason(surface, { mode: 'safe', lang: 'en', attended: '1', event: 'stop' }, t);
    assert.ok(reason.includes(UNA.en), 'the AG branch is never attended');
    assert.ok(!reason.includes(ATT.en.safe), 'the AG branch is never told to apply');
  });
  for (const [attended, isAttended] of [['1', true], ['0', false], [undefined, false]]) {
    const label = attended === undefined ? 'absent' : `ATTENDED=${attended}`;
    test(`${surface} conductor: ${label}: the rot-canary line ${isAttended ? 'offers the fix menu' : 'says report only'}`, (t) => {
      const text = conductorText(surface, attended, t);
      if (isAttended) {
        assert.ok(text.includes(ROT_OFFER), 'the attended line keeps the menu offer');
        assert.ok(!text.includes(ROT_REPORT), 'the attended line does not say report only');
      } else {
        assert.ok(text.includes(ROT_REPORT), 'the unattended line says report only');
        assert.ok(!text.includes(ROT_OFFER), 'the unattended line does not offer a menu');
      }
    });
  }
}
