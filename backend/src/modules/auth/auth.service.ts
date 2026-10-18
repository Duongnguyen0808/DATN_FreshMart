import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import { env } from '../../config/env.js';
import { verifyPassword, hashPassword } from './password.js';
import { publicUser, userInclude } from './auth.repository.js';

const key = new TextEncoder().encode(env.JWT_SECRET);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => new AppError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
const dummyHash = hashPassword(randomBytes(32).toString('hex'));
export const sessionDays = 7;
export function signAccess(userId: string, sessionId: string, expiration = '15m') {
  return new SignJWT({ sid: sessionId }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId).setIssuer('smart-store').setAudience('smart-store-app')
    .setJti(randomUUID()).setIssuedAt().setExpirationTime(expiration).sign(key);
}
export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email }, include: userInclude });
  const matches = await verifyPassword(password, user?.passwordHash ?? await dummyHash);
  if (!user || !matches || !user.active) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.');
  }
  const id = randomUUID();
  const refreshToken = `${id}.${randomBytes(32).toString('base64url')}`;
  await prisma.$transaction([
    prisma.session.create({ data: { id, userId: user.id, refreshHash: digest(refreshToken), expiresAt: new Date(Date.now() + sessionDays * 86400000) } }),
    prisma.auditLog.create({ data: { actorId: user.id, action: 'auth.login', targetId: id } }),
  ]);
  return { accessToken: await signAccess(user.id, id), refreshToken, user: publicUser(user) };
}
function sessionId(token: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
  return token.split('.')[0]!;
}
export async function refresh(token: string) {
  const id = sessionId(token);
  const session = await prisma.session.findUnique({ where: { id }, include: { user: { include: userInclude } } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) throw invalid();
  if (session.refreshHash !== digest(token)) {
    await prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
    throw invalid();
  }
  const refreshToken = `${id}.${randomBytes(32).toString('base64url')}`;
  const accessToken = await signAccess(session.userId, id);
  const changed = await prisma.session.updateMany({
    where: { id, refreshHash: digest(token), revokedAt: null, expiresAt: { gt: new Date() }, user: { active: true } },
    data: { refreshHash: digest(refreshToken) },
  });
  if (changed.count !== 1) {
    // A concurrent reuse follows the same revocation policy as a later replay.
    await prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    throw invalid();
  }
  return { accessToken, refreshToken, user: publicUser(session.user) };
}
export async function authenticateToken(token: string) {
  let payload;
  try { ({ payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: 'smart-store', audience: 'smart-store-app' })); }
  catch { throw invalid(); }
  if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string') throw invalid();
  const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: { include: userInclude } } });
  if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt <= new Date() || !session.user.active) throw invalid();
  return { user: publicUser(session.user), sessionId: session.id };
}
export async function logout(id: string, actorId: string) {
  await prisma.$transaction(async tx => {
    const revoked = await tx.session.updateMany({
      where: { id, userId: actorId, revokedAt: null }, data: { revokedAt: new Date() },
    });
    if (revoked.count === 1) {
      await tx.auditLog.create({ data: { actorId, action: 'auth.logout', targetId: id } });
    }
  });
}
