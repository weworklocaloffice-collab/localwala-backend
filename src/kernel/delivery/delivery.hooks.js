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

/**
 * A one-line event contract for the shared delivery kernel.
 *
 * The kernel moves deliveries for every vertical, so it must not import a
 * vertical's services. But a vertical does need to react when something happens
 * downstream — the dairy module, for instance, has to mark a subscription order
 * delivered when its stop completes, or the order stays `confirmed` and settled
 * revenue never appears.
 *
 * This is the seam that lets the dairy register that reaction without the kernel
 * ever knowing dairy exists. The dependency points one way only: the kernel
 * defines the event names, a module subscribes.
 *
 * Handlers are isolated. A vertical that throws must not fail a rider's stop
 * delivery — a delivery is recorded at the door regardless of whether some
 * accounting follow-up worked, so handler failures are logged, not propagated.
 */

const logger = require('../../config/logger');

/** event name -> array of handlers */
const handlers = new Map();

/**
 * Subscribes to a delivery event.
 *
 * @param {string} event
 * @param {Function} handler
 */
const register = (event, handler) => {
  if (typeof handler !== 'function') {
    throw new TypeError(`Handler for "${event}" must be a function`);
  }
  if (!handlers.has(event)) {
    handlers.set(event, []);
  }
  handlers.get(event).push(handler);
};

/**
 * Notifies every subscriber. Never throws.
 *
 * @param {string} event
 * @param {Object} payload
 */
const emit = async (event, payload) => {
  const subscribers = handlers.get(event);
  if (!subscribers || subscribers.length === 0) {
    return;
  }

  for (const handler of subscribers) {
    try {
      await handler(payload);
    } catch (error) {
      logger.error(`delivery hook "${event}" failed — ${error.message}`);
    }
  }
};

module.exports = {
  register,
  emit,
};
