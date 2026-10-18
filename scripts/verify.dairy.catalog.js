/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

/**
 * Verifies the four-level catalogue hierarchy and faceted search against the
 * real DB.
 *
 * Asserts:
 *   1. category created with a unique key; duplicate key refused
 *   2. sub-category must belong to a real category
 *   3. brand is a flat lookup, not a tree node
 *   4. product under category + sub-category
 *   5. product with a MISMATCHED sub-category refused
 *   6. SKU inherits category/sub-category/brand from its product
 *   7. pack size is the purchasable unit — several SKUs per product
 *   8. reusableContainer gate preserved on SKU
 *   9. stock moves by delta and cannot go negative
 *  10. deleting a category with children is refused
 *  11. deleting a product with SKUs is refused
 *  12. category tree builds with per-sub-category counts
 *  13. tree omits another outlet's products
 *  14. faceted search by the two dimensions (fatLevel x milkType)
 *  15. price-range filter returns only products with a SKU in band
 *  16. search excludes out-of-stock pack sizes
 *  17. catalog health report
 *
 * Builds and tears down its own taxonomy using a unique tag, so it does not
 * depend on any seeded data.
 *
 * Usage: node scripts/verify.dairy.catalog.js
 */

const mongoose = require('mongoose');
const {
  User,
  Business,
  DairyCategory,
  DairySubCategory,
  DairyBrand,
  DairyProduct,
  DairySku,
} = require('../src/models');
const catalog = require('../src/modules/dairy/services/dairy.catalog.service');

let failures = 0;
const check = (label, condition, detail) => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const run = async () => {
  require('dotenv').config();
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const asha = await User.findOne({ countryCode: '+91', mobile: '9000000001' });
  if (!asha) {
    console.error('Seed data missing. Run: node scripts/seed.dairy.js');
    process.exit(1);
  }
  const businessA = await Business.findOne({ owner: asha._id });
  const tag = `C${Date.now().toString().slice(-6)}`;

  // A second outlet, to prove per-outlet scoping.
  const ownerB = await User.create({
    firstName: 'Scope', lastName: 'Test', countryCode: '+91',
    mobile: Number(`95${Date.now().toString().slice(-8)}`),
    email: `scope${Date.now()}@cat.local`, password: 'Test@12345',
    role: 'dairyPartner', status: true, locale: 'en',
  });
  const businessB = await Business.create({
    vertical: 'dairy', businessModel: 'direct', name: `Scope Outlet ${tag}`,
    owner: ownerB._id, ownDeliveryPartner: false, verified: true, status: true,
  });

  const created = { categories: [], subs: [], brands: [], products: [], skus: [] };

  try {
    // ---- 1. Category ----
    console.log('\n1. Category');
    const milk = await catalog.createCategory({
      key: `milk_${tag}`, name: `Milk ${tag}`, sortOrder: 1, status: true,
    });
    created.categories.push(milk);
    check('category created', !!milk._id);

    let dupKeyRefused = false;
    try {
      await catalog.createCategory({ key: milk.key, name: 'Duplicate' });
    } catch (e) { dupKeyRefused = e.statusCode === 400; }
    check('duplicate category key refused', dupKeyRefused);

    const ghee = await catalog.createCategory({
      key: `ghee_${tag}`, name: `Ghee ${tag}`, sortOrder: 2, status: true,
    });
    created.categories.push(ghee);

    // ---- 2. Sub-categories ----
    console.log('\n2. Sub-category');
    const toned = await catalog.createSubCategory({
      category: milk._id, key: `toned_${tag}`, name: `Toned ${tag}`, sortOrder: 1,
    });
    created.subs.push(toned);
    const cow = await catalog.createSubCategory({
      category: milk._id, key: `cow_${tag}`, name: `Cow ${tag}`, sortOrder: 2,
    });
    created.subs.push(cow);
    const cowGhee = await catalog.createSubCategory({
      category: ghee._id, key: `cow_ghee_${tag}`, name: `Cow Ghee ${tag}`,
    });
    created.subs.push(cowGhee);
    check('three sub-categories created', created.subs.length === 3);

    let badCatRefused = false;
    try {
      await catalog.createSubCategory({ category: '507f1f77bcf86cd799439011', name: 'Orphan' });
    } catch (e) { badCatRefused = e.statusCode === 404; }
    check('sub-category under a non-existent category refused', badCatRefused);

    // ---- 3. Brand ----
    console.log('\n3. Brand (flat lookup)');
    const localwala = await catalog.createBrand({ name: `LocalWala ${tag}`, country: 'India' });
    created.brands.push(localwala);
    check('brand created without a category parent', !!localwala._id && !localwala.category);

    // ---- 4. Product ----
    console.log('\n4. Product');
    const p1 = await catalog.createProduct({
      business: businessA._id, category: milk._id, subCategory: cow._id,
      brand: localwala._id, name: `LocalWala Toned Cow Milk ${tag}`,
      attributes: { fatLevel: 'toned', milkType: 'cow' },
      sortOrder: 1, status: true,
    });
    created.products.push(p1);
    check('product created', !!p1._id);
    check('sub-category name denormalised onto the product', p1.subCategoryName === cow.name,
      `got ${p1.subCategoryName}`);

    const p2 = await catalog.createProduct({
      business: businessA._id, category: milk._id, subCategory: toned._id,
      brand: localwala._id, name: `LocalWala Double Toned Buffalo ${tag}`,
      attributes: { fatLevel: 'double_toned', milkType: 'buffalo' },
      sortOrder: 2, status: true,
    });
    created.products.push(p2);

    const p3 = await catalog.createProduct({
      business: businessA._id, category: ghee._id, subCategory: cowGhee._id,
      name: `Cow Ghee ${tag}`, sortOrder: 1, status: true,
    });
    created.products.push(p3);

    // Other outlet's product, to prove scoping.
    const pOther = await catalog.createProduct({
      business: businessB._id, category: milk._id, subCategory: cow._id,
      name: `Rival Outlet Milk ${tag}`, status: true,
    });
    created.products.push(pOther);

    // ---- 5. Mismatched pair refused ----
    console.log('\n5. Hierarchy integrity');
    let mismatchRefused = false;
    try {
      await catalog.createProduct({
        business: businessA._id, category: milk._id, subCategory: cowGhee._id,
        name: `Mismatched ${tag}`,
      });
    } catch (e) { mismatchRefused = e.statusCode === 400; }
    check('product with a sub-category from another category refused', mismatchRefused);

    // ---- 6/7. SKU ----
    console.log('\n6. SKU — the purchasable unit');
    const sku1L = await catalog.createSku({
      product: p1._id, name: `Toned Cow Milk 1 Litre ${tag}`,
      packSize: { value: '1 Litre', unit: 'litre', quantity: 1 },
      reusableContainer: true, rotationSize: 2,
      price: 60, mrp: 62, availableQty: 40, inStock: true, status: true,
    });
    created.skus.push(sku1L);
    check('SKU inherits category from its product',
      sku1L.category.toString() === milk._id.toString());
    check('SKU inherits brand from its product',
      sku1L.brand && sku1L.brand.toString() === localwala._id.toString());
    check('reusableContainer preserved', sku1L.reusableContainer === true);

    const sku500 = await catalog.createSku({
      product: p1._id, name: `Toned Cow Milk 500 ml ${tag}`,
      packSize: { value: '500 ml', unit: 'ml', quantity: 500 },
      price: 32, availableQty: 25, inStock: true, status: true,
    });
    created.skus.push(sku500);
    check('one product carries several pack sizes', created.skus.filter((s) => s.product.equals(p1._id)).length === 2);

    const skuOut = await catalog.createSku({
      product: p2._id, name: `Buffalo Milk 1 Litre ${tag}`,
      packSize: { value: '1 Litre', unit: 'litre', quantity: 1 },
      price: 80, availableQty: 0, inStock: false, status: true,
    });
    created.skus.push(skuOut);

    const detail = await catalog.getProductDetail(p1._id, {});
    check('product detail returns both in-stock pack sizes', detail.skus.length === 2,
      `got ${detail.skus.length}`);
    const detailAll = await catalog.getProductDetail(p1._id, { includeOutOfStock: true });
    check('includeOutOfStock widens the result', detailAll.skus.length >= 2);

    const outDetail = await catalog.getProductDetail(p2._id, {});
    check('out-of-stock pack size hidden by default', outDetail.skus.length === 0,
      `got ${outDetail.skus.length}`);

    // ---- 9. Stock delta ----
    console.log('\n7. Stock movements');
    const before = (await catalog.listSkus({ product: p1._id.toString() })).skus
      .find((s) => s._id.equals(sku1L._id)).availableQty;
    const after = await catalog.adjustSkuStock(sku1L._id, { delta: -5 });
    check('stock decreases by delta', after.availableQty === before - 5,
      `before=${before} after=${after.availableQty}`);

    let negativeRefused = false;
    try {
      await catalog.adjustSkuStock(sku1L._id, { delta: -(before + 100) });
    } catch (e) { negativeRefused = e.statusCode === 400; }
    check('negative stock refused', negativeRefused);

    const zeroed = await catalog.adjustSkuStock(sku1L._id, { delta: -after.availableQty });
    check('stock reaching zero flips inStock false', zeroed.inStock === false, `got ${zeroed.inStock}`);

    await catalog.adjustSkuStock(sku1L._id, { delta: 40 });
    await catalog.adjustSkuStock(sku500._id, { delta: 0 });

    // ---- 10/11. Delete guards ----
    console.log('\n8. Delete guards');
    let catDeleteRefused = false;
    try {
      await catalog.deleteCategory(milk._id);
    } catch (e) { catDeleteRefused = e.statusCode === 400; }
    check('deleting a category with children refused', catDeleteRefused);

    let prodDeleteRefused = false;
    try {
      await catalog.deleteProduct(p1._id);
    } catch (e) { prodDeleteRefused = e.statusCode === 400; }
    check('deleting a product with pack sizes refused', prodDeleteRefused);

    let subDeleteRefused = false;
    try {
      await catalog.deleteSubCategory(cow._id);
    } catch (e) { subDeleteRefused = e.statusCode === 400; }
    check('deleting a sub-category with products refused', subDeleteRefused);

    // ---- 12/13. Tree ----
    console.log('\n9. Category tree');
    const tree = await catalog.getCategoryTree({ business: businessA._id.toString() });
    const milkNode = tree.categories.find((c) => c._id.equals(milk._id));
    check('tree contains the category', !!milkNode);
    check('sub-categories nested under the category', milkNode.subCategories.length === 2,
      `got ${milkNode.subCategories.length}`);
    const cowNode = milkNode.subCategories.find((s) => s._id.equals(cow._id));
    check('per-sub-category product count is correct', cowNode.productCount === 1,
      `got ${cowNode.productCount}`);
    const rivalVisible = JSON.stringify(tree.categories).includes(`Rival Outlet Milk`);
    check("another outlet's product is absent from this outlet's tree", !rivalVisible);

    const treeAll = await catalog.getCategoryTree({});
    const allCow = treeAll.categories.find((c) => c._id.equals(milk._id))
      .subCategories.find((s) => s._id.equals(cow._id));
    check('unscoped tree counts products from every outlet', allCow.productCount === 2,
      `got ${allCow.productCount}`);

    // ---- 14/15/16. Faceted search ----
    console.log('\n10. Faceted search');
    const cowMilk = await catalog.searchProducts({
      business: businessA._id.toString(), milkType: 'cow',
    });
    check('filter by milkType=cow returns 1', cowMilk.totalResults === 1, `got ${cowMilk.totalResults}`);

    const tonedOnly = await catalog.searchProducts({
      business: businessA._id.toString(), fatLevel: 'toned',
    });
    check('filter by fatLevel=toned returns 1', tonedOnly.totalResults === 1, `got ${tonedOnly.totalResults}`);

    const bothDim = await catalog.searchProducts({
      business: businessA._id.toString(), fatLevel: 'toned', milkType: 'cow',
    });
    check('both dimensions together return 1', bothDim.totalResults === 1, `got ${bothDim.totalResults}`);

    const gheeSearch = await catalog.searchProducts({
      business: businessA._id.toString(), category: ghee._id.toString(),
    });
    check('filter by category returns only that category', gheeSearch.totalResults === 1,
      `got ${gheeSearch.totalResults}`);

    const priced = await catalog.searchProducts({
      business: businessA._id.toString(), minPrice: 55, maxPrice: 65,
    });
    check('price band returns only products with a SKU in range', priced.totalResults === 1,
      `got ${priced.totalResults}`);

    const searchRes = await catalog.searchProducts({
      business: businessA._id.toString(), minPrice: 500,
    });
    check('price band with no matches returns 0', searchRes.totalResults === 0,
      `got ${searchRes.totalResults}`);

    const withSkus = await catalog.searchProducts({ business: businessA._id.toString() });
    // `toJSON` (models/plugins/toJSON.plugin.js) renames `_id` to `id`, so search
    // results are matched on `id`.
    const p2Result = withSkus.products.find((p) => p && p.id && p.id.toString() === p2._id.toString());
    check('search attaches in-stock pack sizes', p2Result && p2Result.skus.length === 0,
      `skus=${p2Result ? p2Result.skus.length : 'product not in results'}`);
    const p1Result = withSkus.products.find((p) => p && p.id && p.id.toString() === p1._id.toString());
    check('in-stock pack sizes are attached', p1Result && p1Result.skus.length === 2,
      `skus=${p1Result ? p1Result.skus.length : 'product not in results'}`);

    // ---- 17. Health ----
    console.log('\n11. Catalog health');
    const health = await catalog.getCatalogHealth();
    check('health reports category count', health.totalCategories >= 2, `got ${health.totalCategories}`);
    check('health reports product count', health.totalProducts >= 4, `got ${health.totalProducts}`);
    check('no product without a category', health.orphanProductSku === 0, `got ${health.orphanProductSku}`);
    check('no SKU without a product', health.skusWithoutProduct === 0, `got ${health.skusWithoutProduct}`);

    // ---- 18. Brand delete ----
    //
    // Brands were the one taxonomy entity with no delete, which left the admin
    // screen unable to retire one. The guard is the part worth proving: without it
    // a deleted brand leaves products pointing at an id that no longer resolves.
    console.log('\n12. Brand delete');

    const unusedBrand = await catalog.createBrand({ name: `Retired ${tag}`, country: 'India' });
    created.brands.push(unusedBrand);

    let brandDeleteRefusedWhileReferenced = false;
    try {
      // `localwala` is referenced by p1, so the delete must be refused.
      await catalog.deleteBrand(localwala._id);
    } catch (error) {
      brandDeleteRefusedWhileReferenced = /product/i.test(error.message);
    }
    check('a brand a product still uses cannot be deleted', brandDeleteRefusedWhileReferenced);

    const brandStillThere = await DairyBrand.findById(localwala._id).lean();
    check('the referenced brand survives the refused delete', Boolean(brandStillThere));

    let deletedBrand = null;
    try {
      deletedBrand = await catalog.deleteBrand(unusedBrand._id);
    } catch (error) {
      check('an unreferenced brand deletes cleanly', false, error.message);
    }
    if (deletedBrand) {
      const gone = await DairyBrand.findById(unusedBrand._id);
      check('an unreferenced brand deletes cleanly', gone === null);
    }

    // ---- 19. Admin taxonomy reads ----
    //
    // The same handlers the storefront uses, so the admin list cannot drift from
    // the public one. Exercised here at the service level because the routes sit
    // behind `webAuth` and this suite carries no web token; their registration is
    // asserted by the API contract checker.
    console.log('\n13. Admin taxonomy reads');
    const adminCategories = await catalog.listCategories({});
    check(
      'category list is readable',
      Array.isArray(adminCategories.categories) && adminCategories.categories.length >= 2,
      `got ${adminCategories.categories.length}`
    );
    const adminSubs = await catalog.listSubCategories({ category: milk._id.toString() });
    check(
      'sub-category list is readable and filters by category',
      Array.isArray(adminSubs.subCategories) && adminSubs.subCategories.length >= 1,
      `got ${adminSubs.subCategories.length}`
    );
    const adminBrands = await catalog.listBrands({});
    check(
      'brand list is readable',
      Array.isArray(adminBrands.brands) && adminBrands.brands.length >= 1,
      `got ${adminBrands.brands.length}`
    );
  } catch (e) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${e.message}`);
  } finally {
    await DairySku.deleteMany({ _id: { $in: created.skus.map((s) => s._id) } });
    await DairyProduct.deleteMany({ _id: { $in: created.products.map((p) => p._id) } });
    await DairySubCategory.deleteMany({ _id: { $in: created.subs.map((s) => s._id) } });
    await DairyBrand.deleteMany({ _id: { $in: created.brands.map((b) => b._id) } });
    await DairyCategory.deleteMany({ _id: { $in: created.categories.map((c) => c._id) } });
    await Business.deleteMany({ _id: businessB._id });
    await User.deleteMany({ _id: ownerB._id });
    await mongoose.disconnect();
  }

  console.log(failures === 0 ? '\nALL CATALOG CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
};

run().catch(async (e) => {
  console.error('verification failed:', e.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});