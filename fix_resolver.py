p='src/modules/header-banner/services/header.banner.resolver.service.js'
s=open(p,encoding='utf-8').read()
old='''  const verticalFilter = vertical ? { vertical } : {};

  let banner = null;

  if (cityId) {
    banner = await HeaderBanner.findOne({ ...base, ...verticalFilter, city: cityId }).sort(sort);
  }

  if (!banner && vertical) {
    banner = await HeaderBanner.findOne({ ...base, ...verticalFilter, city: null }).sort(sort);
  }

  if (!banner) {
    banner = await HeaderBanner.findOne({ ...base, city: cityId || null }).sort(sort);
  }

  if (!banner) {
    banner = await HeaderBanner.findOne({ ...base, city: null }).sort(sort);
  }
'''
new='''  const isVertical = !!vertical;
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
assert old in s, 'old not found'
s=s.replace(old,new)
open(p,'w',encoding='utf-8').write(s)
print('done')
PY