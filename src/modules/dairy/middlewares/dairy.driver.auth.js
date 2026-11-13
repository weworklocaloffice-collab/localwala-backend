/*
 * LocalWala - Local Commerce & Delivery Platform
 *
 * Driver operational endpoints require owner approval. Authentication and role
 * rights still run first; the profile check is an additional server-side gate,
 * so hiding driver actions in Flutter is never the security boundary.
 */

const { status: httpStatus } = require('http-status');
const appAuth = require('../../../middlewares/appAuth');
const { DairyDriver } = require('../../../models');
const ApiError = require('../../../utils/ApiError');

const driverAuth = (...requiredRights) => async (req, res, next) => {
  return appAuth(...requiredRights)(req, res, async (authError) => {
    if (authError) return next(authError);

    try {
      const driver = await DairyDriver.findOne({ userId: req.user._id }).select(
        'status activeStatus isBlocked approvalStatus'
      );
      if (!driver) {
        return next(new ApiError(httpStatus.FORBIDDEN, 'Complete driver onboarding before using delivery tools'));
      }

      if (driver.approvalStatus !== 'approved' || driver.activeStatus !== true || driver.isBlocked === true || driver.status !== true) {
        const message = driver.approvalStatus === 'rejected'
          ? 'Your outlet rejected this driver application. Contact the outlet for details.'
          : driver.isBlocked === true
            ? 'Your delivery access is paused by the outlet.'
            : 'Your driver profile is waiting for outlet approval.';
        return next(new ApiError(httpStatus.FORBIDDEN, message));
      }

      req.dairyDriver = driver;
      return next();
    } catch (error) {
      return next(error);
    }
  });
};

module.exports = driverAuth;
