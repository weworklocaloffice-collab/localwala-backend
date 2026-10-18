/*
 * Confirms a rider's inherited coordinates actually persist and are queryable.
 *
 * The field had to be added to the schema for this to work at all: `registerDriver`
 * has always written `location`, but with no `location` path on the model Mongoose
 * strict mode dropped it on every save. This checks the round trip and that the
 * `2dsphere` index is usable, which a plain `toEqual` on the object would not.
 *
 * Leaves nothing behind.
 *
 * Usage: `node scripts/verify.driver.location.probe.js`
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { User, Business, DairyDriver } = require('../src/models');

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URL || process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000,
  });

  const tag = Date.now().toString().slice(-6);
  let user;
  let business;
  let driver;

  try {
    console.log('\n1. The model accepts a point');

    user = await User.create({
      firstName: 'Geo', lastName: 'Probe', countryCode: '+91',
      mobile: Number(`7${tag}1`), email: `geo${tag}@example.com`,
      password: 'Geo@12345', role: 'dairyDriver', status: true,
    });
    business = await Business.create({
      vertical: 'dairy', businessModel: 'direct', name: `Geo Outlet ${tag}`,
      owner: user._id, ownDeliveryPartner: true, verified: true, status: true,
    });

    const COORDS = [77.5946, 12.9716];
    driver = await DairyDriver.create({
      userId: user._id,
      business: business._id,
      city: new mongoose.Types.ObjectId(),
      locality: new mongoose.Types.ObjectId(),
      location: { type: 'Point', coordinates: COORDS },
    });

    const fresh = new DairyDriver({ location: { type: 'Point', coordinates: COORDS } });
    check('an unsaved driver keeps the point', Boolean(fresh.toObject().location),
      JSON.stringify(fresh.toObject().location));

    console.log('\n2. It survives a real save and re-read');

    const back = await DairyDriver.findById(driver._id).lean();
    check('the point is stored', Boolean(back.location), JSON.stringify(back.location));
    check('the type is Point', back.location && back.location.type === 'Point');
    check(
      'the coordinates round-trip exactly',
      back.location
      && Array.isArray(back.location.coordinates)
      && back.location.coordinates[0] === COORDS[0]
      && back.location.coordinates[1] === COORDS[1],
      JSON.stringify(back.location && back.location.coordinates)
    );

    console.log('\n3. The 2dsphere index is usable');

    // A stored point that cannot be geo-queried is close to useless, so this checks
    // the index rather than just the shape.
    //
    // `find().limit().length` rather than `countDocuments`: `countDocuments` runs an
    // aggregation, and Mongo rejects geo operators that need sorting in that context
    // (`$geoNear, $near, and $nearSphere are not allowed in this context`). Counting
    // is not worth fighting for here — a small limit gives the same answer.
    const EARTH_R = 6378100;
    const metresToRadians = (m) => m / EARTH_R;

    const within = await DairyDriver.find({
      location: {
        $geoWithin: { $centerSphere: [COORDS, metresToRadians(500)] },
      },
    })
      .select('_id')
      .limit(5);
    check('a $geoWithin query finds the rider', within.length >= 1, `found ${within.length}`);

    const withinFar = await DairyDriver.find({
      location: {
        $geoWithin: { $centerSphere: [[13.0827, 80.2707], metresToRadians(100)] },
      },
    })
      .select('_id')
      .limit(5);
    check('a distant $geoWithin query does not', withinFar.length === 0, `found ${withinFar.length}`);

    // The reason a point is stored rather than just a lat/lng pair: nearest-first
    // ordering, which is what picking a rider for a run needs.
    const nearest = await DairyDriver.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: COORDS },
          $maxDistance: 5000,
        },
      },
    })
      .select('_id')
      .limit(1);
    check('a sorted $near query returns the rider', nearest.length === 1, `got ${nearest.length}`);

    console.log('\n4. A rider with no point is still valid');

    // An outlet may have no coordinates, and inventing a position for a rider would
    // be worse than admitting we do not know it. A missing point must not fail
    // validation, and must not break the index.
    const noPoint = await DairyDriver.create({
      userId: new mongoose.Types.ObjectId(),
      business: business._id,
      city: new mongoose.Types.ObjectId(),
      locality: new mongoose.Types.ObjectId(),
    });
    check('a driver with no location saves', Boolean(noPoint._id));
    const stillQueryable = await DairyDriver.find({
      location: {
        $geoWithin: { $centerSphere: [COORDS, metresToRadians(500)] },
      },
    })
      .select('_id')
      .limit(5);
    check('and the index still works alongside it', stillQueryable.length >= 1, `found ${stillQueryable.length}`);
    await DairyDriver.deleteOne({ _id: noPoint._id });
  } catch (error) {
    failures += 1;
    console.log(`\n  UNCAUGHT: ${error.message} >>> ${error.stack}`);
  } finally {
    try {
      if (driver) await DairyDriver.deleteOne({ _id: driver._id });
      if (business) await Business.deleteOne({ _id: business._id });
      if (user) await User.deleteOne({ _id: user._id });
    } catch (error) {
      console.log(`  cleanup warning: ${error.message}`);
    }
  }

  console.log(
    failures === 0
      ? '\nRIDER COORDINATES PERSIST AND ARE QUERYABLE'
      : `\n${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
};

run().catch((error) => {
  console.error('verification failed:', error.message);
  process.exit(1);
});