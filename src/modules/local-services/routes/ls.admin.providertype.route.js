const express = require('express');
const validate = require('../../../middlewares/validate');
const webAuth = require('../../../middlewares/webAuth');
const controller = require('../controllers/ls.providertype.controller');
const V = require('../validations/ls.providertype.validation');

const router = express.Router();

router
  .route('/')
  .get(webAuth('localservices_catalog_read'), controller.listAdmin)
  .post(webAuth('localservices_catalog_write'), validate(V.createProviderType), controller.create);

router
  .route('/:id')
  .patch(webAuth('localservices_catalog_write'), validate(V.updateProviderType), controller.update);

module.exports = router;
