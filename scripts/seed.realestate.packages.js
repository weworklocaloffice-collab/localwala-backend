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
 * modification, or use of this source code is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const mongoose = require('mongoose');
const RealEstateListingPackage = require('../API/src/modules/realestate/models/realestate.listing.package.model');

// Seed packages that ship with the Real Estate vertical.
// These are the catalog items a vendor may purchase to gain entitlement to list.

const seedPackages = [
  {
    code: 'FREE',
    name: 'Free Starter',
    description: 'Free package for new vendors to list up to 3 properties.',
    price: 0,
    listingCount: 3,   // 3 listings
    durationDays: 30,  // 30 days validity
    features: ['Basic listings', 'Email support'],
    limits: { maxImages: 5, maxVideos: 1, allowFeatured: false },
    sortOrder: 1,
    status: true,
  },
  {
    code: 'BASIC',
    name: 'Basic',
    description: 'Entry-level package for individual vendors.',
    price: 49900, // ₹499.00 in paise
    listingCount: 10, // 10 listings
    durationDays: 60, // 60 days validity
    features: ['Basic listings', 'Priority support', 'Featured slot'],
    limits: { maxImages: 15, maxVideos: 3, allowFeatured: true },
    sortOrder: 2,
    status: true,
  },
  {
    code: 'PRO',
    name: 'Professional',
    description: 'Package for growing agencies.',
    price: 199000, // ₹1,999.00 in paise
    listingCount: 50, // 50 listings
    durationDays: 180, // 180 days validity
    features: ['Unlimited images', 'Video support', 'API access', 'Dedicated support'],
    limits: { maxImages: 100, maxVideos: 20, allowFeatured: true },
    sortOrder: 3,
    status: true,
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'Package for developers and large agencies.',
    price: 499000, // ₹4,999.00 in paise
    listingCount: null, // unlimited
    durationDays: 365, // 365 days validity
    features: ['Unlimited listings', 'White-label', 'Custom API', 'Account manager'],
    limits: { maxImages: -1, maxVideos: -1, allowFeatured: true },
    sortOrder: 4,
    status: true,
  },
];

module.exports = async function seedRealEstatePackages() {
  let created = 0;
  let updated = 0;

  for (const pkgData of seedPackages) {
    // Upsert: create if not exists (by code), update if it does
    const [doc, didCreate] = await RealEstateListingPackage.findAndModify(
      { code: pkgData.code },
      [], // sort
      { $setOnInsert: {
          code: pkgData.code,
          name: pkgData.name,
          description: pkgData.description,
          price: pkgData.price,
          listingCount: pkgData.listingCount,
          durationDays: pkgData.durationDays,
          features: pkgData.features,
          limits: pkgData.limits,
          sortOrder: pkgData.sortOrder,
          status: pkgData.status,
        },
        $inc: { _update_count: 1 } // just a harmless increment to track runs
      },
      { new: true, upsert: true, runValidators: true }
    );

    if (didCreate) {
      created += 1;
    } else {
      updated += 1;
    }
  }

  return { created, updated };
};