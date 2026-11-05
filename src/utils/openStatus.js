const computeOpenStatus = (outlet, at = new Date()) => {
  const day = at.getDay();
  const currentTime = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const today = (outlet.operatingHours || []).find((h) => h.day === day);
  if (!today || today.isOpen === false) {
    let nextOpensAt = null;
    for (let i = 1; i <= 7; i++) {
      const nextDay = (day + i) % 7;
      const next = (outlet.operatingHours || []).find((h) => h.day === nextDay && h.isOpen !== false && h.opensAt);
      if (next) {
        const d = new Date(at);
        d.setDate(d.getDate() + i);
        const [hh, mm] = next.opensAt.split(':');
        d.setHours(Number(hh), Number(mm), 0, 0);
        nextOpensAt = d.toISOString();
        break;
      }
    }
    return { isOpenNow: false, openReason: 'closed', nextOpensAt };
  }
  if (!today.opensAt || !today.closesAt) {
    return { isOpenNow: true, openReason: 'open', nextOpensAt: null };
  }
  const isOpen = currentTime >= today.opensAt && currentTime <= today.closesAt;
  if (isOpen) {
    return { isOpenNow: true, openReason: 'open', nextOpensAt: null };
  }
  let nextOpensAt = null;
  if (currentTime < today.opensAt) {
    const d = new Date(at);
    const [hh, mm] = today.opensAt.split(':');
    d.setHours(Number(hh), Number(mm), 0, 0);
    nextOpensAt = d.toISOString();
  } else {
    for (let i = 1; i <= 7; i++) {
      const nextDay = (day + i) % 7;
      const next = (outlet.operatingHours || []).find((h) => h.day === nextDay && h.isOpen !== false && h.opensAt);
      if (next) {
        const d = new Date(at);
        d.setDate(d.getDate() + i);
        const [hh, mm] = next.opensAt.split(':');
        d.setHours(Number(hh), Number(mm), 0, 0);
        nextOpensAt = d.toISOString();
        break;
      }
    }
  }
  return { isOpenNow: false, openReason: 'outside_hours', nextOpensAt };
};

module.exports = { computeOpenStatus };
