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
 * jhatka.seed.js — idempotent seed for the Jhatka vertical. Phase 1k.
 *
 * Run: node scripts/jhatka.seed.js
 *
 * Safe to re-run: uses upserts on unique keys (code, licenceNumber, batchNumber, etc.)
 * Does NOT create demo data that would pollute production — only reference data
 * required for the vertical to function:
 *   - 4 launch root categories (chicken, mutton, fish_seafood, eggs)
 *   - Quality rejection reasons
 *   - Reserved subcategory keys (feature-flagged)
 *   - Default commission rules (platform defaults)
 *   - Default tolerance settings (via config, not seed)
 */

const mongoose = require('mongoose');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REPO_ROOT = path.join(__dirname, '..');
require(path.join(REPO_ROOT, 'src', 'models', 'index.js')); // registers all models

const {
  JhatkaCategory,
  JhatkaQualityRejectionReason,
  JhatkaCommissionRule,
  Business,
  Vertical,
} = require('../src/models');

async function connect() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/localwala';
  await mongoose.connect(uri, { autoIndex: false });
  console.log('Connected to MongoDB');
}

async function seedCategories() {
  console.log('\n--- Seeding launch root categories ---');

  const roots = [
    { code: 'chicken', name: 'Chicken', displayOrder: 1, description: 'Fresh chicken cuts and portions' },
    { code: 'mutton', name: 'Mutton', displayOrder: 2, description: 'Fresh mutton/goat cuts and portions' },
    { code: 'fish_seafood', name: 'Fish & Seafood', displayOrder: 3, description: 'Fresh fish, prawns, and seafood' },
    { code: 'eggs', name: 'Eggs', displayOrder: 4, description: 'Fresh eggs (count-based, no weighing)' },
  ];

  for (const r of roots) {
    const existing = await JhatkaCategory.findOne({ code: r.code, parent: { $exists: false } });
    if (existing) {
      console.log(`  ${r.code}: exists (${existing._id})`);
    } else {
      const cat = new JhatkaCategory({
        code: r.code,
        name: r.name,
        displayOrder: r.displayOrder,
        description: r.description,
        status: 'active',
        // parent: undefined = root
      });
      await cat.save();
      console.log(`  ${r.code}: created (${cat._id})`);
    }
  }

  // Reserved subcategory keys (feature-flagged, not created by default)
  const reserved = ['marinated', 'kebabs', 'ready_to_cook', 'frozen'];
  console.log('  Reserved subcategory keys (feature-flagged):', reserved.join(', '));
}

async function seedRejectionReasons() {
  console.log('\n--- Seeding quality rejection reasons ---');

  const reasons = [
    { code: 'temp_abuse', label: 'Temperature Abuse', description: 'Product received above safe temperature threshold', isActive: true },
    { code: 'off_odour', label: 'Off Odour', description: 'Unpleasant or sour smell indicating spoilage', isActive: true },
    { code: 'discoloration', label: 'Discoloration', description: 'Grey-green patches or unnatural colour', isActive: true },
    { code: 'slime', label: 'Surface Slime', description: 'Excessive slime or biofilm on surface', isActive: true },
    { code: 'packaging_damage', label: 'Packaging Damage', description: 'Torn vacuum seal, leaking tray, broken seal', isActive: true },
    { code: 'weight_short', label: 'Weight Shortfall', description: 'Received weight below ordered weight beyond tolerance', isActive: true },
    { code: 'foreign_matter', label: 'Foreign Matter', description: 'Bone fragments, plastic, metal, or other contaminants', isActive: true },
    { code: 'expired', label: 'Expired / Near Expiry', description: 'Use-by date passed or within 24 hours', isActive: true },
    { code: 'wrong_cut', label: 'Wrong Cut / Specification', description: 'Cut does not match purchase order specification', isActive: true },
    { code: 'other', label: 'Other', description: 'Any other quality issue not covered above', isActive: true },
  ];

  for (const r of reasons) {
    const existing = await JhatkaQualityRejectionReason.findOne({ code: r.code });
    if (existing) {
      console.log(`  ${r.code}: exists (${existing._id})`);
    } else {
      const reason = new JhatkaQualityRejectionReason(r);
      await reason.save();
      console.log(`  ${r.code}: created (${reason._id})`);
    }
  }
}

async function seedCommissionRules() {
  console.log('\n--- Seeding default commission rules ---');

  // Find a business to attach platform defaults to (first business)
  const biz = await Business.findOne().select('_id').lean();
  if (!biz) {
    console.log('  No business found — skipping commission rules (will be created per-business on first outlet)');
    return;
  }

  const rules = [
    {
      business: biz._id,
      type: 'platform_fee',
      rateBps: 1000, // 10%
      minOrderValuePaise: 0,
      priority: 10,
      description: 'Default platform fee on all orders',
    },
    {
      business: biz._id,
      type: 'driver_commission',
      rateBps: 1500, // 15%
      minOrderValuePaise: 0,
      priority: 5,
      description: 'Default driver commission on delivered orders',
    },
    {
      business: biz._id,
      type: 'partner_commission',
      rateBps: 500, // 5%
      minOrderValuePaise: 0,
      priority: 5,
      description: 'Default partner commission (franchise/commission_partner)',
    },
  ];

  for (const r of rules) {
    const existing = await JhatkaCommissionRule.findOne({ business: biz._id, type: r.type });
    if (existing) {
      console.log(`  ${r.type}: exists (${existing._id})`);
    } else {
      const rule = new JhatkaCommissionRule(r);
      await rule.save();
      console.log(`  ${r.type}: created (${rule._id})`);
    }
  }
}

async function seedVertical() {
  console.log('\n--- Ensuring Jhatka vertical registration ---');

  const existing = await Vertical.findOne({ key: 'jhatka' });
  if (existing) {
    console.log(`  Vertical 'jhatka' exists (${existing._id})`);
  } else {
    const vert = new Vertical({
      key: 'jhatka',
      name: 'Jhatka Fresh Meat',
      displayOrder: 10,
      isActive: true,
      models: [
        'JhatkaCategory', 'JhatkaProduct', 'JhatkaVariant', 'JhatkaYieldSpec',
        'JhatkaOutlet', 'JhatkaPartner', 'JhatkaFranchise', 'JhatkaPriceOverride',
        'JhatkaTenantRoleAssignment',
        'JhatkaSupplier', 'JhatkaSupplierDocument', 'JhatkaQualityRejectionReason',
        'JhatkaPurchaseOrder', 'JhatkaProcurementReceipt', 'JhatkaBatch',
        'JhatkaBatchAllocation', 'JhatkaInventoryItem', 'JhatkaInventoryMovement',
        'JhatkaWastage', 'JhatkaRecall',
        'JhatkaOrderItem', 'JhatkaOrder', 'JhatkaOrderStatusHistory',
        'JhatkaWeightConfirmation', 'JhatkaPreparationTicket', 'JhatkaRefund',
        'JhatkaLabel', 'JhatkaOutletVarianceFlag',
        'JhatkaSubscription', 'JhatkaSubscriptionEvent', 'JhatkaRecurringOrder',
        'JhatkaDriver', 'JhatkaDelivery', 'JhatkaDeliveryPOD', 'JhatkaDeliverySettlement',
        'JhatkaCommissionRule', 'JhatkaOperatorPayout', 'JhatkaSupplierPayable', 'JhatkaSettlement',
        'JhatkaCompliance', 'JhatkaComplaint', 'JhatkaReview', 'JhatkaPromotion',
      ],
    });
    await vert.save();
    console.log(`  Vertical 'jhatka' created (${vert._id})`);
  }
}

async function main() {
  try {
    await connect();

    await seedVertical();
    await seedCategories();
    await seedRejectionReasons();
    await seedCommissionRules();

    console.log('\n=== JHATKA SEED COMPLETE ===');
    process.exit(0);
  } catch (err) {
    console.error('SEED FAILED:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

main();