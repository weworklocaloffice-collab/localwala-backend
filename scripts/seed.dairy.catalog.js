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
 * Seeds the dairy catalogue taxonomy: the 10 fixed top-level categories and
 * their 33 sub-categories. This was explicitly deferred during the vertical
 * build (every environment started with an empty tree); it is now a script so
 * a fresh checkout has something to render in the customer app and admin.
 *
 * Idempotent — safe to re-run; existing rows are updated in place, never
 * duplicated. Products/SKUs are NOT seeded here (they belong to outlets);
 * this is the platform-wide taxonomy only.
 *
 * Usage:
 *   node scripts/seed.dairy.catalog.js
 *   node scripts/seed.dairy.catalog.js --wipe   removes seeded taxonomy first
 */

const mongoose = require('mongoose');
const { DairyCategory, DairySubCategory } = require('../src/models');

// The ten top-level keys are fixed by the specification and are referenced by
// products and imports — do not rename them.
const CATALOG = [
  {
    key: 'milk',
    name: 'Milk',
    description: 'Daily fresh milk in every fat level and source',
    subs: [
      { key: 'milk_cow', name: 'Cow Milk' },
      { key: 'milk_buffalo', name: 'Buffalo Milk' },
      { key: 'milk_toned', name: 'Toned Milk' },
      { key: 'milk_full_cream', name: 'Full Cream Milk' },
      { key: 'milk_a2', name: 'A2 Milk' },
    ],
  },
  {
    key: 'curd_yogurt',
    name: 'Curd & Yogurt',
    description: 'Set curd, cup curd and yogurts',
    subs: [
      { key: 'curd_cup', name: 'Cup Curd' },
      { key: 'curd_bulk', name: 'Bulk Curd' },
      { key: 'curd_greek', name: 'Greek Yogurt' },
      { key: 'curd_flavored', name: 'Flavored Yogurt' },
    ],
  },
  {
    key: 'buttermilk_lassi',
    name: 'Buttermilk & Lassi',
    subs: [
      { key: 'buttermilk_plain', name: 'Plain Buttermilk' },
      { key: 'buttermilk_masala', name: 'Masala Buttermilk' },
      { key: 'lassi', name: 'Lassi' },
    ],
  },
  {
    key: 'ghee',
    name: 'Ghee',
    subs: [
      { key: 'ghee_cow', name: 'Cow Ghee' },
      { key: 'ghee_buffalo', name: 'Buffalo Ghee' },
      { key: 'ghee_a2', name: 'A2 Ghee' },
    ],
  },
  {
    key: 'butter',
    name: 'Butter',
    subs: [
      { key: 'butter_salted', name: 'Salted Butter' },
      { key: 'butter_unsalted', name: 'Unsalted Butter' },
      { key: 'butter_white', name: 'White Butter' },
    ],
  },
  {
    key: 'paneer_fresh_dairy',
    name: 'Paneer & Fresh Dairy',
    subs: [
      { key: 'paneer_fresh', name: 'Fresh Paneer' },
      { key: 'paneer_malai', name: 'Malai Paneer' },
      { key: 'khoya', name: 'Khoya' },
      { key: 'malai', name: 'Cream Malai' },
    ],
  },
  {
    key: 'cheese',
    name: 'Cheese',
    subs: [
      { key: 'cheese_mozzarella', name: 'Mozzarella' },
      { key: 'cheese_cheddar', name: 'Cheddar' },
      { key: 'cheese_processed', name: 'Processed Cheese' },
    ],
  },
  {
    key: 'cream',
    name: 'Cream',
    subs: [
      { key: 'cream_fresh', name: 'Fresh Cream' },
      { key: 'cream_whipping', name: 'Whipping Cream' },
    ],
  },
  {
    key: 'dairy_drinks',
    name: 'Dairy Drinks',
    subs: [
      { key: 'dairy_drink_flavored_milk', name: 'Flavored Milk' },
      { key: 'dairy_drink_milkshake', name: 'Milkshake' },
      { key: 'dairy_drink_cold_coffee', name: 'Cold Coffee' },
    ],
  },
  {
    key: 'traditional_dairy',
    name: 'Traditional Dairy',
    subs: [
      { key: 'traditional_shrikhand', name: 'Shrikhand' },
      { key: 'traditional_basundi', name: 'Basundi' },
      { key: 'traditional_paneer_cubes', name: 'Paneer Cubes' },
    ],
  },
];

const log = (...args) => console.log('[seed.dairy.catalog]', ...args);

const connect = async () => {
  require('dotenv').config();
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;
  if (!url) throw new Error('MONGODB_URL not set');
  await mongoose.connect(url, { serverSelectionTimeoutMS: 8000 });
  log('connected');
};

const wipe = async () => {
  const categoryKeys = CATALOG.map((c) => c.key);
  const subKeys = CATALOG.flatMap((c) => c.subs.map((s) => s.key));
  // Only remove what this script owns: taxonomy rows carrying our keys. A
  // category created by an admin through the UI is left alone.
  const removedCats = await DairyCategory.deleteMany({ key: { $in: categoryKeys } });
  const removedSubs = await DairySubCategory.deleteMany({ key: { $in: subKeys } });
  log(`wiped ${removedCats.deletedCount} categories, ${removedSubs.deletedCount} sub-categories`);
};

const seed = async () => {
  let cats = 0;
  let subs = 0;

  // create()/save() rather than findOneAndUpdate: the slug plugin derives the
  // unique slug in pre-save middleware, which an upsert bypasses — every row
  // would land with `slug: null` and collide on the unique index.
  for (const [index, entry] of CATALOG.entries()) {
    let category = await DairyCategory.findOne({ key: entry.key });
    if (category) {
      category.name = entry.name;
      category.sortOrder = index + 1;
      category.status = true;
      if (entry.description) category.description = entry.description;
      await category.save();
    } else {
      category = await DairyCategory.create({
        key: entry.key,
        name: entry.name,
        description: entry.description,
        sortOrder: index + 1,
        status: true,
      });
    }
    cats += 1;

    for (const [subIndex, sub] of entry.subs.entries()) {
      let existing = await DairySubCategory.findOne({ category: category._id, key: sub.key });
      if (existing) {
        existing.name = sub.name;
        existing.sortOrder = subIndex + 1;
        existing.status = true;
        await existing.save();
      } else {
        await DairySubCategory.create({
          category: category._id,
          key: sub.key,
          name: sub.name,
          sortOrder: subIndex + 1,
          status: true,
        });
      }
      subs += 1;
    }
  }

  log(`seeded ${cats} categories, ${subs} sub-categories`);
};

(async () => {
  try {
    await connect();
    if (process.argv.includes('--wipe')) {
      await wipe();
    }
    await seed();
    await mongoose.disconnect();
    log('done');
  } catch (error) {
    console.error('[seed.dairy.catalog] FAILED:', error.message);
    process.exitCode = 1;
    try {
      await mongoose.disconnect();
    } catch (_) {
      // already closed
    }
  }
})();
