// 时间算法单测：在临时数据目录里直接加载协作模块，按指定的心跳序列算「和 Claude 一起干活的时间」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.DADI_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'wbtime-'));
const BR = await import('../brain-core.mjs');
test.after(() => fs.rmSync(process.env.DADI_DATA, { recursive: true, force: true }));
const day = '2026-01-05';
const put = (t, e) => { BR._test.beats().x = { days: { [day]: { t, s: [], e } }, last: null }; return BR._test.activeMin('x', day); };
test('说完一句话、Claude 连续干 40 分钟才答完（后台每分钟报一声在干活）：40 分钟都算', () => {
  const t = Array.from({ length: 41 }, (_, i) => i * 60); assert.equal(put(t, 'p' + 'w'.repeat(39) + 'o'), 41);   /* 起头 1 分＋40 分 */
});
test('说完一句话后没有任何信号（按 Esc 打断、或没装后台定时）：那一段最多算 20 分钟', () => {
  assert.equal(put([0, 3 * 3600], 'pp'), 1 + 20);
});
test('答完以后人走开 2 小时再回来：那 2 小时只算 1 分钟', () => {
  assert.equal(put([0, 300, 300 + 7200, 300 + 7500], 'popo'), 1 + 5 + 1 + 5);
});
test('旧数据没有种类记录：照旧按 10 分钟规则算', () => {
  assert.equal(put([0, 300, 300 + 3600], undefined), 1 + 5 + 1);
});
