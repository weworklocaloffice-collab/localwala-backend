const mongoose = require('mongoose');
require('dotenv').config();
require('../src/modules/stores/models/store.category.model');
require('../src/modules/stores/models/store.subcategory.model');
require('../src/modules/stores/models/store.brand.model');
require('../src/modules/stores/models/chain.product.model');
const taxonomy = require('../src/modules/stores/services/stores.admin.taxonomy.service');
(async () => {
  await mongoose.connect(process.env.MONGODB_URL);
  const C = new mongoose.Types.ObjectId();
  const S = Date.now() % 100000;
  const cat = await taxonomy.createCategory({ name: 'Dbg Cat ' + S });
  console.log('cat _id=' + cat._id + ' key=' + cat.key);
  const sub = await taxonomy.createSubcategory({ category: cat._id, name: 'Dbg Sub ' + S });
  console.log('sub _id=' + (sub && sub._id));
  const P = mongoose.model('ChainProduct');
  const prod = await P.create({ chain: C, category: cat._id, name: 'Dbg Prod ' + S, slug: 'dbg-prod-' + S, status: 'active' });
  console.log('prod _id=' + prod._id);
  const delP = await P.deleteMany({ chain: C });
  console.log('products deleted: ' + delP.deletedCount);
  try {
    await taxonomy.removeSubcategory(sub._id);
    console.log('sub removed OK');
  } catch (e) { console.log('sub remove THREW: ' + e.message.slice(0, 80)); }
  try {
    await taxonomy.removeCategory(cat._id);
    console.log('cat removed OK');
  } catch (e) { console.log('cat remove THREW: ' + e.message.slice(0, 100)); }
  await P.deleteMany({ chain: C });
  await mongoose.model('StoreSubcategory').deleteMany({ category: cat._id });
  await mongoose.model('StoreCategory').deleteMany({ _id: cat._id });
  await mongoose.disconnect();
})();