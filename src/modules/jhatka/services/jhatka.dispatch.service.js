/**
 * jhatka.dispatch.service.js — the dispatch picker.
 *
 * `POST /orders/:order/dispatch` takes a driver id, so the dispatcher needs a
 * list of this outlet's riders with eligibility spelled out. Eligibility mirrors
 * the dispatch guards (outlet-owned, active, not blocked): ineligible riders
 * are listed with the reason rather than hidden, so a dispatcher staring at
 * one rider sees WHY they cannot dispatch instead of an empty list.
 */

const { status: httpStatus } = require('http-status');

const ApiError = require('../../../utils/ApiError');

/**
 * Riders of one outlet, outlet-scoped so another outlet's riders are
 * indistinguishable from none.
 */
async function listOutletDrivers({ models, outletId }) {
  if (!outletId) throw new ApiError(httpStatus.BAD_REQUEST, 'outletId is required');

  const drivers = await models.JhatkaDriver.find({ outlet: outletId })
    .select('_id name vehicle status isBlocked blockReason rating')
    .sort({ name: 1 })
    .lean();

  return {
    drivers: drivers.map((d) => {
      const eligible = d.status === 'active' && !d.isBlocked;
      return {
        id: String(d._id),
        name: d.name,
        vehicle: d.vehicle || null,
        status: d.status,
        rating: d.rating ?? null,
        eligible,
        ineligibleReason: eligible
          ? null
          : d.isBlocked
            ? d.blockReason || 'blocked'
            : `status is ${d.status}`,
      };
    }),
  };
}

/**
 * Outlet deliveries for the dispatch console, newest first.
 *
 * Partner-side mirror of the rider's own list, scoped by outlet instead of
 * driver. `active=true` narrows to in-flight states.
 */
async function listOutletDeliveries({ models, outletId, query }) {
  const { page = 1, limit = 20, active } = query || {};
  const filter = { outlet: outletId };
  if (active === 'true') {
    filter.status = {
      $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery', 'arrived'],
    };
  }

  const deliveries = await models.JhatkaDelivery.find(filter)
    .populate('order', 'orderNo lifecycle estimatedTotal finalTotal codAmount addressSnapshot')
    .populate('driver', 'name')
    .sort({ assignedAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Math.min(Number(limit), 100))
    .lean();

  return {
    deliveries: deliveries.map((d) => ({
      id: String(d._id),
      deliveryNo: d.deliveryNo,
      status: d.status,
      codStatus: d.codStatus,
      codCollectionAmount: d.codCollectionAmount,
      codCollectedAmount: d.codCollectedAmount,
      assignedAt: d.assignedAt,
      driver: d.driver ? { id: String(d.driver._id), name: d.driver.name } : null,
      order: d.order
        ? {
          id: String(d.order._id),
          orderNo: d.order.orderNo,
          lifecycle: d.order.lifecycle,
          finalTotal: d.order.finalTotal,
        }
        : null,
    })),
    page: Number(page),
    limit: Number(limit),
  };
}

/**
 * One delivery with its order lines and POD, outlet-scoped.
 */
async function getOutletDelivery({ models, outletId, delivery }) {
  const found = await models.JhatkaDelivery.findOne({
    _id: delivery,
    outlet: outletId,
  }).lean();
  if (!found) throw new ApiError(httpStatus.NOT_FOUND, 'Delivery not found for this outlet');

  const [order, pod] = await Promise.all([
    models.JhatkaOrder.findById(found.order)
      .select('orderNo lifecycle items estimatedTotal finalTotal codAmount')
      .lean(),
    models.JhatkaDeliveryPOD.findOne({ delivery: found._id }).lean(),
  ]);

  return {
    delivery: {
      id: String(found._id),
      deliveryNo: found.deliveryNo,
      status: found.status,
      codStatus: found.codStatus,
      codAmount: found.codAmount,
      codCollectionAmount: found.codCollectionAmount,
      codCollectedAmount: found.codCollectedAmount,
      codVariance: found.codVariance,
      addressSnapshot: found.addressSnapshot,
      receiverName: found.receiverName,
      receiverContact: found.receiverContact,
      coldChain: found.coldChain,
      attempts: found.attempts,
      maxAttempts: found.maxAttempts,
      assignedAt: found.assignedAt,
      driver: found.driver ? String(found.driver) : null,
    },
    order: order
      ? {
        id: String(order._id),
        orderNo: order.orderNo,
        lifecycle: order.lifecycle,
        items: (order.items || []).map((i) => ({
          sku: i.sku,
          name: i.name,
          requestedQuantity: i.requestedQuantity,
          actualQuantity: i.actualQuantity,
        })),
      }
      : null,
    pod: pod
      ? {
        id: String(pod._id),
        clientRef: pod.clientRef,
        deliveredTempC: pod.deliveredTempC,
        coldChainBreached: pod.coldChainBreached,
        codCollected: pod.codCollected,
        capturedAt: pod.capturedAt,
      }
      : null,
  };
}

/**
 * Edit a rider. Name, mobile and vehicle only — status moves through the
 * dedicated transitions below so every change carries its reason, and the
 * outlet can never change (a rider belongs to one outlet; transfers are a
 * deactivate-here + invite-there, both audited).
 */
async function updateDriver({ models, outletId, driver, body }) {
  const doc = await models.JhatkaDriver.findOne({ _id: driver, outlet: outletId });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found for this outlet');

  const { name, mobile, vehicle } = body || {};
  if (name !== undefined) {
    if (String(name).trim().length < 2) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'name must be at least 2 characters');
    }
    doc.name = String(name).trim();
  }
  if (mobile !== undefined) {
    if (!Number.isInteger(Number(mobile))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'mobile must be an integer');
    }
    doc.mobile = Number(mobile);
  }
  if (vehicle !== undefined) {
    doc.vehicle = vehicle;
  }
  await doc.save();

  return {
    driver: {
      id: String(doc._id),
      name: doc.name,
      mobile: doc.mobile,
      vehicle: doc.vehicle || null,
      status: doc.status,
    },
  };
}

/**
 * Move a rider between active/inactive/suspended. Never deleted (BR-24:
 * delivery history is a settlement input). Blocking is admin-only and lives
 * outside this transition — suspend keeps history accumulating, block stops it.
 */
async function setDriverStatus({ models, outletId, actor, driver, status, reason }) {
  const allowed = ['active', 'inactive', 'suspended'];
  if (!allowed.includes(status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, `status must be one of ${allowed.join(', ')}`);
  }

  const doc = await models.JhatkaDriver.findOne({ _id: driver, outlet: outletId });
  if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Driver not found for this outlet');
  if (doc.status === status) {
    throw new ApiError(httpStatus.CONFLICT, `Driver is already ${status}`);
  }
  if (doc.isBlocked && status === 'active') {
    throw new ApiError(
      httpStatus.CONFLICT,
      'Blocked riders cannot be reactivated here — unblock is an admin action',
      true,
      '',
      { code: 'DRIVER_BLOCKED', blockReason: doc.blockReason }
    );
  }

  doc.status = status;
  doc.statusReason = reason || undefined;
  if (status !== 'active') doc.available = false;
  await doc.save();

  return {
    driver: {
      id: String(doc._id),
      name: doc.name,
      status: doc.status,
      statusReason: doc.statusReason || null,
      available: doc.available,
    },
  };
}

module.exports = {
  listOutletDrivers,
  listOutletDeliveries,
  getOutletDelivery,
  updateDriver,
  setDriverStatus,
};
