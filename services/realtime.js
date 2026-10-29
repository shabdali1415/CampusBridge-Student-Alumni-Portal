const { Server } = require('socket.io');
const { env } = require('../config/env');
const { verifyAccessToken } = require('../utils/tokens');
let io = null;
function init(server) {
  io = new Server(server, { cors: { origin: env.clientOrigin, credentials: true } });
  io.use((socket, next) => { try { socket.data.userId = verifyAccessToken(socket.handshake.auth && socket.handshake.auth.token).sub; } catch (_) {} next(); });
  io.on('connection', (socket) => { if (socket.data.userId) socket.join(`user:${socket.data.userId}`); });
  console.log('[server] Realtime      : Socket.IO ready');
}
const emitSeats = (snapshot) => { if (io) io.emit('seats', snapshot); };
const notifyUser = (userId, payload) => { if (io) io.to(`user:${userId}`).emit('notification', payload); };
module.exports = { init, emitSeats, notifyUser };
