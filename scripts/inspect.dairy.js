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

const mongoose = require('mongoose');

const inspect = async () => {
  require('dotenv').config();
  const url = process.env.MONGODB_URL || process.env.MONGODB_URI;

  if (!url) {
    console.log('MONGODB_URL not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(url, { serverSelectionTimeoutMS: 5000 });
  } catch (e) {
    console.log('connect failed:', e.message.slice(0, 120));
    process.exit(1);
  }

  const db = mongoose.connection.db;
  const users = db.collection('users');
  const businesses = db.collection('businesses');
  const dairyDrivers = db.collection('dairydrivers');
  const verticals = db.collection('verticals');

  console.log('users total          :', await users.countDocuments());
  console.log('dairy users          :', await users.countDocuments({ role: { $in: ['dairyPartner', 'dairyDriver'] } }));
  console.log('businesses           :', await businesses.countDocuments());
  console.log('dairyDrivers         :', await dairyDrivers.countDocuments());
  console.log('verticals            :', await verticals.countDocuments());

  process.exit(0);
};

inspect();