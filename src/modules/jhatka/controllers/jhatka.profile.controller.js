const catchAsync = require('../../../utils/catchAsync');
const profileService = require('../services/jhatka.profile.service');

const profileMe = catchAsync(async (req, res) => {
  res.send(await profileService.getLoginInfo(req.user._id));
});

const availableRoles = catchAsync(async (req, res) => {
  res.send(await profileService.getAvailableRoles(req.user._id));
});

const switchRole = catchAsync(async (req, res) => {
  res.send(await profileService.switchRole(req.user._id, req.body.role));
});

module.exports = {
  profileMe,
  availableRoles,
  switchRole,
};
