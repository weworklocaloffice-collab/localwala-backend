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

const http = require('http');
const mongoose = require('mongoose');
const socketIo = require('socket.io');
const app = require('./app');
const config = require('./config/config');
const logger = require('./config/logger');
const mongoConnectionStatus = require('./config/mongoConnectionStatus');

let server = http.createServer(app);
let io;

// Manual random string generator (replaces crypto)
const generateRandomId = (length = 16) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

mongoose
  .connect(config.mongoose.url, config.mongoose.options)
  .then(() => {
    mongoConnectionStatus.status = true;
    mongoConnectionStatus.error = null;
    logger.info('Connected to MongoDB');

// Initialize Socket.io
io = socketIo(server, {
      cors: {
        origin: config.cors.origins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
    });

    // --- Cross-worker socket fan-out (PM2 cluster) -----------------------
    // Each worker owns its own sockets. Without a shared adapter, a message
    // emitted by worker A is delivered only to sockets attached to worker A, so
    // customers land on one worker and agents on another and nobody sees
    // anything. Redis bridges the workers.
    //
    // Deliberately non-fatal: if REDIS_URL is unset or Redis is unreachable we
    // log and continue on a single instance. A missing cache must never be the
    // reason the API refuses to start.
    if (config.redis && config.redis.url) {
      // eslint-disable-next-line global-require
      const { createClient } = require('redis');
      // eslint-disable-next-line global-require
      const { createAdapter } = require('@socket.io/redis-adapter');
      const pubClient = createClient({ url: config.redis.url });
      const subClient = pubClient.duplicate();
      pubClient.on('error', (e) => logger.error(`Redis pub error: ${e.message}`));
      subClient.on('error', (e) => logger.error(`Redis sub error: ${e.message}`));
      Promise.all([pubClient.connect(), subClient.connect()])
        .then(() => {
          io.adapter(createAdapter(pubClient, subClient, { key: config.redis.keyPrefix }));
          logger.info('Socket.io Redis adapter attached (multi-worker fan-out enabled)');
        })
        .catch((e) => {
          logger.error(
            `Socket.io Redis adapter NOT attached (${e.message}). Running single-instance: chat works, but PM2 cluster workers will NOT share sockets.`
          );
        });
    } else {
      logger.warn('REDIS_URL not set - Socket.io running without a shared adapter (single instance only)');
    }

    // Services need a way to reach a connected socket. Rider order offers were
    // FCM-only until this existed, so a rider learned about work by polling.
    require('./utils/socket.emitter').setSocketServer(io);

    // Authenticate before any room is joined. A socket that has not been
    // verified stays a spectator: it can receive broadcasts but `joinRoom`
    // and `sendMessage` below reject it.
    io.use(async (socket, next) => {
      try {
        // Two transports, matching config/passport.js: the Admin panel is
        // cookie-authenticated (`withCredentials`) while the Flutter apps send
        // `Authorization: Bearer`. Either one is accepted.
        let token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');

        if (!token) {
          const cookies = socket.handshake.headers?.cookie || '';
          const match = cookies
            .split(';')
            .map((c) => c.trim())
            .find((c) => c.startsWith(`${config.jwt.cookieName}=`));
          if (match) token = decodeURIComponent(match.slice(config.jwt.cookieName.length + 1));
        }
        if (!token) return next(new Error('unauthorized'));

        // Same verification the REST side does in config/passport.js: signature
        // AND the token must be an ACCESS token AND the user must still exist.
        const jwt = require('jsonwebtoken');
        const { tokenTypes } = require('./config/tokens');
        const { User } = require('./models');
        const payload = jwt.verify(token, config.jwt.secret);
        if (!payload || payload.type !== tokenTypes.ACCESS || !payload.sub) {
          return next(new Error('unauthorized'));
        }
        const user = await User.findById(payload.sub).select('_id role').lean();
        if (!user) return next(new Error('unauthorized'));

        socket.data.user = { id: user._id.toString(), role: user.role };
        socket.data.authenticated = true;
        return next();
      } catch (e) {
        logger.error(`Socket auth failed: ${e.message}`);
        return next(new Error('unauthorized'));
      }
    });

    io.on('connection', (socket) => {
      logger.info(`New Socket Connection: ${socket.id}`);

      // --- Chat Logic ---
      // Membership is checked server side. Previously ANY socket could join any
      // room by guessing an id and read every message in it.
      const canJoin = async (chatRoomId) => {
        if (!chatRoomId) return false;
        try {
          const { SupportChatRoom, ChatRoom } = require('./models');
          const userId = socket.data.user?.id;
          if (!userId) return false;
          const uid = new mongoose.Types.ObjectId(userId);
          const supportRoom = await SupportChatRoom.exists({ _id: chatRoomId, userId: uid });
          if (supportRoom) return true;
          // Supervisors barge into any thread: oversight requires access, and
          // every supervisor action is audit-stamped on the ticket.
          if (socket.data.user?.role === 'supportSupervisor') {
            const anySupport = await SupportChatRoom.exists({ _id: chatRoomId });
            if (anySupport) return true;
          }
          // Agents: assigned, team-claimed, or queue member. Without this an
          // agent's join/send is silently dropped and their bubbles stick on
          // "sending" forever (refresh only re-fetches REST history).
          const agentRoom = await SupportChatRoom.exists({
            _id: chatRoomId,
            $or: [{ assignedAgent: uid }, { supportTeam: uid }],
          });
          if (agentRoom) return true;
          const peerRoom = await ChatRoom.findOne({
            _id: chatRoomId,
            $or: [{ senderId: uid }, { receiverId: uid }],
          }).lean();
          return !!peerRoom;
        } catch {
          return false;
        }
      };

      socket.on('joinRoom', async ({ chatRoomId }) => {
        if (!socket.data.authenticated) return;
        if (await canJoin(chatRoomId)) socket.join(chatRoomId);
        else logger.warn(`Socket ${socket.id} denied join on ${chatRoomId}`);
      });

      socket.on('leaveRoom', async ({ chatRoomId }) => {
        if (chatRoomId) socket.leave(chatRoomId);
      });

      // Persist-then-emit. The old handler only emitted, so a DB write that
      // never happened produced a message the peer could see but nobody could
      // audit, and a socket that failed left a row nobody ever received.
      socket.on(
        'sendMessage',
        async ({ chatRoomId, senderId, message, role, authRole, randomId, senderFirstName, senderLastName, senderCover }) => {
          // Validate the client id first so every rejection below can name the
          // exact bubble the sender must roll back.
          const echoId =
            typeof randomId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(randomId)
              ? randomId
              : generateRandomId(16);
          if (!socket.data.authenticated) {
            socket.emit('messageFailed', { chatRoomId, randomId: echoId });
            return;
          }
          if (!(await canJoin(chatRoomId))) {
            socket.emit('messageFailed', { chatRoomId, randomId: echoId });
            return;
          }
          if (!message || String(message).length > 2000) {
            socket.emit('messageFailed', { chatRoomId, randomId: echoId });
            return;
          }

          // Echo the CLIENT randomId (validated shape) so the sender's
          // optimistic bubble reconciles instead of sticking on "sending".
          // Previously the server minted its own id and the admin reconcile
          // (`m.id === data.randomId`) could never match.
          const currentDate = new Date().toISOString();
          let messageId;

          try {
            const { supportChatConversionService } = require('./services');
            const { SupportChatRoom } = require('./models');
            const room = await SupportChatRoom.findById(chatRoomId)
              .select('userId assignedAgent supportTeam')
              .lean();
            // A support room contains both sides. The old code saved every
            // socket turn as an agent reply, so a customer's own words were
            // stored under the agent role and could not reconcile as their own.
            const me = String(socket.data.user?.id || '');
            const claimedRole = String(role || authRole || socket.data.user?.role || '').toLowerCase();
            const team = Array.isArray(room?.supportTeam) ? room.supportTeam.map(String) : [];
            const isOwner = !!room?.userId && String(room.userId) === me;
            const isRoomAgent =
              !!room &&
              (String(room.assignedAgent || '') === me ||
                team.includes(me) ||
                socket.data.user?.role === 'supportSupervisor' ||
                ['agent', 'support', 'support_team', 'supportteam', 'admin'].includes(claimedRole));
            const saved = room
              ? isRoomAgent && !isOwner
                ? await supportChatConversionService.saveAgentReply(
                    chatRoomId,
                    senderId,
                    message,
                    'text',
                    { randomId: echoId }
                  )
                : await supportChatConversionService.saveNewMessage(
                    chatRoomId,
                    senderId,
                    message,
                    'text',
                    { senderRole: 'user', randomId: echoId }
                  )
              : await supportChatConversionService.saveNewMessage(
                  chatRoomId,
                  senderId,
                  message,
                  'text'
                );
            messageId = saved.messageId || null;

            // Wake the assigned agent's browsers when the CUSTOMER writes.
            // (Agent's own sends need no alert.) Fire-and-forget: the socket
            // already delivered this to anyone connected.
            if (room && isOwner && !isRoomAgent && room.assignedAgent) {
              try {
                const fcmNotificationService = require('./services/fcm.notification.service');
                fcmNotificationService
                  .supportChatAgentAlert(room.assignedAgent, chatRoomId, message, 'New customer message')
                  .catch(() => {});
              } catch {
                // Push plumbing must never break the send.
              }
            }
          } catch (e) {
            logger.error(`Socket persist failed on ${chatRoomId}: ${e.message}`);
            socket.emit('messageFailed', { chatRoomId, randomId: echoId });
            return;
          }

          const newMessage = {
            senderId,
            message,
            role: role || authRole,
            randomId: echoId,
            messageId,
            currentDate,
            messageType: 'text',
            senderFirstName,
            senderLastName,
            senderCover,
          };
          io.to(chatRoomId).emit('receiveMessage', newMessage);
        }
      );

      // Typing + read receipts — emit-only, never persisted.
      socket.on('typing', ({ chatRoomId, isTyping }) => {
        if (!socket.data.authenticated) return;
        socket.to(chatRoomId).emit('typing', {
          chatRoomId,
          isTyping: !!isTyping,
          userId: socket.data.user?.id,
        });
      });

      socket.on('messageRead', async ({ chatRoomId, upToMessageId }) => {
        if (!socket.data.authenticated) return;
        try {
          const { SupportChatConversion, SupportChatRoom } = require('./models');
          const room = await SupportChatRoom.findById(chatRoomId).select('userId').lean();
          const reader = String(socket.data.user?.id || '');
          const isAgent = room && String(room.userId) !== reader;
          // Only the OTHER party's messages flip to read. The old blanket
          // update marked a sender's own unread rows read the moment they
          // opened the thread — blue ticks on send, before anyone saw it.
          let readerId = null;
          try {
            readerId = new mongoose.Types.ObjectId(reader);
          } catch {
            readerId = null;
          }
          const scope = { roomId: chatRoomId, readStatus: { $ne: 'read' } };
          if (readerId) scope.senderId = { $ne: readerId };
          await SupportChatConversion.updateMany(scope, { $set: { readStatus: 'read' } });
          io.to(chatRoomId).emit('messageRead', { chatRoomId, upToMessageId, by: isAgent ? 'agent' : 'user' });
        } catch (e) {
          logger.error(`Socket messageRead failed: ${e.message}`);
        }
      });

      // --- Live Location Logic ---
      // The driver app joins its own user-id room for its in-app map. Order tracking
      // uses a per-order room instead: the customer proves ownership once, then receives
      // only the deliveries assigned to that order.
      socket.on('joinLiveLocation', ({ driverId }) => {
        if (!socket.data.authenticated || !driverId) return;
        socket.join(driverId);
      });

      socket.on('joinOrderTracking', async ({ orderId }) => {
        if (!socket.data.authenticated || !orderId) return;
        if (!mongoose.Types.ObjectId.isValid(orderId)) return;
        try {
          const { StoreOrder } = require('./models');
          const owns = await StoreOrder.exists({
            _id: orderId,
            customer: socket.data.user.id,
          });
          if (owns) socket.join(`store-order:${String(orderId).toLowerCase()}`);
        } catch (e) {
          logger.warn(`Socket ${socket.id} order tracking join failed: ${e.message}`);
        }
      });

      socket.on('leaveOrderTracking', ({ orderId }) => {
        if (orderId) socket.leave(`store-order:${String(orderId).toLowerCase()}`);
      });

      socket.on('sendLocation', async ({ driverId, latitude, longitude }) => {
        if (!socket.data.authenticated) return;
        // A socket may only report its own position. Without this, any authenticated
        // client could spoof another driver's location by sending their id.
        if (String(driverId) !== String(socket.data.user.id)) return;

        const lat = Number(latitude);
        const lng = Number(longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const newLocation = { driverId, latitude: lat, longitude: lng };
        io.to(String(driverId)).emit('receiveLocation', newLocation);

        // Fan out to the orders this driver is currently carrying. The customer joins
        // `store-order:<orderId>` and never has to know the driver's user id.
        try {
          const { StoreDriver, StoreDelivery } = require('./models');
          const driver = await StoreDriver.findOne({ user: socket.data.user.id }).select('_id').lean();
          if (!driver) return;
          const deliveries = await StoreDelivery.find({
            driver: driver._id,
            status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
          })
            .select('order')
            .lean();
          for (const delivery of deliveries) {
            if (!delivery.order) continue;
            io.to(`store-order:${delivery.order}`).emit('orderLocation', {
              orderId: String(delivery.order),
              latitude: lat,
              longitude: lng,
              at: new Date().toISOString(),
            });
          }
        } catch (e) {
          logger.warn(`Socket ${socket.id} order location fan-out failed: ${e.message}`);
        }
      });

      socket.on('disconnect', () => {
        logger.info(`Socket Disconnected: ${socket.id}`);
      });
    });

server.listen(config.port, () => {
      logger.info(`Listening to port ${config.port}`);

      // Stores scheduled work. Registered here, inside the successful-connection branch,
      // so no sweep ever runs against an unreachable database — a billing sweep that
      // cannot read StoreSubscription would otherwise mark every subscription due.
      if (config.env !== 'test') {
        require('./modules/stores/cron').startCronJobs();
        require('./modules/local-services/cron').startLocalServicesCron();
        require('./modules/jhatka/cron').startJhatkaCron({
          mongoose,
          models: require('./models'),
          utils: {
            commercial: require('./modules/jhatka/utils/commercial.arithmetic'),
            compliance: require('./modules/jhatka/utils/compliance.arithmetic'),
            weight: require('./modules/jhatka/utils/weight.arithmetic'),
          },
        });
        // Support SLA breach, agent-presence expiry and stale-agent requeue.
        require('./cron/support.cron').startSupportCronJobs();
        // Food delivery: expires unanswered rider offers and escalates the order.
        require('./cron/dispatch.cron').startDispatchCronJobs();
        // Food delivery zones: watches ungrouped order volume per city.
        require('./cron/zone.cron').startZoneCronJobs();
      }
    });
  })
  .catch((error) => {
    mongoConnectionStatus.status = false;
    mongoConnectionStatus.error = error.message;
    logger.error(`MongoDB connection failed: ${error.message}`);
    process.exit(1);
  });

// MongoDB Event Listeners
mongoose.connection.on('disconnected', () => {
  mongoConnectionStatus.status = false;
  mongoConnectionStatus.error = 'MongoDB disconnected';
});

mongoose.connection.on('error', (error) => {
  mongoConnectionStatus.status = false;
  mongoConnectionStatus.error = error.message;
});

// Graceful Shutdown
const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

process.on('uncaughtException', (error) => {
  logger.error(error);
  exitHandler();
});

process.on('unhandledRejection', (error) => {
  logger.error(error);
  exitHandler();
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (server) {
    server.close();
  }
});

