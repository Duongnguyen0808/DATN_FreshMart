import { prisma } from '../../common/database.js';
import { logger } from '../../common/logger.js';
import { env } from '../../config/env.js';
import { findUser, publicUser } from '../auth/auth.repository.js';
import { createForecast, getLatestForecast, vietnamDay } from './forecasts.service.js';
import { generateRecommendations } from './recommendations.service.js';

const FORECAST_HORIZONS = [7, 14] as const;
const RECOMMENDATION_HORIZON_DAYS = 14;
const CHECK_EVERY_MS = 30 * 60 * 1000;
let running = false;

async function isAiServiceReady(): Promise<boolean> {
  try {
    const res = await fetch(`${env.AI_SERVICE_URL.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Daily forecast trained from operational sales, with live stock re-analysis throughout the day. */
export async function runForecastAutomation() {
  if (running) return;
  if (!(await isAiServiceReady())) {
    logger.info('AI automation deferred: AI service is still starting up');
    return;
  }
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
      for (const horizonDays of FORECAST_HORIZONS) {
        try {
          const latest = await getLatestForecast(owner, { storeId: store.id, horizonDays });
          if (!latest.run || !latest.run.model.startsWith('Live-') || vietnamDay(latest.run.generatedAt).getTime() < today.getTime()) {
            await createForecast(owner, { storeId: store.id, horizonDays });
            logger.info({ storeId: store.id, storeName: store.name, horizonDays }, 'Daily demand forecast refreshed');
          }
        } catch (error) {
          logger.error({ err: error, storeId: store.id, horizonDays }, 'AI forecast automation failed for store');
        }
      }
      try {
        // Suggestions remain PENDING. This only creates proposals; approval is still manual.
        await generateRecommendations(owner, { storeId: store.id, horizonDays: RECOMMENDATION_HORIZON_DAYS });
      } catch (error) {
        logger.error({ err: error, storeId: store.id }, 'AI recommendation automation failed for store');
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
