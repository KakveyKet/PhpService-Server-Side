import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { ROLES, STAFF_ROLES } from '../constants/index.js';
import Customer from '../models/Customer.js';
import User from '../models/User.js';

let io = null;
let sequence = 0;

function socketDebug(message, details = '') {
  if (process.env.SOCKET_DEBUG !== 'true') return;
  console.log(`[socket] ${message}`, details);
}

function tokenFromSocket(socket) {
  const authToken = socket.handshake.auth?.token;
  if (authToken) return String(authToken);

  const authorization = socket.handshake.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
}

function safeChangePayload({ topics, action, entityId = null }) {
  sequence += 1;

  return {
    eventId: `${Date.now()}-${sequence}`,
    sequence,
    topics: [...new Set(topics)].filter(Boolean),
    action,
    entityId: entityId ? String(entityId) : null,
    occurredAt: new Date().toISOString()
  };
}

export function initializeRealtime(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      // JWT authentication below protects every connection. Accepting the
      // browser origin prevents valid same-origin Nginx deployments from being
      // rejected when CLIENT_URL contains an old domain or development URL.
      origin: true,
      credentials: false,
      methods: ['GET', 'POST']
    },
    transports: ['polling', 'websocket'],
    pingInterval: 25000,
    pingTimeout: 20000,
    connectTimeout: 15000
  });

  io.use(async (socket, next) => {
    try {
      const token = tokenFromSocket(socket);
      if (!token) return next(new Error('Authentication is required'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.sub).populate('roleId');

      if (!user || user.status !== 'ACTIVE' || user.roleId?.status !== 'ACTIVE') {
        return next(new Error('Account is unavailable'));
      }

      socket.data.userId = user._id.toString();
      socket.data.role = user.roleId.name;

      if (user.roleId.name === ROLES.CUSTOMER) {
        const customer = await Customer.findOne({ userId: user._id }).select('_id');
        socket.data.customerId = customer?._id?.toString() || null;
      }

      return next();
    } catch (error) {
      socketDebug('authentication rejected', error?.message || 'unknown error');
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const rooms = [
      `user:${socket.data.userId}`,
      `role:${socket.data.role}`
    ];

    if (socket.data.customerId) {
      rooms.push(`customer:${socket.data.customerId}`);
    }

    socket.join(rooms);
    socketDebug('connected', {
      socketId: socket.id,
      userId: socket.data.userId,
      role: socket.data.role,
      rooms
    });

    socket.on('realtime:ping', (acknowledge) => {
      if (typeof acknowledge === 'function') {
        acknowledge({
          success: true,
          socketId: socket.id,
          occurredAt: new Date().toISOString()
        });
      }
    });

    socket.emit('realtime:ready', {
      connected: true,
      socketId: socket.id,
      occurredAt: new Date().toISOString()
    });

    socket.on('disconnect', (reason) => {
      socketDebug('disconnected', { socketId: socket.id, reason });
    });
  });

  return io;
}

export function publishChange({
  topics,
  action,
  entityId = null,
  staff = false,
  roles = [],
  userIds = [],
  customerIds = []
}) {
  if (!io) {
    socketDebug('event skipped because Socket.IO is not initialized', action);
    return false;
  }

  const payload = safeChangePayload({ topics, action, entityId });
  const targetRooms = new Set();

  if (staff) {
    for (const role of STAFF_ROLES) {
      targetRooms.add(`role:${role}`);
    }
  }

  for (const role of roles.filter(Boolean).map(String)) {
    targetRooms.add(`role:${role}`);
  }

  for (const userId of userIds.filter(Boolean).map(String)) {
    targetRooms.add(`user:${userId}`);
  }

  for (const customerId of customerIds.filter(Boolean).map(String)) {
    targetRooms.add(`customer:${customerId}`);
  }

  for (const room of targetRooms) {
    io.to(room).emit('data:changed', payload);
  }

  socketDebug('data:changed emitted', {
    action,
    topics: payload.topics,
    rooms: [...targetRooms],
    connectedSockets: io.engine.clientsCount
  });

  return true;
}

export function revokeRealtimeSession(userId, reason = 'Account unavailable') {
  if (!io || !userId) return false;

  io.to(`user:${String(userId)}`).emit('session:revoked', {
    reason,
    occurredAt: new Date().toISOString()
  });

  return true;
}

export function realtimeDiagnostics() {
  return {
    initialized: Boolean(io),
    connectedSockets: io?.engine?.clientsCount || 0
  };
}
