const express = require('express');
const validate = require('../../../middlewares/validate');
const controller = require('../controllers/header.banner.controller');
const validation = require('../validators/header.banner.validation');

const router = express.Router();

router.get(
  '/resolve',
  controller.resolve
);

module.exports = router;