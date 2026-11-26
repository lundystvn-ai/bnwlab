// Static QRIS → dynamic QRIS with a fixed amount (EMVCo TLV). The scanner shows the amount
// so the buyer only has to confirm. Same merchant, same account; only tags 01 and 54 change.
const crc16 = (s) => {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

export function parseTlv(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const tag = s.slice(i, i + 2), len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len)) throw new Error('Format QRIS tidak valid.');
    out.push({ tag, value: s.slice(i + 4, i + 4 + len) });
    i += 4 + len;
  }
  return out;
}

export function isValidQris(s) {
  try {
    const t = String(s || '').trim();
    if (!t.startsWith('000201') || !/6304[0-9A-F]{4}$/i.test(t)) return false;
    return crc16(t.slice(0, -4)) === t.slice(-4).toUpperCase() && parseTlv(t).some((x) => x.tag === '59');
  } catch { return false; }
}

export function merchantName(s) {
  try { return parseTlv(String(s).trim()).find((x) => x.tag === '59')?.value || ''; } catch { return ''; }
}

export function dynamicQris(staticPayload, amount) {
  const amt = String(Math.round(Number(amount)));
  if (!/^\d{1,13}$/.test(amt) || Number(amt) <= 0) throw new Error('Nominal tidak valid.');
  const fields = parseTlv(String(staticPayload).trim()).filter((f) => f.tag !== '63' && f.tag !== '54');
  const f01 = fields.find((f) => f.tag === '01');
  if (f01) f01.value = '12'; else fields.splice(1, 0, { tag: '01', value: '12' });
  const at = fields.findIndex((f) => Number(f.tag) > 54);
  fields.splice(at < 0 ? fields.length : at, 0, { tag: '54', value: amt });
  const body = fields.map((f) => f.tag + String(f.value.length).padStart(2, '0') + f.value).join('') + '6304';
  return body + crc16(body);
}
