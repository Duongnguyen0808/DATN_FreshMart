import { prisma } from '../../common/database.js';
import { logger } from '../../common/logger.js';
import { findUser, publicUser } from '../auth/auth.repository.js';
import { createForecast, getLatestForecast, vietnamDay } from './forecasts.service.js';
import { generateRecommendations } from './recommendations.service.js';

const HORIZON_DAYS = 14;
const CHECK_EVERY_MS = 30 * 60 * 1000;
let running = false;

/** Daily forecast trained from operational sales, with live stock re-analysis throughout the day. */
export async function runForecastAutomation() {
  if (running) return;
  running = true;
  try {
    const ownerRow = await prisma.user.findFirst({
      where: { active: true, roles: { some: { role: { code: 'OWNER' } } } },
      select: { id: true },
    });
    if (!ownerRow) {
      logger.warn('AI automation skipped: no active owner account');
      return;
    }
    const ownerRecord = await findUser(ownerRow.id);
    if (!ownerRecord) return;
    const owner = publicUser(ownerRecord);
    const stores = await prisma.store.findMany({ where: { active: true }, select: { id: true, name: true } });
    const today = vietnamDay(new Date());

    for (const store of stores) {
      try {
        const latest = await getLatestForecast(owner, { storeId: store.id, horizonDays: HORIZON_DAYS });
        if (!latest.run || !latest.run.model.startsWith('Live-') || vietnamDay(latest.run.generatedAt).getTime() < today.getTime()) {
          await createForecast(owner, { storeId: store.id, horizonDays: HORIZON_DAYS });
          logger.info({ storeId: store.id, storeName: store.name }, 'Daily demand forecast refreshed');
        }
        // Suggestions remain PENDING. This only creates proposals; approval is still manual.
        await generateRecommendations(owner, { storeId: store.id, horizonDays: HORIZON_DAYS });
      } catch (error) {
        logger.error({ err: error, storeId: store.id }, 'AI forecast automation failed for store');
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'AI forecast automation failed');
  } finally {
    running = false;
  }
}

export function startForecastAutomation() {
  const timer = setInterval(() => { void runForecastAutomation(); }, CHECK_EVERY_MS);
  timer.unref();
  // Startup check makes a newly started backend populate today's forecast without waiting.
  const startup = setTimeout(() => { void runForecastAutomation(); }, 10_000);
  startup.unref();
  return () => { clearInterval(timer); clearTimeout(startup); };
}
