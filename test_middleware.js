const T = require('./src/modules/jhatka/middlewares/jhatka.tenant');
const auth = T.jhatkaAuth();
console.log('auth type:', typeof auth);
console.log('auth is function:', typeof auth === 'function');

const arr = [T.jhatkaAuth(), T.requireActiveOutlet, T.requireComplianceCurrent];
console.log('array types:', arr.map(x => typeof x));
console.log('all functions:', arr.every(x => typeof x === 'function'));

const express = require('express');
const router = express.Router();
router.get('/test', ...arr, (req, res) => res.send('ok'));
console.log('route registered successfully');