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
 * seed.stores.js — the entire taxonomy for the Local Stores vertical.
 *
 * ## This file is the proof of BR-26
 *
 * Twenty retail categories, their subcategories, their attribute templates, their
 * per-category configuration, and the GST rate table — all as DATA. There is no
 * `electronics` module and no `grocery` module. Adding a twenty-first category is
 * another block in CATEGORIES below, not a migration.
 *
 * ## Idempotent
 *
 * Every write is an upsert keyed on a stable `key`, so re-running changes nothing and
 * adds nothing twice. `--wipe` removes only what this script created.
 *
 * Run: node scripts/seed.stores.js
 *      node scripts/seed.stores.js --wipe
 */

require('dotenv').config();
const mongoose = require('mongoose');

const {
  Vertical,
  TaxConfiguration,
  StoreCategory,
  StoreSubcategory,
  StoreAttributeTemplate,
  StoreBrand,
  StoreSubscriptionPlan,
} = require('../src/models');

// ---------------------------------------------------------------------------
// 1. the vertical itself
// ---------------------------------------------------------------------------

const VERTICAL = {
  key: 'stores',
  name: 'Local Stores',
  description:
    'Multi-category local retail: a chain of outlets with its own catalogue, inventory, fleet and settlement.',
  icon: 'tablerBuildingStore',
  // BR-05: stores deliver with their OWN drivers. The platform fleet is never used.
  usesSharedDelivery: false,
  sortOrder: 10,
  status: true,
  settings: {
    // Everything risky is OFF at launch and switched on deliberately.
    enabledFeatures: {
      catalogue: true,
      inventory: true,
      storeOwnedDelivery: true,
      customerSubscriptions: false, // Phase 15
      codEnabled: false, // Phase 4, per-outlet too
      exchanges: false,
      warranty: true,
      promotions: true,
      featuredPlacement: true,
      organicVerification: true,
      storesSubscription: true,
    },
    allowedPromotionTypes: [
      'percent_off',
      'fixed_off',
      'min_order_offer',
      'free_delivery',
      'product_discount',
    ],
    productApprovalRequired: false, // BR-09: the catalogue is partner-managed
    maxRadiusKm: 25,
  },
};

// ---------------------------------------------------------------------------
// 2. attribute templates — the dynamic attributes (BR-11)
// ---------------------------------------------------------------------------

const ATTRIBUTE_TEMPLATES = [
  {
    slug: 'size',
    name: 'Size',
    type: 'size',
    variantAxis: true,
    filterable: true,
    searchable: true,
    required: false,
    options: [
      { value: 'xs', label: 'XS' }, { value: 's', label: 'S' }, { value: 'm', label: 'M' },
      { value: 'l', label: 'L' }, { value: 'xl', label: 'XL' }, { value: 'xxl', label: 'XXL' },
    ],
  },
  {
    slug: 'colour',
    name: 'Colour',
    type: 'color',
    variantAxis: true,
    filterable: true,
    searchable: true,
    options: [
      { value: 'black', label: 'Black', swatch: '#000000' },
      { value: 'white', label: 'White', swatch: '#FFFFFF' },
      { value: 'blue', label: 'Blue', swatch: '#1E4FD8' },
      { value: 'red', label: 'Red', swatch: '#D81E1E' },
      { value: 'green', label: 'Green', swatch: '#2E7D32' },
      { value: 'grey', label: 'Grey', swatch: '#9E9E9E' },
    ],
  },
  {
    slug: 'fabric',
    name: 'Fabric',
    type: 'select',
    variantAxis: false,
    filterable: true,
    options: [
      { value: 'cotton', label: 'Cotton' },
      { value: 'polyester', label: 'Polyester' },
      { value: 'denim', label: 'Denim' },
      { value: 'silk', label: 'Silk' },
      { value: 'linen', label: 'Linen' },
    ],
  },
  {
    slug: 'pattern',
    name: 'Pattern',
    type: 'select',
    variantAxis: false,
    filterable: true,
    options: [
      { value: 'solid', label: 'Solid' },
      { value: 'striped', label: 'Striped' },
      { value: 'checked', label: 'Checked' },
      { value: 'printed', label: 'Printed' },
    ],
  },
  {
    slug: 'model',
    name: 'Model',
    type: 'text',
    variantAxis: true,
    searchable: true,
    filterable: true,
  },
  {
    slug: 'storage',
    name: 'Storage',
    type: 'select',
    variantAxis: true,
    filterable: true,
    options: [
      { value: '32gb', label: '32 GB' }, { value: '64gb', label: '64 GB' },
      { value: '128gb', label: '128 GB' }, { value: '256gb', label: '256 GB' },
      { value: '512gb', label: '512 GB' }, { value: '1tb', label: '1 TB' },
    ],
  },
  {
    slug: 'ram',
    name: 'RAM',
    type: 'select',
    variantAxis: false,
    filterable: true,
    options: [
      { value: '4gb', label: '4 GB' }, { value: '6gb', label: '6 GB' },
      { value: '8gb', label: '8 GB' }, { value: '12gb', label: '12 GB' },
      { value: '16gb', label: '16 GB' },
    ],
  },
  {
    slug: 'warranty',
    name: 'Warranty',
    type: 'select',
    variantAxis: false,
    filterable: true,
    options: [
      { value: 'none', label: 'No warranty' },
      { value: '6m', label: '6 months' },
      { value: '12m', label: '1 year' },
      { value: '24m', label: '2 years' },
    ],
  },
  {
    slug: 'wattage',
    name: 'Wattage',
    type: 'select',
    variantAxis: false,
    filterable: true,
    options: [
      { value: '25w', label: '25 W' }, { value: '40w', label: '40 W' },
      { value: '60w', label: '60 W' }, { value: '100w', label: '100 W' },
      { value: '150w', label: '150 W' },
    ],
  },
  {
    slug: 'voltage',
    name: 'Voltage',
    type: 'select',
    variantAxis: false,
    filterable: true,
    options: [
      { value: '110v', label: '110 V' }, { value: '220v', label: '220 V' },
      { value: '230v', label: '230 V' }, { value: '240v', label: '240 V' },
    ],
  },
  {
    slug: 'weight',
    name: 'Weight',
    type: 'number',
    variantAxis: true,
    unit: 'g',
    filterable: true,
  },
  {
    slug: 'pack_size',
    name: 'Pack Size',
    type: 'select',
    variantAxis: true,
    filterable: true,
    options: [
      { value: '100g', label: '100 g' }, { value: '250g', label: '250 g' },
      { value: '500g', label: '500 g' }, { value: '1kg', label: '1 kg' },
      { value: '5kg', label: '5 kg' }, { value: '10kg', label: '10 kg' },
    ],
  },
  {
    slug: 'unit',
    name: 'Unit',
    type: 'select',
    variantAxis: false,
    filterable: true,
    options: [
      { value: 'piece', label: 'Piece' }, { value: 'dozen', label: 'Dozen' },
      { value: 'litre', label: 'Litre' }, { value: 'kilogram', label: 'Kilogram' },
    ],
  },
  {
    slug: 'prescription',
    name: 'Prescription',
    type: 'file',
    variantAxis: false,
    required: false,
  },
];

// ---------------------------------------------------------------------------
// 3. categories and their subcategories
// ---------------------------------------------------------------------------

const CATEGORIES = [
  {
    key: 'grocery_supermarket',
    name: 'Grocery & Supermarket',
    icon: 'tablerShoppingCart',
    defaults: { brandRequired: false, hasVariants: true, returnWindowDays: 1, exchangeable: false, expiryTracked: true, organicEligible: true, gstDefaultRate: 5 },
    subs: [
      { key: 'rice_pulses', name: 'Rice & Pulses', def: { expiryTracked: true, shelfLifeDays: 365 } },
      { key: 'dairy', name: 'Dairy', def: { expiryTracked: true, shelfLifeDays: 21 } },
      { key: 'snacks_beverages', name: 'Snacks & Beverages', def: { expiryTracked: true } },
      { key: 'oils_ghee', name: 'Oils & Ghee', def: { expiryTracked: true, shelfLifeDays: 365 } },
      { key: 'bakery', name: 'Bakery', def: { expiryTracked: true, shelfLifeDays: 2, returnWindowDays: 0, exchangeable: false } },
      { key: 'organic_produce', name: 'Organic Fruits & Vegetables', def: { expiryTracked: true, shelfLifeDays: 7, organicEligible: true, returnWindowDays: 1 } },
    ],
  },
  {
    key: 'clothing_fashion',
    name: 'Clothing & Fashion',
    icon: 'tablerShirt',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 15, exchangeable: true, gstDefaultRate: 5 },
    subs: [
      { key: 'mens', name: 'Men', def: { returnWindowDays: 15, exchangeable: true } },
      { key: 'womens', name: 'Women', def: { returnWindowDays: 15, exchangeable: true } },
      { key: 'kids', name: 'Kids', def: { returnWindowDays: 15, exchangeable: true } },
    ],
  },
  {
    key: 'footwear',
    name: 'Footwear',
    icon: 'tablerShoe',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 15, exchangeable: true, gstDefaultRate: 18 },
    subs: [
      { key: 'mens_footwear', name: 'Men', def: {} },
      { key: 'womens_footwear', name: 'Women', def: {} },
      { key: 'kids_footwear', name: 'Kids', def: {} },
      { key: 'sports_shoes', name: 'Sports Shoes', def: {} },
    ],
  },
  {
    key: 'electronics',
    name: 'Electronics',
    icon: 'tablerDeviceDesktop',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, warrantyRequired: true, serialRequired: true, gstDefaultRate: 18 },
    subs: [
      { key: 'laptops', name: 'Laptops', def: { warrantyRequired: true } },
      { key: 'audio', name: 'Audio', def: {} },
      { key: 'television', name: 'Television', def: { warrantyRequired: true } },
      { key: 'cameras', name: 'Cameras', def: { serialRequired: true } },
    ],
  },
  {
    // Separate from Electronics because the specification lists it separately and it
    // behaves differently: a serial or IMEI on every unit, no returns after activation,
    // and the highest theft exposure of any category.
    key: 'mobile_accessories',
    name: 'Mobile & Accessories',
    icon: 'tablerDeviceMobile',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, warrantyRequired: true, serialRequired: true, gstDefaultRate: 18 },
    subs: [
      { key: 'smartphones', name: 'Smartphones', def: { serialRequired: true, warrantyRequired: true } },
      { key: 'feature_phones', name: 'Feature Phones', def: { serialRequired: true } },
      { key: 'mobile_accessories_sub', name: 'Mobile Accessories', def: { serialRequired: false, warrantyRequired: false } },
    ],
  },
  {
    key: 'electrical',
    name: 'Electrical',
    icon: 'tablerPlug',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, warrantyRequired: true, gstDefaultRate: 18 },
    subs: [
      { key: 'home_appliances', name: 'Home Appliances', def: { warrantyRequired: true } },
      { key: 'lighting', name: 'Lighting', def: {} },
      { key: 'fans', name: 'Fans', def: {} },
      { key: 'tools_power', name: 'Tools & Power', def: {} },
    ],
  },
  {
    key: 'hardware_tools',
    name: 'Hardware & Tools',
    icon: 'tablerTool',
    defaults: { brandRequired: true, hasVariants: false, returnWindowDays: 7, exchangeable: false, gstDefaultRate: 18 },
    subs: [
      { key: 'hand_tools', name: 'Hand Tools', def: {} },
      { key: 'power_tools', name: 'Power Tools', def: {} },
      { key: 'fittings', name: 'Fittings & Fasteners', def: {} },
    ],
  },
  {
    key: 'personal_care_beauty',
    name: 'Personal Care & Beauty',
    icon: 'tablerSpray',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 15, exchangeable: false, expiryTracked: true, gstDefaultRate: 18 },
    subs: [
      { key: 'skincare', name: 'Skincare', def: { expiryTracked: true, shelfLifeDays: 730 } },
      { key: 'haircare', name: 'Haircare', def: { expiryTracked: true } },
      { key: 'fragrance', name: 'Fragrance', def: { expiryTracked: true } },
    ],
  },
  {
    key: 'household_home',
    name: 'Household & Home',
    icon: 'tablerHome',
    defaults: { brandRequired: false, hasVariants: false, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [
      { key: 'cleaning', name: 'Cleaning Supplies', def: {} },
      { key: 'kitchenware', name: 'Kitchenware', def: {} },
      { key: 'storage', name: 'Storage & Organisation', def: {} },
    ],
  },
  {
    key: 'beverages',
    name: 'Beverages',
    icon: 'tablerGlassFull',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 1, expiryTracked: true, gstDefaultRate: 12 },
    subs: [
      { key: 'water_soft_drinks', name: 'Water & Soft Drinks', def: { expiryTracked: true } },
      { key: 'juice', name: 'Juices', def: { expiryTracked: true, shelfLifeDays: 180 } },
      { key: 'tea_coffee', name: 'Tea & Coffee', def: { expiryTracked: true } },
    ],
  },
  {
    key: 'bakery_sweets',
    name: 'Bakery & Sweets',
    icon: 'tablerCake',
    defaults: { brandRequired: false, hasVariants: true, returnWindowDays: 0, exchangeable: false, expiryTracked: true, gstDefaultRate: 5 },
    subs: [
      { key: 'cakes_pastries', name: 'Cakes & Pastries', def: { shelfLifeDays: 2 } },
      { key: 'sweets_mithai', name: 'Sweets & Mithai', def: { shelfLifeDays: 7 } },
    ],
  },
  {
    key: 'stationery_books',
    name: 'Stationery & Books',
    icon: 'tablerNotebook',
    defaults: { brandRequired: true, hasVariants: false, returnWindowDays: 7, gstDefaultRate: 12 },
    subs: [
      { key: 'books', name: 'Books', def: {} },
      { key: 'school_stationery', name: 'School Stationery', def: {} },
      { key: 'office_supplies', name: 'Office Supplies', def: {} },
    ],
  },
  {
    key: 'toys_kids',
    name: 'Toys & Kids',
    icon: 'tablerToyBrick',
    defaults: { brandRequired: true, hasVariants: false, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [{ key: 'toys', name: 'Toys' }, { key: 'baby_care', name: 'Baby Care' }],
  },
  {
    key: 'sports_fitness',
    name: 'Sports & Fitness',
    icon: 'tablerDumbbell',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, warrantyRequired: true, gstDefaultRate: 18 },
    subs: [
      { key: 'fitness_equipment', name: 'Fitness Equipment', def: { warrantyRequired: true } },
      { key: 'sportswear', name: 'Sportswear', def: {} },
      { key: 'outdoor', name: 'Outdoor', def: {} },
    ],
  },
  {
    key: 'auto_parts',
    name: 'Auto Parts & Accessories',
    icon: 'tablerCar',
    defaults: { brandRequired: true, hasVariants: false, returnWindowDays: 7, vehicleFitmentRequired: true, gstDefaultRate: 28 },
    subs: [
      { key: 'engine_parts', name: 'Engine Parts' },
      { key: 'electrical_auto', name: 'Electrical' },
      { key: 'accessories_auto', name: 'Accessories' },
    ],
  },
  {
    key: 'pharmacy_healthcare',
    name: 'Pharmacy & Healthcare',
    icon: 'tablerPill',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 0, exchangeable: false, expiryTracked: true, prescriptionRequired: false, gstDefaultRate: 12 },
    subs: [
      { key: 'prescription_medicines', name: 'Prescription Medicines', def: { prescriptionRequired: true, shelfLifeDays: 730 } },
      { key: 'otc', name: 'Over the Counter', def: { expiryTracked: true } },
      { key: 'personal_health', name: 'Personal Health', def: {} },
    ],
  },
  {
    key: 'pet_supplies',
    name: 'Pet Supplies',
    icon: 'tablerPaw',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, expiryTracked: true, gstDefaultRate: 18 },
    subs: [
      { key: 'pet_food', name: 'Pet Food', def: { expiryTracked: true } },
      { key: 'pet_accessories', name: 'Pet Accessories', def: {} },
    ],
  },
  {
    key: 'furniture_decor',
    name: 'Furniture & Home Decor',
    icon: 'tablerArmchair',
    defaults: { brandRequired: false, hasVariants: true, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [
      { key: 'living_room', name: 'Living Room' },
      { key: 'bedroom', name: 'Bedroom' },
      { key: 'kitchen_furniture', name: 'Kitchen' },
      { key: 'home_decor', name: 'Home Decor' },
    ],
  },
  {
    key: 'gifts_lifestyle',
    name: 'Gifts & Lifestyle',
    icon: 'tablerGift',
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [
      { key: 'gift_sets', name: 'Gift Sets' },
      { key: 'occasions', name: 'Occasions' },
      { key: 'lifestyle', name: 'Lifestyle' },
    ],
  },
  {
    key: 'other_retail',
    name: 'Other Local Retail',
    icon: 'tablerBuildingStore',
    defaults: { brandRequired: false, hasVariants: false, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [{ key: 'general', name: 'General' }],
  },
  {
    key: "home_office",
    name: "Home Office",
    icon: "tablerWorkspace",
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [
      { key: "desks", name: "Desks", def: {} },
      { key: "chairs", name: "Chairs", def: {} },
      { key: "tech", name: "Tech", def: { warrantyRequired: true } },
    ],
  },
  {
    key: "party_supplies",
    name: "Party & Events",
    icon: "tablerGift",
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [
      { key: "decorations", name: "Decorations", def: {} },
      { key: "catering", name: "Catering", def: {} },
      { key: "rentals", name: "Rentals", def: {} },
    ],
  },
  {
    key: "seasonal",
    name: "Seasonal",
    icon: "tablerSeasonal",
    defaults: { brandRequired: true, hasVariants: true, returnWindowDays: 7, gstDefaultRate: 18 },
    subs: [
      { key: "holiday_decoration", name: "Holiday Decoration", def: {} },
      { key: "seasonal_food", name: "Seasonal Food", def: {} },
      { key: "gift_items", name: "Gift Items", def: {} },
    ],
  },
];

// ---------------------------------------------------------------------------
// 4. GST rates (BR-41)
// ---------------------------------------------------------------------------

const EFFECTIVE_FROM = new Date('2017-07-01T00:00:00Z');

/**
 * Slugs must be set explicitly in this seed.
 *
 * `slugGenerator` is a `pre('save')` hook, so it does NOT fire on `findOneAndUpdate`.
 * Without an explicit slug every upserted document lands with `slug: null` and the
 * unique index rejects the second one with `E11000 duplicate key ... slug: null`.
 *
 * This mirrors the plugin's transformation closely enough that a later `.save()` on a
 * seeded document produces the same value.
 */
const slugify = (value) =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/\s/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const TAX_RATES = [
  ['0', 0, 'Nil rated / essentials'],
  ['0.25', 0.25, 'Precious metals, jewellery, diamonds'],
  ['3', 3, 'Gold, silver, jewellery'],
  ['5', 5, 'Essentials, groceries, medicines, small restaurants, apparel under Rs 1000'],
  ['12', 12, 'Processed food, medicines, mobile phones, restaurant food'],
  ['18', 18, 'Most goods and services'],
  ['28', 28, 'Luxury items, cars, tobacco, cement, air conditioners'],
];

// ---------------------------------------------------------------------------
// 5. subscription plans
// ---------------------------------------------------------------------------

const SUBSCRIPTION_PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    description: 'For single-outlet stores getting started',
    amount: 999,
    billingPeriod: 'monthly',
    trialDays: 14,
    features: ['1 outlet', '100 products', '5 staff', 'Basic analytics'],
    maxOutlets: 1,
    maxProducts: 100,
    maxStaff: 5,
    isDefault: true,
    status: 'active',
    sortOrder: 1,
  },
  {
    name: 'Growth',
    slug: 'growth',
    description: 'For growing multi-outlet chains',
    amount: 2999,
    billingPeriod: 'monthly',
    trialDays: 7,
    features: ['5 outlets', '1000 products', '25 staff', 'Advanced analytics', 'Priority support'],
    maxOutlets: 5,
    maxProducts: 1000,
    maxStaff: 25,
    isDefault: false,
    status: 'active',
    sortOrder: 2,
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    description: 'For large chains with custom needs',
    amount: 9999,
    billingPeriod: 'monthly',
    trialDays: 0,
    features: ['Unlimited outlets', 'Unlimited products', 'Unlimited staff', 'Custom analytics', 'Dedicated support', 'API access'],
    maxOutlets: 0,
    maxProducts: 0,
    maxStaff: 0,
    isDefault: false,
    status: 'active',
    sortOrder: 3,
  },
];

// ---------------------------------------------------------------------------
// 6. a starter brand set
// ---------------------------------------------------------------------------

const BRANDS = [
  { name: 'Samsung', aliases: ['samsung', 'SAMSUNG'], categories: ['electronics', 'mobile_accessories'] },
  { name: 'Apple', aliases: ['apple', 'APPLE'], categories: ['electronics', 'mobile_accessories'] },
  { name: 'Xiaomi', aliases: ['xiaomi', 'mi'], categories: ['electronics', 'mobile_accessories'] },
  { name: 'Philips', aliases: ['philips'], categories: ['electrical', 'personal_care_beauty', 'household_home'] },
  { name: 'Nike', aliases: ['nike'], categories: ['clothing_fashion', 'footwear', 'sports_fitness'] },
  { name: 'Adidas', aliases: ['adidas'], categories: ['footwear', 'sportswear'] },
  { name: 'Levis', aliases: ['levis', "levi's"], categories: ['mens', 'womens'] },
  { name: 'Amul', aliases: ['amul'], categories: ['dairy', 'bakery'] },
  { name: 'Fortune', aliases: ['fortune'], categories: ['oils_ghee'] },
  { name: 'Colgate', aliases: ['colgate'], categories: ['oral_care'] },
];

// ---------------------------------------------------------------------------

const wipe = async () => {
  console.log('  wiping stores taxonomy...');
  await StoreSubcategory.deleteMany({});
  await StoreCategory.deleteMany({});
  await StoreAttributeTemplate.deleteMany({});
  await StoreBrand.deleteMany({});
  await StoreSubscriptionPlan.deleteMany({});
  await TaxConfiguration.deleteMany({});
  await Vertical.deleteOne({ key: 'stores' });
};

const run = async () => {
  const isWipe = process.argv.includes('--wipe');
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI);

  if (isWipe) await wipe();

  // -- vertical --------------------------------------------------------------
  await Vertical.findOneAndUpdate({ key: VERTICAL.key }, { $set: VERTICAL }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
  console.log('  vertical           : stores');

  // -- attribute templates ----------------------------------------------------
  const templateBySlug = {};
  for (const t of ATTRIBUTE_TEMPLATES) {
    const saved = await StoreAttributeTemplate.findOneAndUpdate(
      { slug: t.slug },
      { $set: { ...t, slug: t.slug || slugify(t.name), status: true } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    templateBySlug[t.slug] = saved._id;
  }
  console.log('  attribute templates: ' + ATTRIBUTE_TEMPLATES.length);

  // -- categories and subcategories -------------------------------------------
  const categoryByKey = {};
  let subCount = 0;

  for (let i = 0; i < CATEGORIES.length; i += 1) {
    const c = CATEGORIES[i];
    const category = await StoreCategory.findOneAndUpdate(
      { key: c.key },
      { $set: { key: c.key, name: c.name, slug: slugify(c.name), icon: c.icon, sortOrder: (i + 1) * 10, status: true } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    categoryByKey[c.key] = category._id;

    for (let s = 0; s < c.subs.length; s += 1) {
      const sub = c.subs[s];
      // eslint-disable-next-line no-await-in-loop
      await StoreSubcategory.findOneAndUpdate(
        { key: sub.key },
        {
$set: {
              key: sub.key,
              name: sub.name,
              slug: slugify(sub.name),
              category: category._id,
            sortOrder: (s + 1) * 10,
            // the category's defaults, with the subcategory's overrides merged on top.
            // THIS MERGE IS THE WHOLE OF BR-26.
            categoryDefaults: { ...(c.defaults || {}), ...(sub.def || {}) },
            status: true,
          },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      );
      subCount += 1;
    }
  }
  console.log('  categories         : ' + CATEGORIES.length);
  console.log('  subcategories      : ' + subCount);

  // -- GST rates --------------------------------------------------------------
  let taxCount = 0;
  for (const [code, rate, description] of TAX_RATES) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await TaxConfiguration.findOne({ code, effectiveFrom: EFFECTIVE_FROM });
    if (!existing) {
      // eslint-disable-next-line no-await-in-loop
      await TaxConfiguration.create({
        code,
        gstRate: rate,
        description,
        effectiveFrom: EFFECTIVE_FROM,
        isDefault: rate === 18,
        status: true,
      });
      taxCount += 1;
    }
  }
  console.log('  tax rates          : ' + TAX_RATES.length + ' (' + taxCount + ' created)');

  // -- subscription plans ------------------------------------------------------
  let planCount = 0;
  for (const p of SUBSCRIPTION_PLANS) {
    // eslint-disable-next-line no-await-in-loop
    await StoreSubscriptionPlan.findOneAndUpdate(
      { slug: p.slug },
      { $set: { ...p, status: 'active' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    planCount += 1;
  }
  console.log('  subscription plans : ' + planCount);

  // -- brands -----------------------------------------------------------------
let brandCount = 0;
  for (const b of BRANDS) {
    const catIds = (b.categories || []).map((k) => categoryByKey[k]).filter(Boolean);
    // eslint-disable-next-line no-await-in-loop
    await StoreBrand.findOneAndUpdate(
      { name: b.name },
      {
        $set: {
          name: b.name,
          slug: slugify(b.name),
          aliases: b.aliases || [],
          categories: catIds,
          // Seeded approved so the demo catalogue can filter by brand without an
          // admin session. A real brand arrives via the request queue, pending.
          status: 'approved',
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
    brandCount += 1;
  }
  // Counted, not inferred from `isNew` — that flag does not survive findOneAndUpdate.
  console.log('  brands             : ' + brandCount);

  // -- summary ----------------------------------------------------------------
  const counts = {
    categories: await StoreCategory.countDocuments({}),
    subcategories: await StoreSubcategory.countDocuments({}),
    templates: await StoreAttributeTemplate.countDocuments({}),
    brands: await StoreBrand.countDocuments({}),
    taxRates: await TaxConfiguration.countDocuments({}),
  };
  console.log('\n  totals: ' + JSON.stringify(counts));

  const vertical = await Vertical.findOne({ key: 'stores' });
  console.log('  codEnabled         : ' + vertical.settings.enabledFeatures.codEnabled + '  (launch: off)');
  console.log('  customerSubs       : ' + vertical.settings.enabledFeatures.customerSubscriptions + '  (launch: off)');
  console.log('  usesSharedDelivery : ' + vertical.usesSharedDelivery + '  (BR-05)');

  console.log('\nSTORES TAXONOMY SEEDED');
};

(async () => {
  try {
    await run();
    process.exit(0);
  } catch (error) {
    console.error('\nseed failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();