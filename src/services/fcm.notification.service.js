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
const { status: httpStatus } = require('http-status');
const admin = require('firebase-admin');
const {
  OrderNotificationTranslation,
  Restaurant,
  User,
  PushNotificationToken,
  BusinessSettings,
  Driver,
  Orders,
  DriverNewOrderStatus,
  NotificationList,
  SubscriptionTiffinPackage,
  UserPurchasedTiffinSubscription,
  KitchenOwner,
} = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const config = require('../config/config');

const checkArrayNotEmpty = require('../utils/arrayNotEmpty');
const { resolveRiderPool, buildGeoNearStage, resolveDeliveryRadius } = require('../utils/rider.pool');


/**
 * Support chat push.
 *
 * The customer opens the app, the bot answers, a human takes over and replies —
 * and without this the phone stays silent, so the reply sits unseen until the
 * customer happens to open the app. The socket only reaches a connected client;
 * a push is what makes it actually arrive.
 *
 * `roomId` travels in `data` so the app can deep-link straight into the thread
 * instead of the generic chat list.
 */
const supportChatMessage = async (userId, roomId, preview = '', thread = {}) => {
  try {
    if (!userId) return { skipped: 'no-user' };
    const tokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    ).lean();

    const registrationTokens = (tokens || []).map((t) => t.token).filter(Boolean);
    // No device registered is normal, not an error — do not throw into the
    // message-save path, which would fail the whole send.
    if (!registrationTokens.length) return { skipped: 'no-tokens' };

    // Notification bodies are rendered on lock screens. Trim hard and never send
    // an internal note here — this function is only ever called for public
    // agent replies, but truncating keeps a pasted order dump off the lockscreen.
    const body = (preview || 'New reply from support').replace(/\s+/g, ' ').slice(0, 120);

    // The app opens the thread from `supportType` + `entityId` (its route takes
    // type + typeId, not a room id), so both travel in `data`. Without them a
    // tap can only land on the generic chat list.
    const payload = {
      notification: {
        title: 'Support',
        body,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'support_chat',
        roomId: String(roomId || ''),
        supportType: String(thread.supportType || ''),
        entityId: String(thread.entityId || ''),
        extra: String(roomId || ''),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: registrationTokens,
    };

    const result = await admin.messaging().sendEachForMulticast(payload);
    return { sent: result.successCount, failed: result.failureCount };
  } catch (e) {
    // A push failure must never lose the chat message that was already saved.
    return { error: e.message };
  }
};

// Agent web push: alerts the ASSIGNED agent's browsers about customer-side
// activity (new message, new assignment, transfer offer). Reads only
// deviceType:'web' tokens, so mobile tokens are never double-hit. The panel's
// service worker renders background arrivals; foreground arrivals ping
// in-app. Fire-and-forget contract like every other push here.
const supportChatAgentAlert = async (agentId, roomId, preview = '', title = 'Support chat') => {
  try {
    if (!agentId) return { skipped: 'no-agent' };
    const PushNotificationToken = require('../models/push.notitication.token.model');
    const tokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(agentId), deviceType: 'web' },
      { token: 1 }
    ).lean();
    const registrationTokens = (tokens || []).map((t) => t.token).filter(Boolean);
    if (!registrationTokens.length) return { skipped: 'no-tokens' };
    const body = String(preview || 'New customer message').replace(/\s+/g, ' ').slice(0, 120);
    const payload = {
      notification: { title, body },
      data: {
        type: 'support_chat',
        roomId: String(roomId || ''),
        url: `/support-team/u/message/${roomId || ''}`,
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: { icon: '/favicon.ico', tag: String(roomId || 'support-chat'), renotify: true },
        fcmOptions: { link: `/support-team/u/message/${roomId || ''}` },
      },
      tokens: registrationTokens,
    };
    const result = await admin.messaging().sendEachForMulticast(payload);
    return { sent: result.successCount, failed: result.failureCount };
  } catch (e) {
    return { error: e.message };
  }
};

const sendTestNotification = async () => {
  const registrationTokens = [
    'fbY1AF89QFayoVa_BMEBF8:APA91bHwexM_sHZ-B0a8JGHCrrGVhkT_UExP3YNxgJKUb-dSTwDBBvXONFOdgbxF0-nx3iJ37eP_G4IKlUfZ5rOjVPDvTMYrWXss65Af76SRP0YqMPj3ey3ac3P0xENxHkKxrNKs9zFi',
  ];
  const randomNumber = Math.floor(Math.random() * 10 + 1);
  const payload = {
    notification: {
      title: 'EliteCanyon InfoTech',
      body: '$Testing',
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      type: 'order',
      value: `${randomNumber}`,
      extra: `${randomNumber}`,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'high_importance_channel',
        priority: 'max',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    tokens: registrationTokens,
  };
  const result = await admin.messaging().sendEachForMulticast(payload);
  return result;
};

const restaurantNewOrder = async (orderId, restaurantId, userId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { userId: 1, slug: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
    let userName = '';
    let notificationTitle = '';
    let notificationDescription = '';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { firstName: 1, lastName: 1 }
    );
    if (userInfo !== null && userInfo.firstName !== null) {
      userName = `${userInfo.firstName} ${userInfo.lastName}`;
    }
    const slugName = 'restaurant-new-order';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let translastionCode = 'en';
    const restaurantUserInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { locale: 1 }
    );
    if (
      restaurantUserInfo !== null &&
      restaurantUserInfo.locale !== null &&
      restaurantUserInfo.locale !== ''
    ) {
      translastionCode = restaurantUserInfo.locale;
    }
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{user}}', `${userName}`);
      notificationDescription = notificationDescription.replace('{{user}}', `${userName}`);
    } else {
      notificationTitle = 'New Order';
      notificationDescription = `You have received a new order from ${userName}`;
    }

    const restaurantTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { token: 1 }
    );
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };
    const saveNotificationObj = {
      user: restaurantInfo.userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      username: userName,
      userHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = restaurantTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const scheduleOrder = async (orderId, restaurantId, userId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { name: 1, translations: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    const slugName = 'restaurant-schedule-order-accepted';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }
    if (
      restaurantInfo != null &&
      restaurantInfo.translations !== null &&
      checkArrayNotEmpty(restaurantInfo.translations)
    ) {
      const translationIndex = restaurantInfo.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== '' && translationIndex[0].title !== null) {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = restaurantInfo.name;
      }
    } else {
      restaurantName = restaurantInfo.name;
    }

    let notificationTitle = '';
    let notificationDescription = '';

    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
    } else {
      notificationTitle = 'Your Upcoming order has been accepted';
      notificationDescription = `${restaurantName} have accepted your scheduled order`;
    }
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: restaurantInfo,
      restaurantHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const acceptPrepareOrder = async (orderId, restaurantId, userId, time) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { name: 1, translations: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    const slugName = 'restaurant-order-accepted';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }
    if (
      restaurantInfo != null &&
      restaurantInfo.translations !== null &&
      checkArrayNotEmpty(restaurantInfo.translations)
    ) {
      const translationIndex = restaurantInfo.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = restaurantInfo.name;
      }
    } else {
      restaurantName = restaurantInfo.name;
    }

    let notificationTitle = '';
    let notificationDescription = '';

    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      // Restaurant Name Replace //
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
      // Restaurant Name Replace //

      // Restaurant Time Replace //
      notificationTitle = notificationTitle.replace('{{time}}', `${time}min`);
      notificationDescription = notificationDescription.replace('{{time}}', `${time}min`);
      // Restaurant Time Replace //
    } else {
      notificationTitle = 'Your order is accepted';
      notificationDescription = `${restaurantName} have accepted your order, and will prepared in ${time}min`;
    }
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: restaurantInfo,
      time: `${time}min`,
      restaurantHelper: true,
      timeHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const driverNewOrder = async (orderId, restaurantId, driverId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { name: 1, translations: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const driverTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(driverId) },
      { token: 1 }
    );
    const slugName = 'driver-new-order';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const driverInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(driverId) },
      { locale: 1, email: 1 }
    );
    if (driverInfo !== null && driverInfo.locale !== null && driverInfo.locale !== '') {
      translastionCode = driverInfo.locale;
    }
    if (
      restaurantInfo != null &&
      restaurantInfo.translations !== null &&
      checkArrayNotEmpty(restaurantInfo.translations)
    ) {
      const translationIndex = restaurantInfo.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = restaurantInfo.name;
      }
    } else {
      restaurantName = restaurantInfo.name;
    }

    let notificationTitle = '';
    let notificationDescription = '';

    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      // Restaurant Name Replace //
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
      // Restaurant Name Replace //
    } else {
      notificationTitle = 'New Order Received';
      notificationDescription = `${restaurantName} assigned you new order`;
    }

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: driverId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: restaurantInfo,
      restaurantHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (driverTokens !== null && checkArrayNotEmpty(driverTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = driverTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const getVendorOrderById = async (id, vendorId) => {
  const orderInfo = await Orders.findOne({
    _id: new mongoose.Types.ObjectId(id),
    restaurant: new mongoose.Types.ObjectId(vendorId),
  });
  return orderInfo;
};

const autoDriverNewOrder = async (orderId, restaurantId) => {
  // The cascade engine owns dispatch when it is switched on. Everything below is
  // the original single-offer path, kept intact so the flag can be flipped back
  // without a deploy. `require` is lazy: dispatch.service pulls in Orders and the
  // attempt model, and this module is loaded by the rider-facing controllers.
  const dispatchService = require('./dispatch.service');

  if (dispatchService.isCascadeEnabled()) {
    return dispatchService.dispatch(orderId, restaurantId);
  }
  if (config.dispatch && config.dispatch.shadowMode) {
    dispatchService
      .shadowDispatch(orderId, restaurantId)
      .then((r) => r && r.wouldOffer.length && logger.info(`[dispatch:shadow] ${JSON.stringify(r)}`));
  }

  const pool = await resolveRiderPool(restaurantId);
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    {
      name: 1,
      location: 1,
      logo: 1,
      cover: 1,
      ownDriver: 1,
      isOutlet: 1,
      outletManagerId: 1,
      translations: 1,
    }
  );
  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const { radiusMeters, findMode } = await resolveDeliveryRadius();
    const storeLatitude =
      restaurantInfo !== null &&
      restaurantInfo.location !== null &&
      restaurantInfo.location.coordinates !== null &&
      restaurantInfo.location.coordinates.length > 0
        ? restaurantInfo.location.coordinates[1]
        : 0.0;
    const storeLongitude =
      restaurantInfo !== null &&
      restaurantInfo.location !== null &&
      restaurantInfo.location.coordinates !== null &&
      restaurantInfo.location.coordinates.length > 0
        ? restaurantInfo.location.coordinates[0]
        : 0.0;
    const rejectedOrderByDriver = await DriverNewOrderStatus.find(
      {
        orderId: new mongoose.Types.ObjectId(orderId),
        driverOrderStatus: 'rejected',
      },
      { driver: 1, orderId: 1 }
    );
    const rejectedDriverId = rejectedOrderByDriver.map((obj) => obj.driver);
    const nearestDriver = buildGeoNearStage(
      pool,
      [storeLongitude, storeLatitude],
      radiusMeters,
      findMode,
      { userId: { $nin: rejectedDriverId } }
    );
    const filterOptions = {
      _id: 0,
      id: '$_id',
      distance: 1,
      userId: 1,
    };
    const nearDriverCount = await Driver.aggregate([
      nearestDriver,
      { $sort: { distance: 1 } },
      { $project: filterOptions },
    ]);
    if (nearDriverCount !== null && checkArrayNotEmpty(nearDriverCount)) {
      if (
        nearDriverCount !== null &&
        nearDriverCount.length > 0 &&
        nearDriverCount[0].userId !== null
      ) {
        const driverId = nearDriverCount[0].userId;
        const order = await getVendorOrderById(orderId, restaurantId);
        if (order !== null) {
          const requestOrder = new DriverNewOrderStatus({
            orderId: `${orderId}`,
            driver: driverId,
            driverOrderStatus: 'ideal',
            orderFrom: 'auto',
            restaurant: restaurantId,
            deliveryAddressRaw: order.deliveryAddressRaw,
          });
          await DriverNewOrderStatus.create(requestOrder);
        }

        const driverTokens = await PushNotificationToken.find(
          { user: new mongoose.Types.ObjectId(driverId) },
          { token: 1 }
        );
        const slugName = 'driver-new-order';
        const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
        let notificationList = [];
        let restaurantName = 'Restaurant';
        let translastionCode = 'en';
        const driverInfo = await User.findOne(
          { _id: new mongoose.Types.ObjectId(driverId) },
          { locale: 1, email: 1 }
        );
        if (driverInfo !== null && driverInfo.locale !== null && driverInfo.locale !== '') {
          translastionCode = driverInfo.locale;
        }
        if (
          restaurantInfo != null &&
          restaurantInfo.translations !== null &&
          checkArrayNotEmpty(restaurantInfo.translations)
        ) {
          const translationIndex = restaurantInfo.translations.filter(
            (x) => x.code === translastionCode
          );
          if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
            restaurantName = translationIndex[0].title;
          } else {
            restaurantName = restaurantInfo.name;
          }
        } else {
          restaurantName = restaurantInfo.name;
        }

        let notificationTitle = '';
        let notificationDescription = '';

        if (
          notiContent !== null &&
          notiContent.slug === slugName &&
          notiContent.title !== null &&
          notiContent.title !== '' &&
          notiContent.description !== null &&
          notiContent.description !== ''
        ) {
          notificationTitle = notiContent.title;
          notificationDescription = notiContent.description;
          if (
            notiContent !== null &&
            notiContent.translations !== null &&
            checkArrayNotEmpty(notiContent.translations)
          ) {
            notificationList = notiContent.translations;
            const translationIndex = notiContent.translations.filter(
              (x) => x.code === translastionCode
            );
            if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
              notificationTitle = translationIndex[0].title;
              notificationDescription = translationIndex[0].description;
            }
          }
          // Restaurant Name Replace //
          notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
          notificationDescription = notificationDescription.replace(
            '{{restaurant}}',
            `${restaurantName}`
          );
          // Restaurant Name Replace //
        } else {
          notificationTitle = 'New Order Received';
          notificationDescription = `${restaurantName} assigned you new order`;
        }

        const notificationPayload = {
          notification: {
            title: notificationTitle,
            body: notificationDescription,
          },
          data: {
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            type: 'order',
            value: `${orderId}`,
            extra: `${orderId}`,
          },
          android: {
            priority: 'high',
            notification: {
              channelId: 'high_importance_channel',
              priority: 'max',
              clickAction: 'FLUTTER_NOTIFICATION_CLICK',
            },
          },
          tokens: [],
        };

        const saveNotificationObj = {
          user: driverId,
          title: notificationTitle,
          content: notificationDescription,
          payload: notificationPayload,
          restaurantName: restaurantInfo,
          restaurantHelper: true,
          translations: notificationList,
        };
        await NotificationList.create(saveNotificationObj);

        if (driverTokens !== null && checkArrayNotEmpty(driverTokens)) {
          try {
            let notificationTokensList = [];
            notificationTokensList = driverTokens.map((obj) => obj.token);
            notificationPayload.tokens = notificationTokensList;
            await admin.messaging().sendEachForMulticast(notificationPayload);
            // eslint-disable-next-line no-unused-vars
          } catch (error) {
            //
          }
        }
      }
    } else {
      const order = await getVendorOrderById(orderId, restaurantId);
      if (order !== null) {
        Object.assign(order, { driverAssign: 'notfound' });
        await order.save();
      }
    }
  }
};

const driverAcceptOrder = async (orderId, restaurantId, driverId) => {
  const driverInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(driverId) },
    { firstName: 1, lastName: 1 }
  );
  if (driverInfo !== null && driverInfo.firstName !== null && driverInfo.firstName !== '') {
    const driverFirstName =
      driverInfo && driverInfo.firstName !== null && driverInfo.firstName !== ''
        ? driverInfo.firstName
        : '';
    const driverLastName =
      driverInfo && driverInfo.lastName !== null && driverInfo.lastName !== ''
        ? driverInfo.lastName
        : '';
    const driverName = `${driverFirstName} ${driverLastName}`;
    const restaurantInfo = await Restaurant.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantId) },
      {
        userId: 1,
      }
    );
    let restaurantLocale = 'en';
    let notificationTitle = '';
    let notificationDescription = '';
    const restaurantUserLocale = await User.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { locale: 1 }
    );
    if (
      restaurantUserLocale !== null &&
      restaurantUserLocale.locale !== null &&
      restaurantUserLocale.locale !== ''
    ) {
      restaurantLocale = restaurantUserLocale.locale;
    }
    const slugName = 'driver-order-accepted';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === restaurantLocale
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{driver}}', `${driverName}`);
      notificationDescription = notificationDescription.replace('{{driver}}', `${driverName}`);
    } else {
      notificationTitle = `${driverName} have accepted the order`;
      notificationDescription = `${driverName} have accepted the order, please hand over the order to the driver once the order is ready`;
    }

    if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
      const restaurantTokens = await PushNotificationToken.find(
        { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { token: 1 }
      );

      const notificationPayload = {
        notification: {
          title: notificationTitle,
          body: notificationDescription,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'order',
          value: `${orderId}`,
          extra: `${orderId}`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };

      const saveNotificationObj = {
        user: restaurantInfo.userId,
        title: notificationTitle,
        content: notificationDescription,
        payload: notificationPayload,
        driverName: `${driverName}`,
        driverHelper: true,
        translations: notificationList,
      };
      await NotificationList.create(saveNotificationObj);

      if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
        try {
          let notificationTokensList = [];
          notificationTokensList = restaurantTokens.map((obj) => obj.token);
          notificationPayload.tokens = notificationTokensList;
          await admin.messaging().sendEachForMulticast(notificationPayload);
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          //
        }
      }
    }
  }
};

const driverRejectOrder = async (orderId, restaurantId, driverId) => {
  const driverInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(driverId) },
    { firstName: 1, lastName: 1 }
  );
  if (driverInfo !== null && driverInfo.firstName !== null && driverInfo.firstName !== '') {
    const driverFirstName =
      driverInfo && driverInfo.firstName !== null && driverInfo.firstName !== ''
        ? driverInfo.firstName
        : '';
    const driverLastName =
      driverInfo && driverInfo.lastName !== null && driverInfo.lastName !== ''
        ? driverInfo.lastName
        : '';
    const driverName = `${driverFirstName} ${driverLastName}`;
    const restaurantInfo = await Restaurant.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantId) },
      {
        userId: 1,
      }
    );
    let restaurantLocale = 'en';
    let notificationTitle = '';
    let notificationDescription = '';
    if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
      const restaurantTokens = await PushNotificationToken.find(
        { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { token: 1 }
      );
      const restaurantUserLocale = await User.findOne(
        { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { locale: 1 }
      );
      if (
        restaurantUserLocale !== null &&
        restaurantUserLocale.locale !== null &&
        restaurantUserLocale.locale !== ''
      ) {
        restaurantLocale = restaurantUserLocale.locale;
      }
      const slugName = 'driver-order-rejected';
      const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
      let notificationList = [];
      if (
        notiContent !== null &&
        notiContent.slug === slugName &&
        notiContent.title !== null &&
        notiContent.title !== '' &&
        notiContent.description !== null &&
        notiContent.description !== ''
      ) {
        notificationTitle = notiContent.title;
        notificationDescription = notiContent.description;
        if (
          notiContent !== null &&
          notiContent.translations !== null &&
          checkArrayNotEmpty(notiContent.translations)
        ) {
          notificationList = notiContent.translations;
          const translationIndex = notiContent.translations.filter(
            (x) => x.code === restaurantLocale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            notificationTitle = translationIndex[0].title;
            notificationDescription = translationIndex[0].description;
          }
        }
        notificationTitle = notificationTitle.replace('{{driver}}', `${driverName}`);
        notificationDescription = notificationDescription.replace('{{driver}}', `${driverName}`);
      } else {
        notificationTitle = `${driverName} has rejected order`;
        notificationDescription = `${driverName} has rejected order, please assign order to new driver`;
      }

      const notificationPayload = {
        notification: {
          title: notificationTitle,
          body: notificationDescription,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'order',
          value: `${orderId}`,
          extra: `${orderId}`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };

      const saveNotificationObj = {
        user: restaurantInfo.userId,
        title: notificationTitle,
        content: notificationDescription,
        payload: notificationPayload,
        driverName: `${driverName}`,
        driverHelper: true,
        translations: notificationList,
      };
      await NotificationList.create(saveNotificationObj);

      if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
        try {
          let notificationTokensList = [];
          notificationTokensList = restaurantTokens.map((obj) => obj.token);
          notificationPayload.tokens = notificationTokensList;
          await admin.messaging().sendEachForMulticast(notificationPayload);
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          //
        }
      }
    }
  }
};

const driverReachedRestaurant = async (orderId, restaurantId, driverId) => {
  const driverInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(driverId) },
    { firstName: 1, lastName: 1 }
  );
  if (driverInfo !== null && driverInfo.firstName !== null && driverInfo.firstName !== '') {
    const driverFirstName =
      driverInfo && driverInfo.firstName !== null && driverInfo.firstName !== ''
        ? driverInfo.firstName
        : '';
    const driverLastName =
      driverInfo && driverInfo.lastName !== null && driverInfo.lastName !== ''
        ? driverInfo.lastName
        : '';
    const driverName = `${driverFirstName} ${driverLastName}`;
    const restaurantInfo = await Restaurant.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantId) },
      {
        userId: 1,
      }
    );
    let restaurantLocale = 'en';
    let notificationTitle = '';
    let notificationDescription = '';
    if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
      const restaurantTokens = await PushNotificationToken.find(
        { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { token: 1 }
      );
      const restaurantUserLocale = await User.findOne(
        { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { locale: 1 }
      );
      if (
        restaurantUserLocale !== null &&
        restaurantUserLocale.locale !== null &&
        restaurantUserLocale.locale !== ''
      ) {
        restaurantLocale = restaurantUserLocale.locale;
      }
      const slugName = 'driver-reached-restaurant';
      const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
      let notificationList = [];
      if (
        notiContent !== null &&
        notiContent.slug === slugName &&
        notiContent.title !== null &&
        notiContent.title !== '' &&
        notiContent.description !== null &&
        notiContent.description !== ''
      ) {
        notificationTitle = notiContent.title;
        notificationDescription = notiContent.description;
        if (
          notiContent !== null &&
          notiContent.translations !== null &&
          checkArrayNotEmpty(notiContent.translations)
        ) {
          notificationList = notiContent.translations;
          const translationIndex = notiContent.translations.filter(
            (x) => x.code === restaurantLocale
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            notificationTitle = translationIndex[0].title;
            notificationDescription = translationIndex[0].description;
          }
        }
        notificationTitle = notificationTitle.replace('{{driver}}', `${driverName}`);
        notificationDescription = notificationDescription.replace('{{driver}}', `${driverName}`);
      } else {
        notificationTitle = `${driverName} reached the restaurant`;
        notificationDescription = `${driverName} reached the restaurant, please handover the order once it is ready`;
      }

      const notificationPayload = {
        notification: {
          title: notificationTitle,
          body: notificationDescription,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'order',
          value: `${orderId}`,
          extra: `${orderId}`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };

      const saveNotificationObj = {
        user: restaurantInfo.userId,
        title: notificationTitle,
        content: notificationDescription,
        payload: notificationPayload,
        driverName: `${driverName}`,
        driverHelper: true,
        translations: notificationList,
      };
      await NotificationList.create(saveNotificationObj);

      if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
        try {
          let notificationTokensList = [];
          notificationTokensList = restaurantTokens.map((obj) => obj.token);
          notificationPayload.tokens = notificationTokensList;
          await admin.messaging().sendEachForMulticast(notificationPayload);
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          //
        }
      }
    }
  }
};

const restaurantOrderHandoverToDriver = async (orderId, userId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(orderId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'driver',
        foreignField: '_id',
        as: 'driver',
      },
    },
    {
      $unwind: {
        path: '$driver',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        restaurant: {
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
        driver: {
          firstName: { $ifNull: ['$driver.firstName', ''] },
          lastName: { $ifNull: ['$driver.lastName', ''] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    let driverName = 'Driver';
    if (details !== null && details.driver !== null && details.driver.firstName !== '') {
      const driverFirstName =
        details.driver && details.driver.firstName !== null && details.driver.firstName !== ''
          ? details.driver.firstName
          : '';
      const driverLastName =
        details.driver && details.driver.lastName !== null && details.driver.lastName !== ''
          ? details.driver.lastName
          : '';
      driverName = `${driverFirstName} ${driverLastName}`;
    }
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    const slugName = 'restaurant-order-handover';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }
    let notificationTitle = '';
    let notificationDescription = '';

    if (
      details != null &&
      details.restaurant !== null &&
      details.restaurant.translations !== null &&
      checkArrayNotEmpty(details.restaurant.translations)
    ) {
      const translationIndex = details.restaurant.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = details.restaurant.name;
      }
    } else {
      restaurantName = details.restaurant.name;
    }
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      // Restaurant Name Replace //
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
      // Restaurant Name Replace //

      // Restaurant Time Replace //
      notificationTitle = notificationTitle.replace('{{driver}}', `${driverName}`);
      notificationDescription = notificationDescription.replace('{{driver}}', `${driverName}`);
      // Restaurant Time Replace //
    } else {
      notificationTitle = `Your Order is Handover to ${driverName}`;
      notificationDescription = `${restaurantName} have hand over your order to ${driverName} will deliver soon`;
    }

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: details && details.restaurant ? details.restaurant : null,
      driverName: `${driverName}`,
      restaurantHelper: true,
      driverHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const restaurantOrderHandoverToCustomer = async (orderId, userId) => {
  const orderQuery = [
    { $match: { _id: new mongoose.Types.ObjectId(orderId) } },
    { $limit: 1 },
    {
      $lookup: {
        from: 'restaurants',
        localField: 'restaurant',
        foreignField: '_id',
        as: 'restaurants',
      },
    },
    {
      $unwind: {
        path: '$restaurants',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        id: '$_id',
        restaurant: {
          name: { $ifNull: ['$restaurants.name', ''] },
          translations: { $ifNull: ['$restaurants.translations', []] },
        },
      },
    },
  ];
  const orders = await Orders.aggregate(orderQuery);
  if (orders !== null && orders.length > 0) {
    const details = orders[0];
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    const slugName = 'restaurant-order-delivered';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }
    let notificationTitle = '';
    let notificationDescription = '';

    if (
      details != null &&
      details.restaurant !== null &&
      details.restaurant.translations !== null &&
      checkArrayNotEmpty(details.restaurant.translations)
    ) {
      const translationIndex = details.restaurant.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = details.restaurant.name;
      }
    } else {
      restaurantName = details.restaurant.name;
    }
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      // Restaurant Name Replace //
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
      // Restaurant Name Replace //
    } else {
      notificationTitle = `${restaurantName} delivered your order`;
      notificationDescription = `${restaurantName} delivered your order`;
    }

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: details && details.restaurant ? details.restaurant : null,
      restaurantHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const driverOngoingOrder = async (orderId, userId, driverId) => {
  const driverInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(driverId) },
    { firstName: 1, lastName: 1 }
  );
  if (driverInfo !== null && driverInfo.firstName !== null && driverInfo.firstName !== '') {
    const driverFirstName =
      driverInfo && driverInfo.firstName !== null && driverInfo.firstName !== ''
        ? driverInfo.firstName
        : '';
    const driverLastName =
      driverInfo && driverInfo.lastName !== null && driverInfo.lastName !== ''
        ? driverInfo.lastName
        : '';
    const driverName = `${driverFirstName} ${driverLastName}`;
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      {
        locale: 1,
      }
    );
    let userLocale = 'en';
    let notificationTitle = '';
    let notificationDescription = '';
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      userLocale = userInfo.locale;
    }
    const slugName = 'driver-order-ongoing';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter((x) => x.code === userLocale);
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{driver}}', `${driverName}`);
      notificationDescription = notificationDescription.replace('{{driver}}', `${driverName}`);
    } else {
      notificationTitle = `${driverName} is on the way to deliver the order`;
      notificationDescription = `${driverName} is on the way to deliver the order`;
    }
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      driverName: `${driverName}`,
      driverHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    const userTokenList = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    if (userTokenList !== null && checkArrayNotEmpty(userTokenList)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokenList.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const driverReachedCustomer = async (orderId, userId, driverId) => {
  const driverInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(driverId) },
    { firstName: 1, lastName: 1 }
  );
  if (driverInfo !== null && driverInfo.firstName !== null && driverInfo.firstName !== '') {
    const driverFirstName =
      driverInfo && driverInfo.firstName !== null && driverInfo.firstName !== ''
        ? driverInfo.firstName
        : '';
    const driverLastName =
      driverInfo && driverInfo.lastName !== null && driverInfo.lastName !== ''
        ? driverInfo.lastName
        : '';
    const driverName = `${driverFirstName} ${driverLastName}`;
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      {
        locale: 1,
      }
    );

    let userLocale = 'en';
    let notificationTitle = '';
    let notificationDescription = '';
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      userLocale = userInfo.locale;
    }
    const slugName = 'driver-reached-customer';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter((x) => x.code === userLocale);
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{driver}}', `${driverName}`);
      notificationDescription = notificationDescription.replace('{{driver}}', `${driverName}`);
    } else {
      notificationTitle = `${driverName} reached to your address`;
      notificationDescription = `${driverName} reached to your address`;
    }

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      driverName: `${driverName}`,
      driverHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    const userTokenList = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    if (userTokenList !== null && checkArrayNotEmpty(userTokenList)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokenList.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const driverDeliveOrder = async (orderId, userId, driverId) => {
  const driverInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(driverId) },
    { firstName: 1, lastName: 1 }
  );
  if (driverInfo !== null && driverInfo.firstName !== null && driverInfo.firstName !== '') {
    const driverFirstName =
      driverInfo && driverInfo.firstName !== null && driverInfo.firstName !== ''
        ? driverInfo.firstName
        : '';
    const driverLastName =
      driverInfo && driverInfo.lastName !== null && driverInfo.lastName !== ''
        ? driverInfo.lastName
        : '';
    const driverName = `${driverFirstName} ${driverLastName}`;
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      {
        locale: 1,
      }
    );
    let userLocale = 'en';
    let notificationTitle = '';
    let notificationDescription = '';
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      userLocale = userInfo.locale;
    }
    const slugName = 'driver-order-delivered';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter((x) => x.code === userLocale);
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{driver}}', `${driverName}`);
      notificationDescription = notificationDescription.replace('{{driver}}', `${driverName}`);
    } else {
      notificationTitle = `${driverName} delivered your order`;
      notificationDescription = `${driverName} delivered your order`;
    }
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      driverName: `${driverName}`,
      driverHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    const userTokenList = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    if (userTokenList !== null && checkArrayNotEmpty(userTokenList)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokenList.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const restaurantRejectOrder = async (orderId, restaurantId, userId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { name: 1, translations: 1 }
  );

  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const slugName = 'restaurant-order-rejected';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }
    if (
      restaurantInfo != null &&
      restaurantInfo.translations !== null &&
      checkArrayNotEmpty(restaurantInfo.translations)
    ) {
      const translationIndex = restaurantInfo.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = restaurantInfo.name;
      }
    } else {
      restaurantName = restaurantInfo.name;
    }

    let notificationTitle = '';
    let notificationDescription = '';

    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      // Restaurant Name Replace //
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
      // Restaurant Name Replace //
    } else {
      notificationTitle = 'Your Order Is Rejected';
      notificationDescription = `${restaurantName} rejected your order`;
    }

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: restaurantInfo,
      restaurantHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const userCancleOrder = async (orderId, restaurantId, userId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { userId: 1, slug: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
    let userName = '';
    let notificationTitle = '';
    let notificationDescription = '';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { firstName: 1, lastName: 1 }
    );
    if (userInfo !== null && userInfo.firstName !== null) {
      userName = `${userInfo.firstName} ${userInfo.lastName}`;
    }
    const slugName = 'user-order-cancelled';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let translastionCode = 'en';
    const restaurantUserInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { locale: 1 }
    );
    if (
      restaurantUserInfo !== null &&
      restaurantUserInfo.locale !== null &&
      restaurantUserInfo.locale !== ''
    ) {
      translastionCode = restaurantUserInfo.locale;
    }
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{user}}', `${userName}`);
      notificationDescription = notificationDescription.replace('{{user}}', `${userName}`);
    } else {
      notificationTitle = `${userName} have cancelled the order`;
      notificationDescription = `${userName} have cancelled the order`;
    }

    const restaurantTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { token: 1 }
    );

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: restaurantInfo.userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      username: userName,
      userHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = restaurantTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const adminCancelRefundRequest = async (userId, message, orderId) => {
  const userTokens = await PushNotificationToken.find(
    { user: new mongoose.Types.ObjectId(userId) },
    { token: 1 }
  );
  const slugName = 'refund-request-cancelled';
  const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
  let notificationList = [];
  let translastionCode = 'en';
  const userInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(userId) },
    { locale: 1, email: 1 }
  );
  if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
    translastionCode = userInfo.locale;
  }
  let notificationTitle = '';
  let notificationDescription = '';

  if (
    notiContent !== null &&
    notiContent.slug === slugName &&
    notiContent.title !== null &&
    notiContent.title !== '' &&
    notiContent.description !== null &&
    notiContent.description !== ''
  ) {
    notificationTitle = notiContent.title;
    notificationDescription = notiContent.description;
    if (
      notiContent !== null &&
      notiContent.translations !== null &&
      checkArrayNotEmpty(notiContent.translations)
    ) {
      notificationList = notiContent.translations;
      const translationIndex = notiContent.translations.filter((x) => x.code === translastionCode);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        notificationTitle = translationIndex[0].title;
        notificationDescription = translationIndex[0].description;
      }
    }
    // Reason Replace //
    notificationTitle = notificationTitle.replace('{{reason}}', `${message}`);
    notificationDescription = notificationDescription.replace('{{reason}}', `${message}`);
    // Reason Replace //
  } else {
    notificationTitle = 'Refund Request Cancelled';
    notificationDescription = `We regret to inform you that your refund request has been canceled. ${message}`;
  }
  const notificationPayload = {
    notification: {
      title: notificationTitle,
      body: notificationDescription,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      type: 'order',
      value: `${orderId}`,
      extra: `${orderId}`,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'high_importance_channel',
        priority: 'max',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    tokens: [],
  };

  const saveNotificationObj = {
    user: userId,
    title: notificationTitle,
    content: notificationDescription,
    payload: notificationPayload,
    reason: message,
    reasonHelper: true,
    translations: notificationList,
  };
  await NotificationList.create(saveNotificationObj);

  if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
    try {
      let notificationTokensList = [];
      notificationTokensList = userTokens.map((obj) => obj.token);
      notificationPayload.tokens = notificationTokensList;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
};

const approvedRefundRequest = async (userId, amount, orderId) => {
  let amountToShow = '';
  const businessSettings = await BusinessSettings.findOne({});
  if (
    businessSettings !== null &&
    businessSettings.currency !== null &&
    businessSettings.currency.symbol !== null &&
    businessSettings.currency.symbol !== ''
  ) {
    amountToShow =
      businessSettings.currencySide === 'left'
        ? `${businessSettings.currency.symbol}${amount}`
        : `${amount}${businessSettings.currency.symbol}`;
  } else {
    amountToShow = '$'`${amount}`;
  }
  const userTokens = await PushNotificationToken.find(
    { user: new mongoose.Types.ObjectId(userId) },
    { token: 1 }
  );
  const slugName = 'order-refunded';
  const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
  let notificationList = [];
  let translastionCode = 'en';
  const userInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(userId) },
    { locale: 1, email: 1 }
  );
  if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
    translastionCode = userInfo.locale;
  }
  let notificationTitle = '';
  let notificationDescription = '';

  if (
    notiContent !== null &&
    notiContent.slug === slugName &&
    notiContent.title !== null &&
    notiContent.title !== '' &&
    notiContent.description !== null &&
    notiContent.description !== ''
  ) {
    notificationTitle = notiContent.title;
    notificationDescription = notiContent.description;
    if (
      notiContent !== null &&
      notiContent.translations !== null &&
      checkArrayNotEmpty(notiContent.translations)
    ) {
      notificationList = notiContent.translations;
      const translationIndex = notiContent.translations.filter((x) => x.code === translastionCode);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        notificationTitle = translationIndex[0].title;
        notificationDescription = translationIndex[0].description;
      }
    }
    // Reason Replace //
    notificationTitle = notificationTitle.replace('{{amount}}', `${amountToShow}`);
    notificationDescription = notificationDescription.replace('{{amount}}', `${amountToShow}`);
    // Reason Replace //
  } else {
    notificationTitle = 'Your order refund process is completed';
    notificationDescription = `Your order refund process is completed, it will reflect on your account or wallet soon`;
  }
  const notificationPayload = {
    notification: {
      title: notificationTitle,
      body: notificationDescription,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      type: 'order',
      value: `${orderId}`,
      extra: `${orderId}`,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'high_importance_channel',
        priority: 'max',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    tokens: [],
  };

  const saveNotificationObj = {
    user: userId,
    title: notificationTitle,
    content: notificationDescription,
    payload: notificationPayload,
    amount: amountToShow,
    amountHelper: true,
    translations: notificationList,
  };
  await NotificationList.create(saveNotificationObj);

  if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
    try {
      let notificationTokensList = [];
      notificationTokensList = userTokens.map((obj) => obj.token);
      notificationPayload.tokens = notificationTokensList;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
};

const purchasedTiffinSubscriptionPackage = async (purchaseId) => {
  const purchasedTiffinPackageInfo = await UserPurchasedTiffinSubscription.findOne(
    {
      _id: new mongoose.Types.ObjectId(purchaseId),
    },
    {
      user: 1,
      subscriptionPackage: 1,
      restaurant: 1,
    }
  );
  if (
    purchasedTiffinPackageInfo !== null &&
    purchasedTiffinPackageInfo.user !== null &&
    purchasedTiffinPackageInfo.subscriptionPackage !== null &&
    purchasedTiffinPackageInfo.restaurant
  ) {
    const restaurantId = purchasedTiffinPackageInfo.restaurant;
    const userId = purchasedTiffinPackageInfo.user;
    const packageId = purchasedTiffinPackageInfo.subscriptionPackage;
    const restaurantInfo = await Restaurant.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantId) },
      { userId: 1, slug: 1 }
    );
    if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
      let userName = '';
      let packageName = '';
      let notificationTitle = '';
      let notificationDescription = '';
      const userInfo = await User.findOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { firstName: 1, lastName: 1 }
      );
      if (userInfo !== null && userInfo.firstName !== null) {
        userName = `${userInfo.firstName} ${userInfo.lastName}`;
      }
      let translastionCode = 'en';
      const restaurantUserInfo = await User.findOne(
        { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { locale: 1 }
      );
      if (
        restaurantUserInfo !== null &&
        restaurantUserInfo.locale !== null &&
        restaurantUserInfo.locale !== ''
      ) {
        translastionCode = restaurantUserInfo.locale;
      }
      const packageInfo = await SubscriptionTiffinPackage.findOne(
        { _id: new mongoose.Types.ObjectId(packageId) },
        { name: 1, translations: 1 }
      );
      if (packageInfo != null && packageInfo.name !== null) {
        packageName = packageInfo.name;
        if (packageInfo.translations !== null && checkArrayNotEmpty(packageInfo.translations)) {
          const translationIndex = packageInfo.translations.filter(
            (x) => x.code === translastionCode
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            packageName = translationIndex[0].title;
          }
        }
      }
      const slugName = 'tiffin-subscription-package-purchased';
      const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
      let notificationList = [];
      if (
        notiContent !== null &&
        notiContent.slug === slugName &&
        notiContent.title !== null &&
        notiContent.title !== '' &&
        notiContent.description !== null &&
        notiContent.description !== ''
      ) {
        notificationTitle = notiContent.title;
        notificationDescription = notiContent.description;
        if (
          notiContent !== null &&
          notiContent.translations !== null &&
          checkArrayNotEmpty(notiContent.translations)
        ) {
          notificationList = notiContent.translations;
          const translationIndex = notiContent.translations.filter(
            (x) => x.code === translastionCode
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            notificationTitle = translationIndex[0].title;
            notificationDescription = translationIndex[0].description;
          }
        }
        notificationTitle = notificationTitle.replace('{{user}}', `${userName}`);
        notificationDescription = notificationDescription.replace('{{user}}', `${userName}`);

        notificationTitle = notificationTitle.replace('{{packageName}}', `${packageName}`);
        notificationDescription = notificationDescription.replace(
          '{{packageName}}',
          `${packageName}`
        );
      } else {
        notificationTitle = `${userName} Purchased ${packageName} Tiffin Subscription Package`;
        notificationDescription = `${userName} Purchased ${packageName} Tiffin Subscription Package`;
      }

      const restaurantTokens = await PushNotificationToken.find(
        { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { token: 1 }
      );
      const notificationPayload = {
        notification: {
          title: notificationTitle,
          body: notificationDescription,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'tiffinsubscription',
          value: `${packageId}`,
          extra: `${packageId}`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };

      const saveNotificationObj = {
        user: restaurantInfo.userId,
        title: notificationTitle,
        content: notificationDescription,
        payload: notificationPayload,
        username: userName,
        packageName: packageInfo,
        userHelper: true,
        packageHelper: true,
        translations: notificationList,
      };
      await NotificationList.create(saveNotificationObj);

      if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
        try {
          let notificationTokensList = [];
          notificationTokensList = restaurantTokens.map((obj) => obj.token);
          notificationPayload.tokens = notificationTokensList;
          await admin.messaging().sendEachForMulticast(notificationPayload);
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          //
        }
      }
    }
  }
};

const userCancelledTiffinSubscriptionPackage = async (purchaseId) => {
  const purchasedTiffinPackageInfo = await UserPurchasedTiffinSubscription.findOne(
    {
      _id: new mongoose.Types.ObjectId(purchaseId),
    },
    {
      user: 1,
      subscriptionPackage: 1,
      restaurant: 1,
    }
  );
  if (
    purchasedTiffinPackageInfo !== null &&
    purchasedTiffinPackageInfo.user !== null &&
    purchasedTiffinPackageInfo.subscriptionPackage !== null &&
    purchasedTiffinPackageInfo.restaurant
  ) {
    const restaurantId = purchasedTiffinPackageInfo.restaurant;
    const userId = purchasedTiffinPackageInfo.user;
    const packageId = purchasedTiffinPackageInfo.subscriptionPackage;
    const restaurantInfo = await Restaurant.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantId) },
      { userId: 1, slug: 1 }
    );
    if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
      let userName = '';
      let packageName = '';
      let notificationTitle = '';
      let notificationDescription = '';
      const userInfo = await User.findOne(
        { _id: new mongoose.Types.ObjectId(userId) },
        { firstName: 1, lastName: 1 }
      );
      if (userInfo !== null && userInfo.firstName !== null) {
        userName = `${userInfo.firstName} ${userInfo.lastName}`;
      }
      let translastionCode = 'en';
      const restaurantUserInfo = await User.findOne(
        { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { locale: 1 }
      );
      if (
        restaurantUserInfo !== null &&
        restaurantUserInfo.locale !== null &&
        restaurantUserInfo.locale !== ''
      ) {
        translastionCode = restaurantUserInfo.locale;
      }
      const packageInfo = await SubscriptionTiffinPackage.findOne(
        { _id: new mongoose.Types.ObjectId(packageId) },
        { name: 1, translations: 1 }
      );
      if (packageInfo != null && packageInfo.name !== null) {
        packageName = packageInfo.name;
        if (packageInfo.translations !== null && checkArrayNotEmpty(packageInfo.translations)) {
          const translationIndex = packageInfo.translations.filter(
            (x) => x.code === translastionCode
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            packageName = translationIndex[0].title;
          }
        }
      }
      const slugName = 'user-tiffin-subscription-package-cancelled';
      const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
      let notificationList = [];
      if (
        notiContent !== null &&
        notiContent.slug === slugName &&
        notiContent.title !== null &&
        notiContent.title !== '' &&
        notiContent.description !== null &&
        notiContent.description !== ''
      ) {
        notificationTitle = notiContent.title;
        notificationDescription = notiContent.description;
        if (
          notiContent !== null &&
          notiContent.translations !== null &&
          checkArrayNotEmpty(notiContent.translations)
        ) {
          notificationList = notiContent.translations;
          const translationIndex = notiContent.translations.filter(
            (x) => x.code === translastionCode
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            notificationTitle = translationIndex[0].title;
            notificationDescription = translationIndex[0].description;
          }
        }
        notificationTitle = notificationTitle.replace('{{user}}', `${userName}`);
        notificationDescription = notificationDescription.replace('{{user}}', `${userName}`);

        notificationTitle = notificationTitle.replace('{{packageName}}', `${packageName}`);
        notificationDescription = notificationDescription.replace(
          '{{packageName}}',
          `${packageName}`
        );
      } else {
        notificationTitle = `${userName} Purchased ${packageName} Tiffin Subscription Package`;
        notificationDescription = `${userName} Purchased ${packageName} Tiffin Subscription Package`;
      }

      const restaurantTokens = await PushNotificationToken.find(
        { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
        { token: 1 }
      );
      const notificationPayload = {
        notification: {
          title: notificationTitle,
          body: notificationDescription,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'tiffinsubscription',
          value: `${packageId}`,
          extra: `${packageId}`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };

      const saveNotificationObj = {
        user: restaurantInfo.userId,
        title: notificationTitle,
        content: notificationDescription,
        payload: notificationPayload,
        username: userName,
        packageName: packageInfo,
        userHelper: true,
        packageHelper: true,
        translations: notificationList,
      };
      await NotificationList.create(saveNotificationObj);

      if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
        try {
          let notificationTokensList = [];
          notificationTokensList = restaurantTokens.map((obj) => obj.token);
          notificationPayload.tokens = notificationTokensList;
          await admin.messaging().sendEachForMulticast(notificationPayload);
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          //
        }
      }
    }
  }
};

const adminCancelTiffinSubscriptionRefundRequest = async (userId, message, purchaseId) => {
  const userTokens = await PushNotificationToken.find(
    { user: new mongoose.Types.ObjectId(userId) },
    { token: 1 }
  );
  const slugName = 'refunded-tiffin-subscription-package-cancelled';
  const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
  let notificationList = [];
  let translastionCode = 'en';
  const userInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(userId) },
    { locale: 1, email: 1 }
  );
  if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
    translastionCode = userInfo.locale;
  }
  let notificationTitle = '';
  let notificationDescription = '';

  if (
    notiContent !== null &&
    notiContent.slug === slugName &&
    notiContent.title !== null &&
    notiContent.title !== '' &&
    notiContent.description !== null &&
    notiContent.description !== ''
  ) {
    notificationTitle = notiContent.title;
    notificationDescription = notiContent.description;
    if (
      notiContent !== null &&
      notiContent.translations !== null &&
      checkArrayNotEmpty(notiContent.translations)
    ) {
      notificationList = notiContent.translations;
      const translationIndex = notiContent.translations.filter((x) => x.code === translastionCode);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        notificationTitle = translationIndex[0].title;
        notificationDescription = translationIndex[0].description;
      }
    }
    // Reason Replace //
    notificationTitle = notificationTitle.replace('{{reason}}', `${message}`);
    notificationDescription = notificationDescription.replace('{{reason}}', `${message}`);
    // Reason Replace //
  } else {
    notificationTitle = 'Refund Request Cancelled';
    notificationDescription = `We regret to inform you that your refund request has been canceled. ${message}`;
  }
  const notificationPayload = {
    notification: {
      title: notificationTitle,
      body: notificationDescription,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      type: 'tiffinsubscription',
      value: `${purchaseId}`,
      extra: `${purchaseId}`,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'high_importance_channel',
        priority: 'max',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    tokens: [],
  };

  const saveNotificationObj = {
    user: userId,
    title: notificationTitle,
    content: notificationDescription,
    payload: notificationPayload,
    reason: message,
    reasonHelper: true,
    translations: notificationList,
  };
  await NotificationList.create(saveNotificationObj);

  if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
    try {
      let notificationTokensList = [];
      notificationTokensList = userTokens.map((obj) => obj.token);
      notificationPayload.tokens = notificationTokensList;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
};

const approvedTiffinSubscriptionRefundRequest = async (userId, amount, purchaseId) => {
  let amountToShow = '';
  const businessSettings = await BusinessSettings.findOne({});
  if (
    businessSettings !== null &&
    businessSettings.currency !== null &&
    businessSettings.currency.symbol !== null &&
    businessSettings.currency.symbol !== ''
  ) {
    amountToShow =
      businessSettings.currencySide === 'left'
        ? `${businessSettings.currency.symbol}${amount}`
        : `${amount}${businessSettings.currency.symbol}`;
  } else {
    amountToShow = '$'`${amount}`;
  }
  const userTokens = await PushNotificationToken.find(
    { user: new mongoose.Types.ObjectId(userId) },
    { token: 1 }
  );
  const slugName = 'refunded-tiffin-subscription-package';
  const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
  let notificationList = [];
  let translastionCode = 'en';
  const userInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(userId) },
    { locale: 1, email: 1 }
  );
  if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
    translastionCode = userInfo.locale;
  }
  let notificationTitle = '';
  let notificationDescription = '';
  if (
    notiContent !== null &&
    notiContent.slug === slugName &&
    notiContent.title !== null &&
    notiContent.title !== '' &&
    notiContent.description !== null &&
    notiContent.description !== ''
  ) {
    notificationTitle = notiContent.title;
    notificationDescription = notiContent.description;
    if (
      notiContent !== null &&
      notiContent.translations !== null &&
      checkArrayNotEmpty(notiContent.translations)
    ) {
      notificationList = notiContent.translations;
      const translationIndex = notiContent.translations.filter((x) => x.code === translastionCode);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        notificationTitle = translationIndex[0].title;
        notificationDescription = translationIndex[0].description;
      }
    }
    // Reason Replace //
    notificationTitle = notificationTitle.replace('{{amount}}', `${amountToShow}`);
    notificationDescription = notificationDescription.replace('{{amount}}', `${amountToShow}`);
    // Reason Replace //
  } else {
    notificationTitle = 'Your order refund process is completed';
    notificationDescription = `Your order refund process is completed, it will reflect on your account or wallet soon`;
  }
  const notificationPayload = {
    notification: {
      title: notificationTitle,
      body: notificationDescription,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      type: 'tiffinsubscription',
      value: `${purchaseId}`,
      extra: `${purchaseId}`,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'high_importance_channel',
        priority: 'max',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    tokens: [],
  };
  const saveNotificationObj = {
    user: userId,
    title: notificationTitle,
    content: notificationDescription,
    payload: notificationPayload,
    amount: amountToShow,
    amountHelper: true,
    translations: notificationList,
  };
  await NotificationList.create(saveNotificationObj);

  if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
    try {
      let notificationTokensList = [];
      notificationTokensList = userTokens.map((obj) => obj.token);
      notificationPayload.tokens = notificationTokensList;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
};

const restaurantNewBooking = async (bookingId, restaurantId, userId, bookedName) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { userId: 1, slug: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
    let userName = '';
    let notificationTitle = '';
    let notificationDescription = '';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { firstName: 1, lastName: 1 }
    );
    if (userInfo !== null && userInfo.firstName !== null && bookedName && bookedName !== null) {
      userName = `${userInfo.firstName} ${userInfo.lastName}`;
    } else {
      userName = bookedName;
    }
    const slugName = 'new-dining-booking';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let translastionCode = 'en';
    const restaurantUserInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { locale: 1 }
    );
    if (
      restaurantUserInfo !== null &&
      restaurantUserInfo.locale !== null &&
      restaurantUserInfo.locale !== ''
    ) {
      translastionCode = restaurantUserInfo.locale;
    }
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{user}}', `${userName}`);
      notificationDescription = notificationDescription.replace('{{user}}', `${userName}`);
    } else {
      notificationTitle = 'New Dining Booking';
      notificationDescription = `A new dining reservation has been requested by ${userName}`;
    }

    const restaurantTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { token: 1 }
    );

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'booking',
        value: `${bookingId}`,
        extra: `${bookingId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };
    const saveNotificationObj = {
      user: restaurantInfo.userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      username: userName,
      userHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = restaurantTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const userCancelDiningBooking = async (bookingId, restaurantId, userId, bookedName) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { userId: 1, slug: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
    let userName = '';
    let notificationTitle = '';
    let notificationDescription = '';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { firstName: 1, lastName: 1 }
    );
    if (userInfo !== null && userInfo.firstName !== null && bookedName && bookedName !== null) {
      userName = `${userInfo.firstName} ${userInfo.lastName}`;
    }
    const slugName = 'dining-booking-cancelled';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let translastionCode = 'en';
    const restaurantUserInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { locale: 1 }
    );
    if (
      restaurantUserInfo !== null &&
      restaurantUserInfo.locale !== null &&
      restaurantUserInfo.locale !== ''
    ) {
      translastionCode = restaurantUserInfo.locale;
    }
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      notificationTitle = notificationTitle.replace('{{user}}', `${userName}`);
      notificationDescription = notificationDescription.replace('{{user}}', `${userName}`);
    } else {
      notificationTitle = `Booking Canceled by ${userName}`;
      notificationDescription = `${userName} has cancelled their dining reservations, Please update your booking schedule accordingly.`;
    }

    const restaurantTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { token: 1 }
    );

    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'booking',
        value: `${bookingId}`,
        extra: `${bookingId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };
    const saveNotificationObj = {
      user: restaurantInfo.userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      username: userName,
      userHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = restaurantTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const adminCancelDiningBookingRefundRequest = async (userId, message, bookingId) => {
  const userTokens = await PushNotificationToken.find(
    { user: new mongoose.Types.ObjectId(userId) },
    { token: 1 }
  );
  const slugName = 'dining-booking-refund-request-cancelled';
  const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
  let notificationList = [];
  let translastionCode = 'en';
  const userInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(userId) },
    { locale: 1, email: 1 }
  );
  if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
    translastionCode = userInfo.locale;
  }
  let notificationTitle = '';
  let notificationDescription = '';
  if (
    notiContent !== null &&
    notiContent.slug === slugName &&
    notiContent.title !== null &&
    notiContent.title !== '' &&
    notiContent.description !== null &&
    notiContent.description !== ''
  ) {
    notificationTitle = notiContent.title;
    notificationDescription = notiContent.description;
    if (
      notiContent !== null &&
      notiContent.translations !== null &&
      checkArrayNotEmpty(notiContent.translations)
    ) {
      notificationList = notiContent.translations;
      const translationIndex = notiContent.translations.filter((x) => x.code === translastionCode);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        notificationTitle = translationIndex[0].title;
        notificationDescription = translationIndex[0].description;
      }
    }
    // Reason Replace //
    notificationTitle = notificationTitle.replace('{{reason}}', `${message}`);
    notificationDescription = notificationDescription.replace('{{reason}}', `${message}`);
    // Reason Replace //
  } else {
    notificationTitle = 'Refund Request Cancelled';
    notificationDescription = `We regret to inform you that your refund request has been canceled. ${message}`;
  }
  const notificationPayload = {
    notification: {
      title: notificationTitle,
      body: notificationDescription,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      type: 'booking',
      value: `${bookingId}`,
      extra: `${bookingId}`,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'high_importance_channel',
        priority: 'max',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    tokens: [],
  };

  const saveNotificationObj = {
    user: userId,
    title: notificationTitle,
    content: notificationDescription,
    payload: notificationPayload,
    reason: message,
    reasonHelper: true,
    translations: notificationList,
  };
  await NotificationList.create(saveNotificationObj);

  if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
    try {
      let notificationTokensList = [];
      notificationTokensList = userTokens.map((obj) => obj.token);
      notificationPayload.tokens = notificationTokensList;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
};

const adminApprovedDiningBookingRefundRequest = async (userId, amount, bookingId) => {
  let amountToShow = '';
  const businessSettings = await BusinessSettings.findOne({});
  if (
    businessSettings !== null &&
    businessSettings.currency !== null &&
    businessSettings.currency.symbol !== null &&
    businessSettings.currency.symbol !== ''
  ) {
    amountToShow =
      businessSettings.currencySide === 'left'
        ? `${businessSettings.currency.symbol}${amount}`
        : `${amount}${businessSettings.currency.symbol}`;
  } else {
    amountToShow = '$'`${amount}`;
  }
  const userTokens = await PushNotificationToken.find(
    { user: new mongoose.Types.ObjectId(userId) },
    { token: 1 }
  );
  const slugName = 'dining-booking-refunded';
  const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
  let notificationList = [];
  let translastionCode = 'en';
  const userInfo = await User.findOne(
    { _id: new mongoose.Types.ObjectId(userId) },
    { locale: 1, email: 1 }
  );
  if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
    translastionCode = userInfo.locale;
  }
  let notificationTitle = '';
  let notificationDescription = '';
  if (
    notiContent !== null &&
    notiContent.slug === slugName &&
    notiContent.title !== null &&
    notiContent.title !== '' &&
    notiContent.description !== null &&
    notiContent.description !== ''
  ) {
    notificationTitle = notiContent.title;
    notificationDescription = notiContent.description;
    if (
      notiContent !== null &&
      notiContent.translations !== null &&
      checkArrayNotEmpty(notiContent.translations)
    ) {
      notificationList = notiContent.translations;
      const translationIndex = notiContent.translations.filter((x) => x.code === translastionCode);
      if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
        notificationTitle = translationIndex[0].title;
        notificationDescription = translationIndex[0].description;
      }
    }
    // Reason Replace //
    notificationTitle = notificationTitle.replace('{{amount}}', `${amountToShow}`);
    notificationDescription = notificationDescription.replace('{{amount}}', `${amountToShow}`);
    // Reason Replace //
  } else {
    notificationTitle = 'Your order refund process is completed';
    notificationDescription = `Your order refund process is completed, it will reflect on your account or wallet soon`;
  }
  const notificationPayload = {
    notification: {
      title: notificationTitle,
      body: notificationDescription,
    },
    data: {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      type: 'booking',
      value: `${bookingId}`,
      extra: `${bookingId}`,
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'high_importance_channel',
        priority: 'max',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
      },
    },
    tokens: [],
  };

  const saveNotificationObj = {
    user: userId,
    title: notificationTitle,
    content: notificationDescription,
    payload: notificationPayload,
    amount: amountToShow,
    amountHelper: true,
    translations: notificationList,
  };
  await NotificationList.create(saveNotificationObj);

  if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
    try {
      let notificationTokensList = [];
      notificationTokensList = userTokens.map((obj) => obj.token);
      notificationPayload.tokens = notificationTokensList;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
};

const acceptDiningBookingRequest = async (bookingId, userId, restaurantId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurantId) },
    { name: 1, translations: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    const slugName = 'dining-booking-accepted';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }
    if (
      restaurantInfo != null &&
      restaurantInfo.translations !== null &&
      checkArrayNotEmpty(restaurantInfo.translations)
    ) {
      const translationIndex = restaurantInfo.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = restaurantInfo.name;
      }
    } else {
      restaurantName = restaurantInfo.name;
    }

    let notificationTitle = '';
    let notificationDescription = '';
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;

      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      // Restaurant Name Replace //
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
      // Restaurant Name Replace //
    } else {
      notificationTitle = `Dining Reservation Confirmed! by ${restaurantName}`;
      notificationDescription = `We look forward to serving you. Please arrive 10 minutes early to ensure a smooth experience.`;
    }
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'booking',
        value: `${bookingId}`,
        extra: `${bookingId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: restaurantInfo,
      restaurantHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const rejectDiningBookingRequest = async (bookingId, vendorId, userId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(vendorId) },
    { name: 1, translations: 1 }
  );

  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const slugName = 'dining-booking-rejected';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let restaurantName = 'Restaurant';
    let translastionCode = 'en';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }
    if (
      restaurantInfo != null &&
      restaurantInfo.translations !== null &&
      checkArrayNotEmpty(restaurantInfo.translations)
    ) {
      const translationIndex = restaurantInfo.translations.filter(
        (x) => x.code === translastionCode
      );
      if (translationIndex[0].title !== null && translationIndex[0].title !== '') {
        restaurantName = translationIndex[0].title;
      } else {
        restaurantName = restaurantInfo.name;
      }
    } else {
      restaurantName = restaurantInfo.name;
    }
    let notificationTitle = '';
    let notificationDescription = '';
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
      // Restaurant Name Replace //
      notificationTitle = notificationTitle.replace('{{restaurant}}', `${restaurantName}`);
      notificationDescription = notificationDescription.replace(
        '{{restaurant}}',
        `${restaurantName}`
      );
      // Restaurant Name Replace //
    } else {
      notificationTitle = `Booking Request Rejected by ${restaurantName}`;
      notificationDescription = `The dining reservation has been rejected. by ${restaurantName}`;
    }
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'booking',
        value: `${bookingId}`,
        extra: `${bookingId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };

    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      restaurantName: restaurantInfo,
      restaurantHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const completeDiningBookingRequest = async (bookingId, vendorId, userId) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(vendorId) },
    { name: 1, translations: 1 }
  );

  if (restaurantInfo !== null && restaurantInfo.name !== null && restaurantInfo.name !== '') {
    const slugName = 'dining-booking-completed';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let translastionCode = 'en';
    const userInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(userId) },
      { locale: 1, email: 1 }
    );
    if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
      translastionCode = userInfo.locale;
    }

    let notificationTitle = '';
    let notificationDescription = '';

    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
    } else {
      notificationTitle = `Dining Reservation Completed`;
      notificationDescription = `The dining reservation has been completed. Thank you for providing great service!`;
    }
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'booking',
        value: `${bookingId}`,
        extra: `${bookingId}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };
    const saveNotificationObj = {
      user: userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    const userTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    );
    if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = userTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const kitchenOwnerNewOrder = async (kind, restaurant) => {
  const kitchenOwnerList = await KitchenOwner.find(
    { restaurant: new mongoose.Types.ObjectId(restaurant) },
    { userId: 1 }
  );
  if (kitchenOwnerList !== null && checkArrayNotEmpty(kitchenOwnerList)) {
    const slugName = 'new-kitchen-order';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    kitchenOwnerList.forEach(async (element) => {
      let translastionCode = 'en';
      let notificationList = [];
      const userInfo = await User.findOne(
        { _id: new mongoose.Types.ObjectId(element.userId) },
        { locale: 1, email: 1 }
      );
      if (userInfo !== null && userInfo.locale !== null && userInfo.locale !== '') {
        translastionCode = userInfo.locale;
      }
      let notificationTitle = '';
      let notificationDescription = '';
      if (
        notiContent !== null &&
        notiContent.slug === slugName &&
        notiContent.title !== null &&
        notiContent.title !== '' &&
        notiContent.description !== null &&
        notiContent.description !== ''
      ) {
        notificationTitle = notiContent.title;
        notificationDescription = notiContent.description;
        if (
          notiContent !== null &&
          notiContent.translations !== null &&
          checkArrayNotEmpty(notiContent.translations)
        ) {
          notificationList = notiContent.translations;
          const translationIndex = notiContent.translations.filter(
            (x) => x.code === translastionCode
          );
          if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
            notificationTitle = translationIndex[0].title;
            notificationDescription = translationIndex[0].description;
          }
        }
      } else {
        notificationTitle = `Incoming {{kind}} Order – Start Cooking!`;
        notificationDescription = `Incoming {{kind}} Order – Start Cooking!`;
      }
      // regular_order, pos_order, table_order
      let orderName = 'Regular';
      if (kind === 'regular_order') {
        orderName = 'Regular';
      } else if (kind === 'pos_order') {
        orderName = 'POS';
      } else if (kind === 'table_order') {
        orderName = 'Table';
      }
      notificationTitle = notificationTitle.replace('{{kind}}', `${orderName}`);
      notificationDescription = notificationDescription.replace('{{kind}}', `${orderName}`);
      const notificationPayload = {
        notification: {
          title: notificationTitle,
          body: notificationDescription,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'order',
          value: `${kind}`,
          extra: `${kind}`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      const saveNotificationObj = {
        user: element.userId,
        title: notificationTitle,
        content: notificationDescription,
        payload: notificationPayload,
        kind: orderName,
        kindHelper: true,
        translations: notificationList,
      };
      await NotificationList.create(saveNotificationObj);
      const userTokens = await PushNotificationToken.find(
        { user: new mongoose.Types.ObjectId(element.userId) },
        { token: 1 }
      );
      if (userTokens !== null && checkArrayNotEmpty(userTokens)) {
        try {
          let notificationTokensList = [];
          notificationTokensList = userTokens.map((obj) => obj.token);
          notificationPayload.tokens = notificationTokensList;
          await admin.messaging().sendEachForMulticast(notificationPayload);
          // eslint-disable-next-line no-unused-vars
        } catch (error) {
          //
        }
      }
    });
  }
};

const kitchenCompleteOrder = async (kind, kindName, orderNo, tableNo, restaurant) => {
  const restaurantInfo = await Restaurant.findOne(
    { _id: new mongoose.Types.ObjectId(restaurant) },
    { userId: 1, slug: 1 }
  );
  if (restaurantInfo !== null && restaurantInfo.userId !== null && restaurantInfo.userId !== '') {
    let notificationTitle = '';
    let notificationDescription = '';
    const slugName = 'kitchen-order-completed';
    const notiContent = await OrderNotificationTranslation.findOne({ slug: slugName });
    let notificationList = [];
    let translastionCode = 'en';
    const restaurantUserInfo = await User.findOne(
      { _id: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { locale: 1 }
    );
    if (
      restaurantUserInfo !== null &&
      restaurantUserInfo.locale !== null &&
      restaurantUserInfo.locale !== ''
    ) {
      translastionCode = restaurantUserInfo.locale;
    }
    if (
      notiContent !== null &&
      notiContent.slug === slugName &&
      notiContent.title !== null &&
      notiContent.title !== '' &&
      notiContent.description !== null &&
      notiContent.description !== ''
    ) {
      notificationTitle = notiContent.title;
      notificationDescription = notiContent.description;
      if (
        notiContent !== null &&
        notiContent.translations !== null &&
        checkArrayNotEmpty(notiContent.translations)
      ) {
        notificationList = notiContent.translations;
        const translationIndex = notiContent.translations.filter(
          (x) => x.code === translastionCode
        );
        if (translationIndex !== null && checkArrayNotEmpty(translationIndex)) {
          notificationTitle = translationIndex[0].title;
          notificationDescription = translationIndex[0].description;
        }
      }
    } else {
      notificationTitle = '{{kind}} Order {{order}} Cooking Completed!';
      notificationDescription = `{{kind}} Order {{order}} Cooking Completed!`;
    }
    notificationTitle = notificationTitle.replace('{{kind}}', `${kindName}`);
    notificationDescription = notificationDescription.replace('{{kind}}', `${kindName}`);

    notificationTitle = notificationTitle.replace(
      '{{order}}',
      kind === 'table_order' ? `${tableNo}` : 0
    );
    notificationDescription = notificationDescription.replace(
      '{{order}}',
      kind === 'table_order' ? `${tableNo}` : 0
    );

    const restaurantTokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(restaurantInfo.userId) },
      { token: 1 }
    );
    const notificationPayload = {
      notification: {
        title: notificationTitle,
        body: notificationDescription,
      },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        value: `${orderNo}`,
        extra: `${orderNo}`,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'high_importance_channel',
          priority: 'max',
          clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        },
      },
      tokens: [],
    };
    const saveNotificationObj = {
      user: restaurantInfo.userId,
      title: notificationTitle,
      content: notificationDescription,
      payload: notificationPayload,
      kind: kindName,
      order: kind === 'table_order' ? `${tableNo}` : '0',
      kindHelper: true,
      orderHelper: true,
      translations: notificationList,
    };
    await NotificationList.create(saveNotificationObj);

    if (restaurantTokens !== null && checkArrayNotEmpty(restaurantTokens)) {
      try {
        let notificationTokensList = [];
        notificationTokensList = restaurantTokens.map((obj) => obj.token);
        notificationPayload.tokens = notificationTokensList;
        await admin.messaging().sendEachForMulticast(notificationPayload);
        // eslint-disable-next-line no-unused-vars
      } catch (error) {
        //
      }
    }
  }
};

const adminSendNotification = async (to, title, description) => {
  if (to === 'all') {
    try {
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      const tokens = await PushNotificationToken.distinct('token', {}, { token: 1 });
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  } else if (to === 'customer') {
    try {
      const regularAndGuestUserId = await User.distinct('_id', {
        $or: [{ role: 'user' }, { role: 'guest' }],
      });
      const userIds = regularAndGuestUserId.map((doc) => new mongoose.Types.ObjectId(doc));
      const tokens = await PushNotificationToken.distinct('token', { user: { $in: userIds } });
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  } else if (to === 'restaurant') {
    try {
      const vendorAndOutletUserId = await User.distinct('_id', {
        $or: [{ role: 'vendor' }, { role: 'vendorOutlet' }],
      });
      const userIds = vendorAndOutletUserId.map((doc) => new mongoose.Types.ObjectId(doc));
      const tokens = await PushNotificationToken.distinct('token', { user: { $in: userIds } });
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  } else if (to === 'deliveryman') {
    try {
      const systemAndVendoDeliverymanUserId = await User.distinct('_id', {
        $or: [{ role: 'driver' }, { role: 'vendorDriver' }],
      });
      const userIds = systemAndVendoDeliverymanUserId.map(
        (doc) => new mongoose.Types.ObjectId(doc)
      );
      const tokens = await PushNotificationToken.distinct('token', { user: { $in: userIds } });
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
  return { success: true };
};

const cityzenSendNotificaiton = async (masterId, to, title, description) => {
  const cityzen = await User.findById(masterId, { city: 1 });
  if (!cityzen) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  const { city } = cityzen;
  if (to === 'all') {
    try {
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      const userId = await User.distinct(
        '_id',
        { city: new mongoose.Types.ObjectId(city) },
        { _id: 1 }
      );
      const tokens = await PushNotificationToken.distinct(
        'token',
        { user: { $in: userId } },
        { token: 1 }
      );
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  } else if (to === 'customer') {
    try {
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      const userId = await User.distinct('_id', {
        $and: [
          { city: new mongoose.Types.ObjectId(city) },
          {
            $or: [{ role: 'user' }, { role: 'guest' }],
          },
        ],
      });
      const tokens = await PushNotificationToken.distinct(
        'token',
        { user: { $in: userId } },
        { token: 1 }
      );
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  } else if (to === 'restaurant') {
    try {
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      const userId = await User.distinct('_id', {
        $and: [
          { city: new mongoose.Types.ObjectId(city) },
          {
            $or: [{ role: 'vendor' }, { role: 'vendorOutlet' }],
          },
        ],
      });
      const tokens = await PushNotificationToken.distinct(
        'token',
        { user: { $in: userId } },
        { token: 1 }
      );
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  } else if (to === 'deliveryman') {
    try {
      const notificationPayload = {
        notification: {
          title: `${title}`,
          body: description,
        },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'general',
          value: `general`,
          extra: `general`,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens: [],
      };
      const userId = await User.distinct('_id', {
        $and: [
          { city: new mongoose.Types.ObjectId(city) },
          {
            $or: [{ role: 'driver' }, { role: 'vendorDriver' }],
          },
        ],
      });
      const tokens = await PushNotificationToken.distinct(
        'token',
        { user: { $in: userId } },
        { token: 1 }
      );
      notificationPayload.tokens = tokens;
      await admin.messaging().sendEachForMulticast(notificationPayload);
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      //
    }
  }
  return { success: true };
};

/**
 * Real Estate push senders — one per event type in
 * `RealEstateNotification.eventType` (20 total, plan Phase 10).
 *
 * Two halves, same rule as the rest of this file: push first, record
 * second, and neither half may throw into the business action that fired
 * the event. Titles/bodies arrive pre-rendered from the caller, which is
 * what keeps these twenty functions thin instead of twenty copies of the
 * locale/translation lookup above.
 */
const sendRealEstatePush = async (eventType, { userId, recipientType, title, body = '', data = {} } = {}) => {
  if (!userId || !recipientType || !title) return;
  const flat = {};
  try {
    for (const [k, v] of Object.entries(data || {})) flat[k] = v === null || v === undefined ? '' : String(v);
  } catch (e) {
    /* non-object data — send without extras */
  }
  try {
    const tokens = await PushNotificationToken.distinct('token', {
      user: new mongoose.Types.ObjectId(userId),
    });
    if (tokens && tokens.length) {
      await admin.messaging().sendEachForMulticast({
        notification: { title: `${title}`, body: `${body}` },
        data: {
          click_action: 'FLUTTER_NOTIFICATION_CLICK',
          type: 'real_estate',
          value: eventType,
          extra: eventType,
          ...flat,
        },
        android: {
          priority: 'high',
          notification: {
            channelId: 'high_importance_channel',
            priority: 'max',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
        },
        tokens,
      });
    }
  } catch (error) {
    //
  }
  try {
    // Lazy require: real-estate services require this file at top level.
    const reNotify = require('../modules/realestate/services/realestate.notification.service');
    await reNotify.fire({ eventType, recipient: userId, recipientType, title, body, data });
  } catch (error) {
    //
  }
};

const realEstateLeadCreated = (a) => sendRealEstatePush('LEAD_CREATED', a);
const realEstateLeadAssigned = (a) => sendRealEstatePush('LEAD_ASSIGNED', a);
const realEstateVisitRequested = (a) => sendRealEstatePush('VISIT_REQUESTED', a);
const realEstateVisitAssigned = (a) => sendRealEstatePush('VISIT_ASSIGNED', a);
const realEstateVisitReminder = (a) => sendRealEstatePush('VISIT_REMINDER', a);
const realEstateVisitCompleted = (a) => sendRealEstatePush('VISIT_COMPLETED', a);
const realEstateInterestRecorded = (a) => sendRealEstatePush('INTEREST_RECORDED', a);
const realEstateFollowUpDue = (a) => sendRealEstatePush('FOLLOW_UP_DUE', a);
const realEstateFollowUpOverdue = (a) => sendRealEstatePush('FOLLOW_UP_OVERDUE', a);
const realEstateHoldCreated = (a) => sendRealEstatePush('HOLD_CREATED', a);
const realEstateHoldExpiring = (a) => sendRealEstatePush('HOLD_EXPIRING', a);
const realEstateHoldExpired = (a) => sendRealEstatePush('HOLD_EXPIRED', a);
const realEstateHoldRefunded = (a) => sendRealEstatePush('HOLD_REFUNDED', a);
const realEstateSaleRecorded = (a) => sendRealEstatePush('SALE_RECORDED', a);
const realEstateCommissionEarned = (a) => sendRealEstatePush('COMMISSION_EARNED', a);
const realEstateSettlementCreated = (a) => sendRealEstatePush('SETTLEMENT_CREATED', a);
const realEstateLoanOfferReceived = (a) => sendRealEstatePush('LOAN_OFFER_RECEIVED', a);
const realEstateLoanSanctioned = (a) => sendRealEstatePush('LOAN_SANCTIONED', a);
const realEstateLoanDisbursed = (a) => sendRealEstatePush('LOAN_DISBURSED', a);
const realEstateDocumentVerified = (a) => sendRealEstatePush('DOCUMENT_VERIFIED', a);

/**
 * Prune dead device tokens after a multicast: NotRegistered (uninstalled /
 * stale) and mismatched-credential (token from another Firebase project —
 * dev build or rotated google-services.json) can never succeed with this
 * project. Without this the table grows unbounded (seen: 121 rows/user)
 * and every push pays for dead sends.
 */
const pruneDeadTokens = async (registrationTokens, responses) => {
  try {
    if (!responses || !responses.length) return 0;
    const dead = [];
    for (let i = 0; i < responses.length; i += 1) {
      const r = responses[i];
      const code = r && r.error && r.error.code;
      if (!r.success && (code === 'messaging/registration-token-not-registered' || code === 'messaging/mismatched-credential')) {
        dead.push(registrationTokens[i]);
      }
    }
    if (!dead.length) return 0;
    const res = await PushNotificationToken.deleteMany({ token: { $in: dead } });
    return res.deletedCount || 0;
  } catch {
    return 0;
  }
};

/**
 * Enterprise: payment-failed push (verify rejected at paid_success).
 * Covers app-killed / UPI-switch cases where the in-app failure modal never
 * renders: without this the customer sees nothing and the money confusion
 * festers until reconcile. `reason` is a short code for copy selection.
 */
const userPaymentFailed = async (orderId, userId, reason = 'verify') => {
  try {
    if (!orderId || !userId) return { skipped: 'no-args' };
    const order = await Orders.findById(orderId, { orderNo: 1 }).lean();
    const orderNo = order && order.orderNo ? `#${order.orderNo}` : `#${orderId}`;
    let title = 'Payment failed';
    let body = `Payment for order ${orderNo} could not be verified. No money was charged. Tap to retry.`;
    if (reason === 'not_captured') {
      title = 'Payment not completed';
      body = `Payment for order ${orderNo} was not captured. No money was charged. Tap to retry.`;
    }
    try {
      const tpl = await OrderNotificationTranslation.findOne({ slug: 'user-payment-failed' }).lean();
      if (tpl && tpl.title && tpl.description) {
        title = tpl.title;
        body = tpl.description;
      }
    } catch {
      // Fall through to built-in copy.
    }
    body = body.replace('{{orderNo}}', orderNo);
    const tokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    ).lean();
    const registrationTokens = (tokens || []).map((t) => t.token).filter(Boolean);
    if (!registrationTokens.length) return { skipped: 'no-tokens' };
    const payload = {
      notification: { title, body: body.slice(0, 180) },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        category: 'payment_failed',
        action: 'repay',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: { channelId: 'high_importance_channel', priority: 'max', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
      tokens: registrationTokens,
    };
    const result = await admin.messaging().sendEachForMulticast(payload);
    result.pruned = await pruneDeadTokens(registrationTokens, result.responses);
    return result;
  } catch (e) {
    logger.error(`userPaymentFailed failed: ${e && e.message}`);
    return { skipped: 'error' };
  }
};

/**
 * Enterprise: pending-payment pushes (30-min window).
 *
 * - userPaymentPending: instant, at online order creation. Tells the exact
 *   window ("complete within 30 minutes") + deep-links the order.
 * - userPaymentExpiring: reminder sweep (cron, ~5 min left). Same deep link.
 * Both try OrderNotificationTranslation slugs first
 * (`user-payment-pending` / `user-payment-expiring`) and fall back to
 * built-in English so they work without an admin seed. Fire-and-forget:
 * callers must never let a push failure fail the order.
 */
const userPaymentPending = async (orderId, userId, windowMin = 30) => {
  try {
    if (!orderId || !userId) return { skipped: 'no-args' };
    const order = await Orders.findById(orderId, { orderNo: 1 }).lean();
    const orderNo = order && order.orderNo ? `#${order.orderNo}` : `#${orderId}`;
    let title = 'Complete your payment';
    let body = `Order ${orderNo} is waiting — complete payment within ${windowMin} minutes or it expires.`;
    try {
      const tpl = await OrderNotificationTranslation.findOne({ slug: 'user-payment-pending' }).lean();
      if (tpl && tpl.title && tpl.description) {
        title = tpl.title;
        body = tpl.description;
      }
    } catch {
      // Fall through to built-in copy.
    }
    body = body.replace('{{orderNo}}', orderNo).replace('{{minutes}}', `${windowMin}`);
    const tokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    ).lean();
    const registrationTokens = (tokens || []).map((t) => t.token).filter(Boolean);
    if (!registrationTokens.length) return { skipped: 'no-tokens' };
    const payload = {
      notification: { title, body: body.slice(0, 180) },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        category: 'payment_pending',
        action: 'pay',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: { channelId: 'high_importance_channel', priority: 'max', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
      tokens: registrationTokens,
    };
    const result = await admin.messaging().sendEachForMulticast(payload);
    result.pruned = await pruneDeadTokens(registrationTokens, result.responses);
    return result;
  } catch (e) {
    logger.error(`userPaymentPending failed: ${e && e.message}`);
    return { skipped: 'error' };
  }
};

const userPaymentExpiring = async (orderId, userId, minutesLeft = 5) => {  try {
    if (!orderId || !userId) return { skipped: 'no-args' };
    const order = await Orders.findById(orderId, { orderNo: 1 }).lean();
    const orderNo = order && order.orderNo ? `#${order.orderNo}` : `#${orderId}`;
    let title = 'Payment expiring soon';
    let body = `Order ${orderNo}: only ${minutesLeft} minutes left to pay before it expires. Tap to repay now.`;
    try {
      const tpl = await OrderNotificationTranslation.findOne({ slug: 'user-payment-expiring' }).lean();
      if (tpl && tpl.title && tpl.description) {
        title = tpl.title;
        body = tpl.description;
      }
    } catch {
      // Fall through to built-in copy.
    }
    body = body.replace('{{orderNo}}', orderNo).replace('{{minutes}}', `${minutesLeft}`);
    const tokens = await PushNotificationToken.find(
      { user: new mongoose.Types.ObjectId(userId) },
      { token: 1 }
    ).lean();
    const registrationTokens = (tokens || []).map((t) => t.token).filter(Boolean);
    if (!registrationTokens.length) return { skipped: 'no-tokens' };
    const payload = {
      notification: { title, body: body.slice(0, 180) },
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'order',
        category: 'payment_expiring',
        action: 'repay',
        value: `${orderId}`,
        extra: `${orderId}`,
      },
      android: {
        priority: 'high',
        notification: { channelId: 'high_importance_channel', priority: 'max', clickAction: 'FLUTTER_NOTIFICATION_CLICK' },
      },
      tokens: registrationTokens,
    };
    const result = await admin.messaging().sendEachForMulticast(payload);
    result.pruned = await pruneDeadTokens(registrationTokens, result.responses);
    return result;
  } catch (e) {
    logger.error(`userPaymentExpiring failed: ${e && e.message}`);
    return { skipped: 'error' };
  }
};

module.exports = {
  supportChatMessage,
  supportChatAgentAlert,
  sendTestNotification,
  restaurantNewOrder,
  scheduleOrder,
  acceptPrepareOrder,
  driverNewOrder,
  autoDriverNewOrder,
  driverAcceptOrder,
  driverRejectOrder,
  driverReachedRestaurant,
  restaurantOrderHandoverToDriver,
  restaurantOrderHandoverToCustomer,
  driverOngoingOrder,
  driverReachedCustomer,
  driverDeliveOrder,
  restaurantRejectOrder,
  userCancleOrder,
  userPaymentPending,
  userPaymentExpiring,
  userPaymentFailed,
  adminCancelRefundRequest,
  approvedRefundRequest,
  purchasedTiffinSubscriptionPackage,
  userCancelledTiffinSubscriptionPackage,
  adminCancelTiffinSubscriptionRefundRequest,
  approvedTiffinSubscriptionRefundRequest,
  restaurantNewBooking,
  userCancelDiningBooking,
  adminCancelDiningBookingRefundRequest,
  adminApprovedDiningBookingRefundRequest,
  acceptDiningBookingRequest,
  rejectDiningBookingRequest,
  completeDiningBookingRequest,
  kitchenOwnerNewOrder,
  kitchenCompleteOrder,
  adminSendNotification,
  cityzenSendNotificaiton,
  sendRealEstatePush,
  realEstateLeadCreated,
  realEstateLeadAssigned,
  realEstateVisitRequested,
  realEstateVisitAssigned,
  realEstateVisitReminder,
  realEstateVisitCompleted,
  realEstateInterestRecorded,
  realEstateFollowUpDue,
  realEstateFollowUpOverdue,
  realEstateHoldCreated,
  realEstateHoldExpiring,
  realEstateHoldExpired,
  realEstateHoldRefunded,
  realEstateSaleRecorded,
  realEstateCommissionEarned,
  realEstateSettlementCreated,
  realEstateLoanOfferReceived,
  realEstateLoanSanctioned,
  realEstateLoanDisbursed,
  realEstateDocumentVerified,
};

