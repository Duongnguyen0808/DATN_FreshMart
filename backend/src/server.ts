import { createServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createApp } from './app.js';
import { checkDatabase, prisma } from './common/database.js';
import { logger } from './common/logger.js';
import { env } from './config/env.js';
import { startForecastAutomation } from './modules/forecasts/automation.js';
import { startPayosReconciliation } from './modules/payos/payos.service.js';
import { authenticateToken } from './modules/auth/auth.service.js';
import { attachIotRealtime } from './modules/iot/iot.realtime.js';

const httpServer = createServer(createApp(checkDatabase));
const io = new SocketServer(httpServer, {
  cors: { origin: env.CORS_ORIGINS.split(',').map(value => value.trim()), credentials: true },
});
attachIotRealtime(io);
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string') return next(new Error('UNAUTHENTICATED'));
  try {
    const { user } = await authenticateToken(token);
    if (!user.permissions.includes('inventory.read') && !user.permissions.includes('*')) return next(new Error('FORBIDDEN'));
    socket.data.iotUser = user;
    next();
  } catch {
    next(new Error('UNAUTHENTICATED'));
  }
});
io.on('connection', async socket => {
  const user = socket.data.iotUser as Awaited<ReturnType<typeof authenticateToken>>['user'];
  const warehouses = await prisma.warehouse.findMany({
    where: user.globalAccess ? {} : { storeId: { in: user.stores.map(store => store.id) } },
    select: { id: true },
  });
  for (const warehouse of warehouses) socket.join(`iot:warehouse:${warehouse.id}`);
});

const server = httpServer.listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT }, 'Backend listening');
});
const stopForecastAutomation = startForecastAutomation();
const stopPayosReconciliation = startPayosReconciliation();
server.on('error', () => {
  logger.error('Unable to start HTTP server');
  process.exit(1);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => {
      stopForecastAutomation();
      stopPayosReconciliation();
      void prisma.$disconnect().finally(() => { clearTimeout(timeout); process.exit(0); });
    });
  });
}
