/** `GET/PUT /api/pricing`, `POST /api/pricing/reset` */
import { Hono } from 'hono';
import { pricingConfigSchema } from '../../core/pricing/schema.js';
import type { AppDeps } from '../deps.js';
import { parseJsonBody } from '../validate.js';

export function pricingRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get('/', (c) => c.json(deps.config.get().pricing));

  app.put('/', async (c) => {
    const body = await parseJsonBody(c, pricingConfigSchema);
    if (!body.ok) return body.response;
    return c.json(deps.config.updatePricing(body.data));
  });

  app.post('/reset', (c) => c.json(deps.config.resetPricing()));

  return app;
}
