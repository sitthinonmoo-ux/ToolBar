const { listTweaks, applyTweaks, checkStatus } = require('../../src/regTweaks');

const TWEAK_INFO = new Map(listTweaks().map((t) => [t.key, t]));

function dryRun(params) {
  const selected = (params && params.tweaks) || [];
  if (selected.length === 0) {
    return { items: [], totalSizeBytes: 0, warnings: ['เลือกอย่างน้อย 1 รายการก่อน'], blocked: true };
  }
  const items = selected
    .map((key) => TWEAK_INFO.get(key))
    .filter(Boolean)
    .map((t) => ({
      path: t.admin ? 'HKLM (ต้องสิทธิ์ Administrator)' : 'HKCU',
      sizeBytes: 0,
      action: t.name.th,
    }));
  const warnings = [];
  if (selected.some((k) => TWEAK_INFO.get(k) && TWEAK_INFO.get(k).admin)) {
    warnings.push('มีรายการที่ต้องแก้ค่าระดับเครื่อง (HKLM) — จะมีหน้าต่างขอสิทธิ์ Administrator (UAC) เด้งขึ้นมาให้กดยืนยัน');
    warnings.push('จะสร้าง System Restore Point ให้ก่อนแก้อัตโนมัติ — ถ้าอยากย้อนกลับทั้งหมดทีเดียว ใช้ System Restore ได้ (ข้ามถ้าปิดอยู่ หรือสร้างไปแล้วในช่วง 24 ชม.)');
  }
  // Named up front rather than only in the result, so the restart isn't a surprise after
  // the fact — these are the items whose value lands immediately but stays inert until
  // the machine (or the driver/session that reads it at load) comes back up.
  const restartItems = selected
    .map((key) => TWEAK_INFO.get(key))
    .filter((t) => t && t.needsRestart)
    .map((t) => t.name.th);
  if (restartItems.length) {
    warnings.push(`ต้อง restart เครื่องก่อนถึงจะมีผลจริง ${restartItems.length} รายการ: ${restartItems.join(', ')}`);
  }
  // Surface each risky tweak's specific trade-off so the user sees it before confirming,
  // not after — these are opinionated changes with a real downside, not free wins.
  for (const key of selected) {
    const info = TWEAK_INFO.get(key);
    if (info && info.risk) warnings.push(`⚠ ${info.name.th}: ${info.risk.th}`);
  }
  return { items, totalSizeBytes: 0, warnings, blocked: false };
}

async function run(params, ctx) {
  const selected = (params && params.tweaks) || [];
  return applyTweaks(selected, ctx && ctx.onProgress);
}

module.exports = { dryRun, run, checkStatus };
