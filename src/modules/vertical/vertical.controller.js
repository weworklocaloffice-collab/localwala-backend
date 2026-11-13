const catchAsync = require('../../utils/catchAsync');
const { Vertical } = require('../../models');

const list = catchAsync(async (req, res) => {
  const verticals = await Vertical.find({ status: true }).sort({ sortOrder: 1, name: 1 }).select('key name');
  res.send({ verticals });
});

module.exports = { list };