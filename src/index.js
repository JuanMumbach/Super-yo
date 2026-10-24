import './db.js';
import { startWeb } from './web/server.js';
import { setupBot } from './bot.js';
import { bot } from './telegram.js';
import { startScheduler, startupCatchUp } from './scheduler.js';
import { recalcAll } from './priority.js';

recalcAll();
startWeb();
setupBot();
startScheduler();
setTimeout(() => startupCatchUp().catch(e => console.error('catch-up:', e.message)), 5000);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => { bot?.stop(sig); process.exit(0); });
}
