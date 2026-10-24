// Ejecuta una retrospectiva manual desde la terminal: npm run analizar
import { runAnalysis } from './agent.js';

const r = await runAnalysis('a pedido');
console.log(JSON.stringify(r, null, 2));
process.exit(0);
