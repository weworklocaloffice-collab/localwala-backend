const path = require('path');
const API = 'C:/localwala/AppSourceCode/API';
process.chdir(API);

const svc = require(path.resolve(API, 'src/kernel/geographic/services/geographic.service'));

let failed = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  failed++;
  console.log('  FAIL ' + m);
};
const eq = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

// assertEquals(actual, expected, label)
const is = (actual, expected, label) => {
  if (actual === expected) ok(label + ' -> ' + actual);
  else bad(label + ' -> got ' + actual + ', expected ' + expected);
};

console.log('\n[1] haversine against known distances');
const lp = svc.haversineMeters(-0.1278, 51.5074, 2.3522, 48.8566);
if (eq(lp, 344000, 5000)) ok('London -> Paris = ' + Math.round(lp / 1000) + ' km (expected ~344)');
else bad('London -> Paris = ' + Math.round(lp) + ' m, expected ~344000');

const d = svc.haversineMeters(78.4867, 17.385, 72.8777, 19.076);
if (d > 550000 && d < 700000)
  ok('Hyderabad -> Mumbai = ' + Math.round(d / 1000) + ' km (band 550-700)');
else bad('Hyderabad -> Mumbai = ' + Math.round(d) + ' m');

const oneDeg = svc.haversineMeters(0, 0, 0, 1);
if (eq(oneDeg, 111195, 500)) ok('1 deg latitude = ' + Math.round(oneDeg) + ' m (expected ~111195)');
else bad('1 deg latitude = ' + Math.round(oneDeg));

is(svc.haversineMeters(1, 1, 1, 1), 0, 'identical points');

console.log('\n[2] BR-08 check-in geofence (200 m default)');
const base = [78.4867, 17.385];
const near = svc.distanceBetween(base, [78.4867, 17.385 + 0.0015]);
const far = svc.distanceBetween(base, [78.4867, 17.385 + 0.005]);
if (near > 0 && near < 200) ok('167 m  -> INSIDE  the geofence');
else bad('near = ' + Math.round(near) + ' m, should be inside 200');
if (far > 200) ok('556 m  -> OUTSIDE the geofence');
else bad('far = ' + Math.round(far) + ' m, should be outside 200');
is(svc.distanceBetween([1, 2], null), null, 'null coordinate -> null');
is(svc.distanceBetween([1], [2, 3]), null, 'short array -> null');

console.log('\n[3] pointInRings: axis-aligned square');
const square = [
  [78.0, 17.0],
  [79.0, 17.0],
  [79.0, 18.0],
  [78.0, 18.0],
  [78.0, 17.0],
];
is(svc.pointInRings([square], 78.5, 17.5), true, 'centre');
is(svc.pointInRings([square], 80.5, 17.5), false, 'far point outside');
is(svc.pointInRings([square], 77.5, 17.5), false, 'west of it, outside');
is(svc.pointInRings([square], 78.5, 19.5), false, 'north of it, outside');
is(svc.pointInRings([square], 78.5, 16.5), false, 'south of it, outside');

console.log('\n[4] a bare ring of vertices is accepted (the common call-site mistake)');
is(svc.pointInRings(square, 78.5, 17.5), true, 'bare ring, centre');
is(svc.pointInRings(square, 80.5, 17.5), false, 'bare ring, outside');

console.log('\n[5] holes EXCLUDE');
const withHole = [
  [78.0, 17.0],
  [79.0, 17.0],
  [79.0, 18.0],
  [78.0, 18.0],
  [78.0, 17.0],
  [78.4, 17.4],
  [78.6, 17.4],
  [78.6, 17.6],
  [78.4, 17.6],
  [78.4, 17.4],
];
is(svc.pointInRings([withHole], 78.2, 17.2), true, 'inside outer, outside hole');
is(svc.pointInRings([withHole], 78.5, 17.5), false, 'inside the hole -> excluded');
is(svc.pointInRings([withHole], 78.25, 17.25), true, 'just outside the hole');

console.log('\n[6] concave L-shape: the case a bounding-box test gets wrong');
const L = [
  [78.0, 17.0],
  [78.5, 17.0],
  [78.5, 17.5],
  [79.0, 17.5],
  [79.0, 18.0],
  [78.0, 18.0],
  [78.0, 17.0],
];
is(svc.pointInRings([L], 78.25, 17.25), true, 'vertical arm   (lat 17-17.5, lng 78-78.5)');
is(svc.pointInRings([L], 78.75, 17.75), true, 'horizontal arm (lat 17.5-18,  lng 78-79)');
is(svc.pointInRings([L], 78.75, 17.25), false, 'notch          (lat 17-17.5,  lng 78.5-79)');
is(svc.pointInRings([L], 78.25, 17.75), true, 'top-left, inside');

console.log('\n[7] MultiPolygon: each part tested independently');
const twoParts = [
  [square], // part 1: the square above
  [
    [
      [80.0, 17.0],
      [81.0, 17.0],
      [81.0, 18.0],
      [80.0, 18.0],
      [80.0, 17.0],
    ],
  ], // part 2
];
is(svc.pointInRings(twoParts, 78.5, 17.5), true, 'inside part 1');
is(svc.pointInRings(twoParts, 80.5, 17.5), true, 'inside part 2');
is(svc.pointInRings(twoParts, 79.5, 17.5), false, 'in the gap between parts');

console.log('\n[8] degenerate and malformed input returns false, never throws');
is(svc.pointInRings([], 1, 1), false, 'empty array');
is(svc.pointInRings(null, 1, 1), false, 'null');
is(svc.pointInRings([[[]]], 1, 1), false, 'ring with no vertices');
is(svc.pointInRings([[[78, 17]]], 1, 1), false, 'single-vertex ring');
is(
  svc.pointInRings(
    [
      [
        [NaN, 17],
        [79, 17],
        [79, 18],
        [NaN, 17],
      ],
    ],
    78.5,
    17.5
  ),
  false,
  'NaN vertex'
);
is(svc.pointInRings([[['a', 'b']]], 1, 1), false, 'non-numeric vertex');

console.log('\n[9] assertClosedRings');
try {
  svc.assertClosedRings([
    [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
  ]);
  bad('unclosed ring should throw');
} catch (e) {
  ok('unclosed ring rejected -> "' + e.message + '"');
}
try {
  svc.assertClosedRings([
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ]);
  bad('unclosed 4-vertex should throw');
} catch (e) {
  ok('4-vertex unclosed ring rejected');
}
try {
  svc.assertClosedRings([
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ]);
  ok('closed 4-vertex ring accepted');
} catch (e) {
  bad('closed ring rejected: ' + e.message);
}
try {
  svc.assertClosedRings([]);
  ok('empty allowed (boundary may be absent)');
} catch (e) {
  bad('empty should be allowed');
}

console.log('\n[10] approximateCentroid across every accepted shape');
const c1 = svc.approximateCentroid([square]);
if (eq(c1[0], 78.5) && eq(c1[1], 17.5)) ok('rings form -> [' + c1[0] + ', ' + c1[1] + ']');
else bad('rings form centroid = ' + JSON.stringify(c1));

const c2 = svc.approximateCentroid(square);
if (eq(c2[0], 78.5) && eq(c2[1], 17.5))
  ok('bare ring form -> [' + c2[0] + ', ' + c2[1] + '] (same answer)');
else bad('bare ring centroid = ' + JSON.stringify(c2));

const c3 = svc.approximateCentroid(twoParts);
if (eq(c3[0], 78.5) && eq(c3[1], 17.5))
  ok('MultiPolygon -> uses part 1 only, [' + c3[0] + ', ' + c3[1] + ']');
else bad('MultiPolygon centroid = ' + JSON.stringify(c3) + ', expected part 1 [78.5,17.5]');

is(svc.approximateCentroid([]), null, 'empty -> null');
is(svc.approximateCentroid(null), null, 'null -> null');

console.log('\n[11] centroid skips bad vertices instead of producing NaN');
const c4 = svc.approximateCentroid([
  [
    [78, 17],
    [NaN, NaN],
    [80, 19],
    [78, 17],
  ],
]);
if (c4 && Number.isFinite(c4[0]) && Number.isFinite(c4[1]))
  ok('NaN vertex skipped -> [' + c4[0] + ', ' + c4[1] + ']');
else bad('NaN handling gave ' + JSON.stringify(c4));

console.log(
  '\n' +
    (failed === 0 ? 'ALL GEOMETRY CHECKS PASSED (' + 'PASS' + ')' : failed + ' CHECK(S) FAILED')
);
process.exit(failed === 0 ? 0 : 1);
