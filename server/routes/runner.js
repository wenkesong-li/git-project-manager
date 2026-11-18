'use strict';
module.exports = (add, ctx) => {
  function project(id) { const value = ctx.dbm.getProject(id); if (!value) throw new Error('项目不存在'); return value; }
  add('GET', '/api/environment', async () => ({ environment: ctx.runner.readEnvironment() }));
  add('PUT', '/api/environment', async ({ body }) => { const result = ctx.runner.saveEnvironment(body); ctx.javaIntelligence.close(); return result; });
  add('POST', '/api/environment/detect', async ({ body }) => ctx.runner.detect(body));
  add('GET', '/api/environment/catalog', async () => ({ catalog:await ctx.runner.prepare(), roots:ctx.runner.searchRoots() }));
  add('POST', '/api/environment/scan', async ({body}) => { if(body.roots!==undefined) ctx.runner.saveSearchRoots(body.roots); return {catalog:await ctx.runner.prepare(true),roots:ctx.runner.searchRoots()}; });
  add('GET', '/api/local/:id/environment', async ({params}) => { const value=project(params.id); await ctx.runner.prepare(); return {environment:ctx.runner.projectEnvironment(value),inherited:ctx.runner.effectiveEnvironment(),effective:ctx.runner.effectiveEnvironment(value)}; });
  add('PUT', '/api/local/:id/environment', async ({params,body}) => { const result=ctx.runner.saveProjectEnvironment(project(params.id),body);ctx.javaIntelligence.close();return result; });
  add('GET', '/api/local/:id/run-configurations', async ({ params }) => ctx.runner.metadata(project(params.id)));
  add('GET', '/api/local/:id/run', async ({ params }) => ({ job: ctx.runner.status(project(params.id)) }));
  add('POST', '/api/local/:id/run', async ({ params, body }) => { const value=project(params.id);await ctx.runner.prepare();return { job:ctx.runner.start(value,body) }; });
  add('POST', '/api/local/:id/run-stop', async ({ params }) => ctx.runner.stop(project(params.id)));
};
