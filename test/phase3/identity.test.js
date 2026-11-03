import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  deriveQdnIdentity,
  classifyCandidate,
  newIdentityState,
  newSiteIdentity,
  reserveMapping,
  tripleKey,
  validateQortalName,
  QORTAL_NAME_MAX_LENGTH
} from '../../lib/engine/identity.js';
import { startWordpressFixtureServer } from '../../test-support/wordpress/fixtureServer.js';
import { makePost, dataWithPosts, startPhase3 } from '../../test-support/phase3/helpers.js';

test('each project gets a persistent immutable site identity and a disjoint namespace', async (t) => {
  const first = await startPhase3(t, {
    posts: [makePost(1), makePost(2)],
    target: 'SharedTargetName'
  });
  const secondProject = await first.engine.projects.create({
    name: 'Second Synthetic Project',
    source: { adapter: 'wordpress', baseUrl: first.wp.url },
    target: { qdnName: 'SharedTargetName' },
    settings: { disk: { reserveBytes: 0, maxBytesPerRun: 0 }, media: { allowLoopback: true } }
  });
  const second = await first.engine.projects.open(secondProject.id);
  t.after(() => second.close().catch(() => {}));

  const firstIdentity = first.handle.identity.describe();
  const secondIdentity = second.identity.describe();
  assert.match(firstIdentity.siteId, /^site_[a-f0-9]{32}$/);
  assert.notEqual(firstIdentity.siteId, secondIdentity.siteId);
  assert.notEqual(firstIdentity.namespace, secondIdentity.namespace);
  assert.equal(firstIdentity.target.qdnName, 'SharedTargetName');
  assert.equal(secondIdentity.target.qdnName, 'SharedTargetName');

  const firstTriple = deriveQdnIdentity({
    siteId: firstIdentity.siteId,
    namespace: firstIdentity.namespace,
    sourceKey: 'post:1001',
    contentType: 'post',
    target: firstIdentity.target
  });
  const secondTriple = deriveQdnIdentity({
    siteId: secondIdentity.siteId,
    namespace: secondIdentity.namespace,
    sourceKey: 'post:1001',
    contentType: 'post',
    target: secondIdentity.target
  });
  assert.equal(firstTriple.service, 'DOCUMENT');
  assert.equal(firstTriple.name, 'SharedTargetName');
  assert.notEqual(firstTriple.identifier, secondTriple.identifier);
  assert.ok(firstTriple.identifier.length <= 64);

  await first.handle.close();
  const reopened = await first.engine.projects.open(first.project.id);
  t.after(() => reopened.close().catch(() => {}));
  assert.equal(reopened.identity.describe().siteId, firstIdentity.siteId);
  assert.equal(reopened.identity.describe().namespace, firstIdentity.namespace);
  await reopened.update({ name: 'Renamed Project' });
  assert.equal(reopened.identity.describe().siteId, firstIdentity.siteId);
  assert.equal(reopened.identity.describe().namespace, firstIdentity.namespace);
});

test('a legacy project without an identity gets one lazily and keeps it', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(0)] });
  const paths = env.engine.projects.paths(env.project.id);
  await env.handle.store.transaction((draft) => {
    draft.identity = null;
  });
  await env.handle.close();
  const projectFile = path.join(paths.root, 'project.json');
  const document = JSON.parse(await readFile(projectFile, 'utf8'));
  delete document.identity;
  await writeFile(projectFile, JSON.stringify(document, null, 2));
  const reopened = await env.engine.projects.open(env.project.id);
  const siteId = reopened.project.identity.siteId;
  assert.match(siteId, /^site_[a-f0-9]{32}$/);
  assert.equal(reopened.identity.describe().siteId, siteId);
  await reopened.close();
  const reopenedAgain = await env.engine.projects.open(env.project.id);
  assert.equal(reopenedAgain.project.identity.siteId, siteId);
  assert.equal(reopenedAgain.identity.describe().siteId, siteId);
  await reopenedAgain.close();
});

test('identifiers stay stable across slug and content revisions and route changes are classified separately', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2), makePost(3)] });
  const discovery = await env.handle.source.discover({ perPage: 50 });
  assert.equal(discovery.status, 'completed');
  const plan = await env.handle.planning.create({ batchSize: 3 });
  assert.equal(plan.status, 'completed');
  const before = env.handle.identity.mappingFor('post:1001');
  assert.ok(before);
  const identifier = before.identifier;

  // Same content and title, changed slug: a route change, not a new identity
  // or a content revision.
  const routeData = dataWithPosts([
    makePost(1, { slug: 'renamed-synthetic-post-1' }),
    makePost(2),
    makePost(3)
  ]);
  const routeServer = await startWordpressFixtureServer({ data: routeData });
  t.after(() => routeServer.close().catch(() => {}));
  await env.handle.update({ source: { baseUrl: routeServer.url } });
  assert.equal((await env.handle.source.discover({ perPage: 50 })).status, 'completed');
  const routePlan = await env.handle.planning.create({ batchSize: 3, estimateMedia: false });
  assert.equal(routePlan.status, 'completed');
  assert.ok(routePlan.stats.route_changed >= 1);
  const routeEntry = routePlan.plan.entries.find((entry) => entry.sourceKey === 'post:1001');
  assert.equal(routeEntry.status, 'route_changed');
  const afterRoute = env.handle.identity.mappingFor('post:1001');
  assert.equal(afterRoute.identifier, identifier);
  assert.equal(afterRoute.contentHash, before.contentHash);
  assert.equal(afterRoute.pendingRouteUpdate, true);

  // A real content edit is a revision on the same QDN triple.
  const contentData = dataWithPosts([
    makePost(1, { slug: 'renamed-synthetic-post-1', content: '<p>Changed body</p>' }),
    makePost(2),
    makePost(3)
  ]);
  const contentServer = await startWordpressFixtureServer({ data: contentData });
  t.after(() => contentServer.close().catch(() => {}));
  await env.handle.update({ source: { baseUrl: contentServer.url } });
  assert.equal((await env.handle.source.discover({ perPage: 50 })).status, 'completed');
  const modifiedPlan = await env.handle.planning.create({ batchSize: 3, estimateMedia: false });
  assert.equal(modifiedPlan.status, 'completed');
  assert.ok(modifiedPlan.stats.modified >= 1);
  const modifiedEntry = modifiedPlan.plan.entries.find((entry) => entry.sourceKey === 'post:1001');
  assert.equal(modifiedEntry.status, 'modified');
  assert.equal(modifiedEntry.contentChanged, true);
  const afterContent = env.handle.identity.mappingFor('post:1001');
  assert.equal(afterContent.identifier, identifier);
  assert.notEqual(afterContent.contentHash, before.contentHash);
});

test('a target change requires an explicit migration and preserves identifiers for a name-only move', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(1), makePost(2)] });
  await env.handle.source.discover({ perPage: 50 });
  const firstPlan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  assert.equal(firstPlan.status, 'completed');
  const before = env.handle.identity.mappingFor('post:1001');
  assert.ok(before);

  await assert.rejects(
    () => env.handle.update({ target: { qdnName: 'DifferentTargetName' } }),
    (error) => error.code === 'IDENTITY_MIGRATION_REQUIRED'
  );
  assert.equal(env.handle.identity.target().qdnName, 'SyntheticSite');

  const preview = await env.handle.identity.migrationPreview({ target: { qdnName: 'DifferentTargetName' } });
  assert.equal(preview.from.qdnName, 'SyntheticSite');
  assert.equal(preview.to.qdnName, 'DifferentTargetName');
  const applied = await env.handle.identity.applyMigration({ token: preview.token });
  assert.equal(applied.mappingCount, 2);
  const after = env.handle.identity.mappingFor('post:1001');
  assert.equal(after.identifier, before.identifier);
  assert.equal(after.name, 'DifferentTargetName');
  assert.equal(env.handle.identity.target().qdnName, 'DifferentTargetName');
  const projectFile = JSON.parse(await readFile(path.join(env.engine.projects.paths(env.project.id).root, 'project.json'), 'utf8'));
  assert.equal(projectFile.target.qdnName, 'DifferentTargetName');

  const secondPlan = await env.handle.planning.create({ batchSize: 2, estimateMedia: false });
  assert.equal(secondPlan.status, 'completed');
  assert.equal(secondPlan.stats.selected, 0);
  assert.equal(secondPlan.stats.reserved, 2);
  assert.equal(secondPlan.stats.unchanged, 0);

  const prefixPreview = await env.handle.identity.migrationPreview({ target: { resourcePrefix: 'syn' } });
  const prefixApplied = await env.handle.identity.applyMigration({ token: prefixPreview.token });
  assert.equal(prefixApplied.renamedIdentifiers, 2);
  const prefixed = env.handle.identity.mappingFor('post:1001');
  assert.match(prefixed.identifier, /^syn-/);
});

test('colliding target triples are refused as conflicts and can be resolved explicitly', async (t) => {
  const env = await startPhase3(t, { posts: [makePost(0), makePost(1), makePost(2), makePost(3)] });
  await env.handle.source.discover({ perPage: 50 });
  const first = await env.handle.planning.create({ batchSize: 1, estimateMedia: false });
  assert.equal(first.status, 'completed');
  const mappedSourceKey = first.plan.entries.find((entry) => entry.status === 'new').sourceKey;
  const mapped = env.handle.identity.mappingFor(mappedSourceKey);
  assert.ok(mapped);
  const otherSourceKey = ['post:1000', 'post:1001', 'post:1002', 'post:1003'].find((key) => key !== mappedSourceKey);

  const identity = env.handle.identity.state;
  const colliding = deriveQdnIdentity({
    siteId: identity.siteId,
    namespace: identity.namespace,
    sourceKey: otherSourceKey,
    contentType: 'post',
    target: identity.target
  });
  await env.handle.store.transaction((draft) => {
    draft.identity.triples[tripleKey(colliding)] = 'post:foreign';
  });

  const conflicted = await env.handle.planning.create({ batchSize: 1, estimateMedia: false });
  assert.equal(conflicted.status, 'completed');
  assert.ok(conflicted.stats.conflict >= 1);
  const conflict = conflicted.plan.conflicts.find((entry) => entry.sourceKey === otherSourceKey);
  assert.ok(conflict);
  assert.equal(conflict.kind, 'IDENTITY_COLLISION');
  assert.equal(env.handle.identity.mappingFor(otherSourceKey), null);

  const openConflicts = env.handle.identity.listConflicts();
  const actualConflict = openConflicts.find((entry) => entry.sourceKey === otherSourceKey)
    ?? env.handle.identity.listConflicts({ includeResolved: true }).find((entry) => entry.sourceKey === otherSourceKey);
  assert.ok(actualConflict);
  assert.equal(actualConflict.id, conflict.id);
  const resolution = await env.handle.identity.resolveConflict({
    conflictId: actualConflict.id,
    resolution: 'alternate'
  });
  assert.equal(resolution.resolution, 'alternate');
  const alternate = env.handle.identity.mappingFor(otherSourceKey);
  assert.ok(alternate);
  assert.match(alternate.identifier, /-a1$/);
  assert.notEqual(alternate.identifier, colliding.identifier);
});

test('identity helpers reject invalid names, unsafe overwrites and overlong identifiers', () => {
  assert.equal(validateQortalName('Valid_Name-9'), 'Valid_Name-9');
  for (const bad of ['ab', '-leading', 'trailing-', 'has space', 'x'.repeat(QORTAL_NAME_MAX_LENGTH + 1)]) {
    assert.throws(() => validateQortalName(bad), /Invalid Qortal name|name is required/);
  }
  const identity = newIdentityState({
    siteIdentity: newSiteIdentity({ clock: { nowIso: () => '2026-01-01T00:00:00.000Z' } }),
    target: { qdnName: 'SyntheticSite', resourcePrefix: 'qms' }
  });
  const entry = {
    sourceKey: 'post:1',
    contentType: 'post',
    contentHash: 'sha256:' + 'a'.repeat(64),
    routeHash: 'sha256:' + 'b'.repeat(64)
  };
  const first = classifyCandidate({ entry, mapping: null, identity, target: identity.target });
  assert.equal(first.status, 'new');
  reserveMapping(identity, {
    entry,
    triple: first.triple,
    planId: 'plan_test',
    routeHash: entry.routeHash,
    now: '2026-01-01T00:00:00.000Z'
  });
  assert.throws(() => reserveMapping(identity, {
    entry,
    triple: { ...first.triple, identifier: first.triple.identifier + '-other' },
    planId: 'plan_test',
    routeHash: entry.routeHash,
    now: '2026-01-01T00:00:00.000Z'
  }), /explicit migration/);

  const long = deriveQdnIdentity({
    siteId: identity.siteId,
    namespace: identity.namespace,
    sourceKey: 'x'.repeat(500),
    contentType: 'post',
    target: identity.target
  });
  assert.ok(long.identifier.length <= 64);
});
