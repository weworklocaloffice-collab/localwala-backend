p='src/modules/header-banner/services/header.banner.resolver.service.js'
s=open(p,encoding='utf-8').read()
old='''  const isVertical = !!vertical;
  // A request without a vertical (the home feed) must never resolve a
  // vertical-specific banner, otherwise a dairy/meat/etc. banner leaks onto
  // the home screen. Restrict it to global (vertical: null) banners only.
  const verticalFilter = isVertical ? { vertical } : { vertical: null };

  let banner = null;

  if (cityId) {
    banner = await HeaderBanner.findOne({ ...base, ...verticalFilter, city: cityId }).sort(sort);
  }

  if (!banner) {
    banner = await HeaderBanner.findOne({ ...base, ...verticalFilter, city: null }).sort(sort);
  }

  // Fall back to a global banner for any vertical, including home.
  if (!banner && isVertical) {
    if (cityId) {
      banner = await HeaderBanner.findOne({ ...base, vertical: null, city: cityId }).sort(sort);
    }
    if (!banner) {
      banner = await HeaderBanner.findOne({ ...base, vertical: null, city: null }).sort(sort);
    }
  }
'''
new='''  // `null` / empty / "all" means a global banner that applies to every vertical.
  // A specific vertical matches itself plus those global values, so a dairy banner
  // never leaks onto the home feed and an "all verticals" banner shows everywhere.
  const requested = vertical && String(vertical).trim().toLowerCase();
  const allowedVerticals = requested && requested !== 'all'
    ? [null, '', 'all', vertical]
    : [null, '', 'all'];
  const verticalFilter = { vertical: { $in: allowedVerticals } };

  let banner = null;

  if (cityId) {
    banner = await HeaderBanner.findOne({ ...base, ...verticalFilter, city: cityId }).sort(sort);
  }

  if (!banner) {
    banner = await HeaderBanner.findOne({ ...base, ...verticalFilter, city: null }).sort(sort);
  }
'''
assert old in s
s=s.replace(old,new)
open(p,'w',encoding='utf-8').write(s)
print('done')
PY