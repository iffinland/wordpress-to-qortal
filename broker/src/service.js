import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BrokerError, BROKER_ERROR, fail } from './errors.js';
import { formatQort } from './amounts.js';
import { validatePublicationRequest, REQUEST_SCHEMA } from './policy.js';
import { resourceKey, rollWindow, windowSpent } from './state.js';
import { createFeeOracle } from './fees.js';
import { sha256Hex } from './util.js';
import { verifyNameOwnership, verifyResources } from '../../lib/engine/publication/remote.js';

const PUBLICATION_ID = /^pub_[a-f0-9]{24}$/;

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function publicRecord(record) {
  return structuredClone(record);
}

const SAFE_DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SAFE_ERROR_CLASSES = new Set(['AUTH', 'REQUEST', 'BACKEND', 'UNKNOWN']);

/**
 * A signing backend is untrusted input. Persist only a bounded status/code
 * triple so a backend or upstream error body can never reach publication
 * records or the audit ledger.
 */
function safeDiagnostic(diagnostic) {
  if (!diagnostic || typeof diagnostic !== 'object') return null;
  const { httpStatus, errorClass, errorCode } = diagnostic;
  if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599) return null;
  if (!SAFE_ERROR_CLASSES.has(errorClass)) return null;
  if (typeof errorCode !== 'string' || !SAFE_DIAGNOSTIC_CODE.test(errorCode)) return null;
  return { httpStatus, errorClass, errorCode };
}

function classifyReadback(result) {
  const counts = result.counts ?? {};
  if ((counts.remote_verified ?? 0) === result.results.length) return { state: 'remote_verified', decision: 'verified' };
  if ((counts.ambiguous ?? 0) > 0) return { state: 'ambiguous', decision: 'ambiguous' };
  if ((counts.failed ?? 0) > 0) return { state: 'failed', decision: 'failed' };
  if ((counts.blocked ?? 0) > 0) return { state: 'blocked', decision: 'blocked' };
  return { state: 'pending_confirmation', decision: 'pending' };
}

/**
 * Test publication broker. It composes validation, a narrow signing backend,
 * exact Phase 5 QDN read-back and broker-owned budget/state/audit.
 */
export class PublicationBroker {
  constructor({
    config,
    state,
    audit,
    backend,
    credentials = null,
    feeOracle = null,
    fetchImpl = globalThis.fetch,
    clock = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    killSwitchExists = (path) => existsSync(path)
  }) {
    this.config = config;
    this.state = state;
    this.audit = audit;
    this.backend = backend;
    this.credentials = credentials;
    this.fetchImpl = fetchImpl;
    this.feeOracle = feeOracle ?? createFeeOracle({
      fetchImpl,
      nodeUrl: config.qortal.nodeUrl,
      timeoutMs: config.qortal.feeTimeoutMs,
      clock
    });
    this.clock = clock;
    this.sleep = sleep;
    this.killSwitchExists = killSwitchExists;
    this.nameCheck = null;
    this.inFlight = 0;
  }

  isDisabled() {
    try {
      if (this.state.snapshot().disabled) return true;
      return Boolean(this.killSwitchExists(this.config.killSwitch.path));
    } catch {
      return true;
    }
  }

  assertEnabled() {
    if (this.isDisabled()) {
      fail(BROKER_ERROR.DISABLED, 'The QDN test publisher is disabled. An operator must re-enable it.');
    }
  }

  async getPublication(publicationId) {
    if (typeof publicationId !== 'string' || !PUBLICATION_ID.test(publicationId)) {
      fail(BROKER_ERROR.INVALID_REQUEST, 'The publication id is invalid.');
    }
    const record = this.state.snapshot().publications[publicationId];
    if (!record) fail(BROKER_ERROR.INVALID_REQUEST, 'Publication not found.');
    return publicRecord(record);
  }

  async verifyName() {
    const now = this.clock();
    if (this.nameCheck && now - this.nameCheck.at < this.config.qortal.nameCheckTtlMs) {
      return this.nameCheck.result;
    }
    const result = await verifyNameOwnership({
      fetchImpl: this.fetchImpl,
      nodeUrl: this.config.qortal.nodeUrl,
      name: this.config.qortal.targetName,
      ownerAddress: this.config.qortal.ownerAddress,
      timeoutMs: this.config.readback.timeoutMs
    });
    if (result.state !== 'verified') {
      this.audit.append('name_check_failed', { code: result.code, message: result.message });
      fail(BROKER_ERROR.NAME_NOT_VERIFIED, 'The exact test name is not verified as owned by the expected address: ' + result.code);
    }
    this.nameCheck = { at: now, result };
    return result;
  }

  async resourceExists(resource) {
    const service = encodeURIComponent(resource.service);
    const name = encodeURIComponent(this.config.qortal.targetName);
    const identifier = encodeURIComponent(resource.identifier);
    const url = this.config.qortal.nodeUrl + '/arbitrary/resource/properties/' + service + '/' + name + '/' + identifier;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.readback.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    } catch (error) {
      return { state: 'unavailable', code: 'NODE_UNREACHABLE', message: error.message };
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) return { state: 'absent' };
    if (response.status === 401 || response.status === 403) {
      return { state: 'blocked', code: 'READ_NOT_AUTHORIZED' };
    }
    if (!response.ok) return { state: 'unavailable', code: 'PROPERTIES_FAILED', status: response.status };
    return { state: 'exists' };
  }

  async quoteAndCheckBalance(request) {
    let quote;
    try {
      quote = await this.feeOracle.quoteResources({
        name: request.targetName,
        resources: request.resources,
        timestamp: this.clock()
      });
    } catch (error) {
      this.audit.append('publication_fee_quote_failed', {
        requestId: request.requestId,
        code: error.code ?? 'FEE_UNAVAILABLE'
      });
      throw error;
    }
    const byId = new Map(quote.quotes.map((entry) => [entry.id, entry.feeAtomic]));
    let totalFeeAtomic = 0;
    const resources = request.resources.map((resource) => {
      const feeAtomic = byId.get(resource.id);
      if (!Number.isSafeInteger(feeAtomic) || feeAtomic <= 0) {
        fail(BROKER_ERROR.FEE_MISMATCH, 'The per-resource fee quote is missing or invalid.', {
          details: { resourceId: resource.id }
        });
      }
      totalFeeAtomic += feeAtomic;
      return { ...resource, feeAtomic };
    });
    if (!Number.isSafeInteger(totalFeeAtomic) || totalFeeAtomic <= 0) {
      fail(BROKER_ERROR.FEE_INVALID, 'The batch fee total is outside the supported range.');
    }

    let balanceAtomic;
    try {
      balanceAtomic = await this.feeOracle.confirmedBalance(this.config.qortal.ownerAddress);
    } catch (error) {
      this.audit.append('publication_balance_check_failed', {
        requestId: request.requestId,
        code: error.code ?? 'BALANCE_UNAVAILABLE'
      });
      throw error;
    }
    const pendingAtomic = Object.values(this.state.snapshot().budget.reservations ?? {})
      .reduce((sum, value) => sum + Number(value || 0), 0);
    const requiredAtomic = totalFeeAtomic + this.config.policy.walletReserveAtomic + pendingAtomic;
    if (!Number.isSafeInteger(requiredAtomic)) {
      fail(BROKER_ERROR.BALANCE_UNAVAILABLE, 'The required wallet balance is outside the supported range.');
    }
    if (balanceAtomic < requiredAtomic) {
      fail(BROKER_ERROR.BALANCE_INSUFFICIENT, 'The confirmed wallet balance does not cover the batch, pending reservations and the configured reserve.', {
        details: {
          balanceAtomic,
          requiredAtomic,
          batchAtomic: totalFeeAtomic,
          reserveAtomic: this.config.policy.walletReserveAtomic,
          pendingAtomic
        }
      });
    }
    this.audit.append('publication_fee_quoted', {
      requestId: request.requestId,
      unitFeeAtomic: quote.unitFeeAtomic,
      totalFeeAtomic,
      balanceAtomic,
      pendingAtomic,
      reserveAtomic: this.config.policy.walletReserveAtomic
    });
    return { resources, totalFeeAtomic, unitFeeAtomic: quote.unitFeeAtomic, balanceAtomic };
  }

  async preflight(request) {
    await this.verifyName();
    const collisions = [];
    for (const resource of request.resources) {
      const result = await this.resourceExists(resource);
      if (result.state === 'exists') collisions.push(resource.identifier);
      if (result.state === 'blocked' || result.state === 'unavailable') {
        fail(BROKER_ERROR.NODE_UNAVAILABLE, 'Unable to prove that the target resource identity is free; refusing to publish.', {
          details: { identifier: resource.identifier, code: result.code ?? null }
        });
      }
    }
    if (collisions.length > 0 && !this.config.policy.allowResourceUpdates) {
      fail(BROKER_ERROR.RESOURCE_EXISTS, 'A target resource identity already exists; updates are not authorized.', {
        details: { identifiers: collisions }
      });
    }
    return { updateExisting: collisions.length > 0 };
  }

  async publish({ body, rawBody = null, keyId = 'unknown' }) {
    this.assertEnabled();
    while (this.inFlight >= this.config.server.maxConcurrentPublications) {
      await this.waitForCapacity();
    }
    this.inFlight += 1;
    try {
      const request = validatePublicationRequest({ body, config: this.config });
      const bodyHash = sha256Hex(rawBody ?? Buffer.from(JSON.stringify(body), 'utf8'));
      const startedAt = nowIso(this.clock);
      this.audit.append('publication_request', {
        keyId,
        requestId: request.requestId,
        projectId: request.projectId,
        requestHash: bodyHash,
        resources: request.resources.length,
        bytes: request.totalBytes,
        handoffId: request.handoffId
      });

      const existing = this.state.snapshot().idempotency[request.requestId];
      if (existing) {
        if (existing.bodyHash !== bodyHash) {
          fail(BROKER_ERROR.IDEMPOTENCY_CONFLICT, 'This request id was already used with a different payload.');
        }
        this.audit.append('publication_idempotent_replay', {
          keyId, requestId: request.requestId, publicationId: existing.publicationId
        });
        return publicRecord(this.state.snapshot().publications[existing.publicationId]);
      }

      let preflight;
      try {
        preflight = await this.preflight(request);
      } catch (error) {
        this.audit.append('publication_denied', {
          keyId, requestId: request.requestId, code: error.code ?? 'PREFLIGHT_FAILED'
        });
        throw error;
      }

      let funding;
      try {
        funding = await this.quoteAndCheckBalance(request);
      } catch (error) {
        this.audit.append('publication_denied', {
          keyId, requestId: request.requestId, code: error.code ?? 'FEE_PREFLIGHT_FAILED'
        });
        throw error;
      }

      let reservation;
      try {
        reservation = await this.state.transact(async (draft) => {
          if (draft.disabled) fail(BROKER_ERROR.DISABLED, 'The broker is disabled.');
          const replay = draft.idempotency[request.requestId];
          if (replay) {
            if (replay.bodyHash !== bodyHash) fail(BROKER_ERROR.IDEMPOTENCY_CONFLICT, 'Idempotency conflict.');
            return { publicationId: replay.publicationId, created: false };
          }
          const now = this.clock();
          rollWindow(draft, now, this.config.policy.budgetWindowMs);
          for (const resource of request.resources) {
            const key = resourceKey({ ...resource, name: request.targetName });
            const lock = draft.resourceLocks[key];
            if (lock && ['reserved', 'submitted', 'pending_confirmation', 'ambiguous'].includes(lock.state)) {
              fail(BROKER_ERROR.RESOURCE_PENDING, 'A resource identity is already in flight or unverified; it is never resubmitted automatically.', {
                details: { identifier: resource.identifier }
              });
            }
          }
          const spent = windowSpent(draft, now, this.config.policy.budgetWindowMs);
          if (spent + funding.totalFeeAtomic > this.config.policy.budgetAtomic) {
            fail(BROKER_ERROR.BUDGET_EXCEEDED, 'The cumulative fee budget would be exceeded.', {
              details: {
                spentAtomic: spent,
                requestedAtomic: funding.totalFeeAtomic,
                budgetAtomic: this.config.policy.budgetAtomic
              }
            });
          }
          const pendingNow = Object.values(draft.budget.reservations ?? {})
            .reduce((sum, value) => sum + Number(value || 0), 0);
          const requiredNow = funding.totalFeeAtomic + this.config.policy.walletReserveAtomic + pendingNow;
          const balanceNow = await this.feeOracle.confirmedBalance(this.config.qortal.ownerAddress);
          if (balanceNow < requiredNow) {
            fail(BROKER_ERROR.BALANCE_INSUFFICIENT, 'The confirmed wallet balance no longer covers this batch, reservations and the reserve.', {
              details: {
                balanceAtomic: balanceNow,
                requiredAtomic: requiredNow,
                batchAtomic: funding.totalFeeAtomic,
                reserveAtomic: this.config.policy.walletReserveAtomic,
                pendingAtomic: pendingNow
              }
            });
          }
          const id = 'pub_' + randomBytes(12).toString('hex');
          draft.publications[id] = {
            schema: 'qms-test-publication@1',
            publicationId: id,
            requestId: request.requestId,
            projectId: request.projectId,
            target: { name: request.targetName, ownerAddress: request.ownerAddress },
            state: 'reserved',
            decision: 'accepted',
            code: 'RESERVED',
            message: 'Publication accepted and budget reserved.',
            createdAt: startedAt,
            updatedAt: nowIso(this.clock),
            clientKeyId: keyId,
            handoffId: request.handoffId,
            updateExisting: preflight.updateExisting,
            resources: funding.resources.map((resource) => ({
              id: resource.id,
              service: resource.service,
              name: request.targetName,
              identifier: resource.identifier,
              contentType: resource.contentType,
              bytes: resource.bytes,
              sha256: resource.sha256,
              feeAtomic: resource.feeAtomic,
              state: 'reserved',
              txRef: null,
              verification: null
            })),
            unitFeeAtomic: funding.unitFeeAtomic,
            totalFeeAtomic: funding.totalFeeAtomic,
            reservedAtomic: funding.totalFeeAtomic,
            balanceAtReservationAtomic: balanceNow,
            chargedAtomic: 0,
            verification: null
          };
          draft.idempotency[request.requestId] = { publicationId: id, bodyHash, at: now };
          draft.budget.reservations[id] = funding.totalFeeAtomic;
          for (const resource of request.resources) {
            const key = resourceKey({ ...resource, name: request.targetName });
            draft.resourceLocks[key] = { publicationId: id, state: 'reserved', at: now };
          }
          return { publicationId: id, created: true };
        });
      } catch (error) {
        this.audit.append('publication_denied', {
          keyId, requestId: request.requestId, code: error.code ?? 'RESERVATION_FAILED'
        });
        throw error;
      }

      if (!reservation.created) {
        this.audit.append('publication_idempotent_replay', {
          keyId, requestId: request.requestId, publicationId: reservation.publicationId
        });
        return publicRecord(this.state.snapshot().publications[reservation.publicationId]);
      }
      const publicationId = reservation.publicationId;

      this.audit.append('publication_reserved', {
        keyId,
        requestId: request.requestId,
        publicationId,
        reservedAtomic: funding.totalFeeAtomic,
        unitFeeAtomic: funding.unitFeeAtomic,
        budgetAtomic: this.config.policy.budgetAtomic
      });

      return await this.submitReserved(publicationId, { ...request, resources: funding.resources, totalFeeAtomic: funding.totalFeeAtomic }, keyId);
    } finally {
      this.inFlight -= 1;
      this.releaseWaiters();
    }
  }

  waitForCapacity() {
    if (!this.capacityWaiters) this.capacityWaiters = [];
    return new Promise((resolve) => this.capacityWaiters.push(resolve));
  }

  releaseWaiters() {
    if (!this.capacityWaiters) return;
    const waiters = this.capacityWaiters.splice(0);
    waiters.forEach((resolve) => resolve());
  }

  async setPublicationState(publicationId, mutate) {
    return this.state.transact((draft) => {
      const record = draft.publications[publicationId];
      if (!record) fail(BROKER_ERROR.INVALID_REQUEST, 'Publication not found.');
      mutate(record, draft);
      record.updatedAt = nowIso(this.clock);
      return publicRecord(record);
    });
  }

  async submitReserved(publicationId, request, keyId) {
    await this.setPublicationState(publicationId, (record) => {
      record.state = 'submitting';
      record.code = 'SUBMITTING';
      record.message = 'Submitting the publication to the signing backend.';
    });

    const byId = new Map(request.resources.map((resource) => [resource.id, resource]));
    let charged = 0;
    let stopReason = null;
    let signedCount = 0;

    for (const resourceRecord of this.state.snapshot().publications[publicationId].resources) {
      if (stopReason) break;
      const resource = byId.get(resourceRecord.id);
      let outcome;
      try {
        outcome = await this.backend.publish({
          service: resource.service,
          name: request.targetName,
          identifier: resource.identifier,
          dataBase64: resource.dataBase64,
          // Core binds /arbitrary?fee= to a Long in atomic units. Sending a
          // QORT decimal (0.01) fails before name validation; the reserved
          // atomic value must be forwarded unchanged.
          feeAtomic: resource.feeAtomic
        });
      } catch (error) {
        outcome = {
          state: 'ambiguous',
          code: 'SIGNING_BACKEND_ERROR',
          message: 'The signing backend threw an unexpected error; the outcome is unknown.'
        };
      }

      if (outcome.state === 'signed') {
        charged += resource.feeAtomic;
        signedCount += 1;
        await this.setPublicationState(publicationId, (record) => {
          const target = record.resources.find((entry) => entry.id === resource.id);
          target.state = 'submitted';
          target.txRef = outcome.signature;
          if (outcome.address && outcome.address !== this.config.qortal.ownerAddress) {
            target.state = 'ambiguous';
            target.verification = { state: 'ambiguous', code: 'SIGNER_MISMATCH' };
            stopReason = 'ambiguous';
          }
        });
        this.audit.append('publication_signed', {
          keyId,
          publicationId,
          resourceId: resource.id,
          identifier: resource.identifier,
          txRef: outcome.signature,
          feeAtomic: resource.feeAtomic
        });
        if (stopReason) break;
      } else if (outcome.state === 'rejected' || outcome.state === 'failed') {
        const diagnostic = safeDiagnostic(outcome.diagnostic);
        await this.setPublicationState(publicationId, (record) => {
          const target = record.resources.find((entry) => entry.id === resource.id);
          target.state = 'failed';
          target.verification = {
            state: 'failed',
            code: outcome.code ?? 'SIGNING_FAILED',
            ...(diagnostic ? { diagnostic } : {})
          };
        });
        stopReason = outcome.state;
        this.audit.append('publication_signing_failed', {
          keyId,
          publicationId,
          resourceId: resource.id,
          code: outcome.code ?? 'SIGNING_FAILED',
          ...(diagnostic
            ? {
                httpStatus: diagnostic.httpStatus,
                errorClass: diagnostic.errorClass,
                errorCode: diagnostic.errorCode
              }
            : {})
        });
      } else if (outcome.state === 'pending') {
        await this.setPublicationState(publicationId, (record) => {
          const target = record.resources.find((entry) => entry.id === resource.id);
          target.state = 'pending_confirmation';
          target.verification = { state: 'pending', code: outcome.code ?? 'SIGNING_PENDING' };
        });
        stopReason = 'pending';
        this.audit.append('publication_signing_pending', {
          keyId, publicationId, resourceId: resource.id, code: outcome.code ?? 'SIGNING_PENDING'
        });
      } else {
        const diagnostic = safeDiagnostic(outcome.diagnostic);
        await this.setPublicationState(publicationId, (record) => {
          const target = record.resources.find((entry) => entry.id === resource.id);
          target.state = 'pending_confirmation';
          target.verification = {
            state: 'ambiguous',
            code: outcome.code ?? 'SIGNING_UNKNOWN',
            ...(diagnostic ? { diagnostic } : {})
          };
        });
        stopReason = 'ambiguous';
        this.audit.append('publication_signing_ambiguous', {
          keyId,
          publicationId,
          resourceId: resource.id,
          code: outcome.code ?? 'SIGNING_UNKNOWN',
          ...(diagnostic
            ? {
                httpStatus: diagnostic.httpStatus,
                errorClass: diagnostic.errorClass,
                errorCode: diagnostic.errorCode
              }
            : {})
        });
      }
    }

    // Any unknown or pending signing outcome reserves the whole batch: a
    // signed-but-unconfirmed or unknown transaction may still settle, so the
    // budget must not be freed. Definite failures only charge signed resources.
    const chargedAtomic = ['ambiguous', 'pending'].includes(stopReason)
      ? request.totalFeeAtomic
      : charged;

    const finalRecord = await this.state.transact((draft) => {
      const record = draft.publications[publicationId];
      if (!record) fail(BROKER_ERROR.INVALID_REQUEST, 'Publication not found.');
      delete draft.budget.reservations[publicationId];
      rollWindow(draft, this.clock(), this.config.policy.budgetWindowMs);
      draft.budget.spentAtomic += chargedAtomic;
      record.chargedAtomic = chargedAtomic;
      record.reservedAtomic = 0;
      if (stopReason === 'ambiguous') {
        record.state = 'ambiguous';
        record.decision = 'ambiguous';
        record.code = 'SIGNING_OUTCOME_UNKNOWN';
        record.message = 'At least one signing outcome is unknown; no duplicate submission is attempted.';
      } else if (stopReason === 'pending') {
        record.state = 'pending_confirmation';
        record.decision = 'pending';
        record.code = 'SIGNING_PENDING';
        record.message = 'The signing outcome is pending; no duplicate submission is attempted.';
      } else if (stopReason === 'rejected' || stopReason === 'failed') {
        record.state = 'failed';
        record.decision = 'failed';
        record.code = 'SIGNING_FAILED';
        record.message = 'The signing backend rejected or failed the publication.';
        const failedTarget = record.resources.find((entry) => entry.state === 'failed');
        record.diagnostic = failedTarget?.verification?.diagnostic ?? null;
      } else {
        record.state = 'submitted';
        record.decision = 'accepted';
        record.code = 'SUBMITTED';
        record.message = 'All resources were signed and submitted; exact read-back is pending.';
      }
      record.updatedAt = nowIso(this.clock);
      if (stopReason) {
        for (const resource of record.resources) {
          if (resource.state === 'reserved') resource.state = 'not_attempted';
        }
      }
      // Failed and not-attempted resources are free again; pending/ambiguous
      // and submitted identities stay locked against duplicate submission.
      for (const resource of record.resources) {
        const key = resourceKey({ service: resource.service, name: record.target.name, identifier: resource.identifier });
        if (['failed', 'not_attempted', 'reserved'].includes(resource.state)) delete draft.resourceLocks[key];
      }
      return publicRecord(record);
    });

    this.audit.append('publication_charged', {
      keyId,
      publicationId,
      chargedAtomic,
      signedCount,
      state: finalRecord.state,
      budgetSpentAtomic: this.state.snapshot().budget.spentAtomic,
      budgetAtomic: this.config.policy.budgetAtomic
    });

    if (finalRecord.state !== 'submitted') {
      this.audit.append('publication_completed', {
        keyId, publicationId, state: finalRecord.state, decision: finalRecord.decision
      });
      return finalRecord;
    }

    return await this.verifyAndFinalize(publicationId, keyId);
  }

  async verifyAndFinalize(publicationId, keyId = 'system') {
    const record = this.state.snapshot().publications[publicationId];
    if (!record) fail(BROKER_ERROR.INVALID_REQUEST, 'Publication not found.');
    const signed = record.resources.filter((resource) => resource.txRef);
    if (signed.length === 0) return publicRecord(record);
    let verification;
    try {
      verification = await verifyResources({
        fetchImpl: this.fetchImpl,
        nodeUrl: this.config.qortal.nodeUrl,
        resources: signed.map((resource) => ({
          id: resource.id,
          service: resource.service,
          name: resource.name,
          identifier: resource.identifier,
          bytes: resource.bytes,
          sha256: resource.sha256
        })),
        attempts: this.config.readback.attempts,
        intervalMs: this.config.readback.intervalMs,
        timeoutMs: this.config.readback.timeoutMs
      });
    } catch (error) {
      verification = {
        schema: 'qms-qdn-verification@1',
        counts: { ambiguous: signed.length },
        results: signed.map((resource) => ({ resourceId: resource.id, state: 'ambiguous', code: 'VERIFICATION_ERROR' }))
      };
    }
    const overall = classifyReadback(verification);
    const finalRecord = await this.state.transact((draft) => {
      const current = draft.publications[publicationId];
      if (!current) fail(BROKER_ERROR.INVALID_REQUEST, 'Publication not found.');
      current.verification = {
        schema: verification.schema,
        counts: verification.counts,
        checkedAt: verification.checkedAt ?? nowIso(this.clock),
        results: verification.results
      };
      for (const result of verification.results) {
        const target = current.resources.find((resource) => resource.id === result.resourceId);
        if (target) {
          target.verification = {
            state: result.state,
            code: result.code,
            checkedAt: result.evidence?.checkedAt ?? verification.checkedAt ?? null
          };
          if (result.state === 'remote_verified') target.state = 'remote_verified';
          else if (result.state === 'ambiguous') target.state = 'ambiguous';
          else if (result.state === 'failed') target.state = 'failed';
          else target.state = 'pending_confirmation';
        }
      }
      const hasDefiniteFailure = current.resources.some((resource) => ['failed', 'not_attempted'].includes(resource.state));
      const hasUnsubmitted = current.resources.some((resource) => resource.state === 'pending_confirmation' && !resource.txRef);
      let finalState = overall.state;
      let finalDecision = overall.decision;
      if (hasDefiniteFailure) {
        finalState = 'failed';
        finalDecision = 'failed';
      } else if (hasUnsubmitted) {
        finalState = 'pending_confirmation';
        finalDecision = 'pending';
      }
      current.state = finalState;
      current.decision = finalDecision;
      current.code = finalState === 'remote_verified' ? 'EXACT_READBACK_VERIFIED' : 'READBACK_INCONCLUSIVE';
      current.message = finalState === 'remote_verified'
        ? 'Exact QDN read-back matched every intended SHA-256.'
        : 'Exact read-back did not complete; the outcome is preserved without resubmission.';
      current.updatedAt = nowIso(this.clock);
      for (const resource of current.resources) {
        const key = resourceKey({ service: resource.service, name: current.target.name, identifier: resource.identifier });
        if (['remote_verified', 'failed'].includes(resource.state)) delete draft.resourceLocks[key];
      }
      return publicRecord(current);
    });

    this.audit.append('publication_verification', {
      keyId,
      publicationId,
      state: finalRecord.state,
      counts: finalRecord.verification?.counts ?? null,
      results: (finalRecord.verification?.results ?? []).map((result) => ({
        resourceId: result.resourceId, state: result.state, code: result.code
      }))
    });
    this.audit.append('publication_completed', {
      keyId, publicationId, state: finalRecord.state, decision: finalRecord.decision
    });
    return finalRecord;
  }

  /**
   * Safe re-verification of an existing publication. This performs QDN reads
   * only; it never signs or submits a transaction.
   */
  async revalidate(publicationId, keyId = 'system') {
    const record = await this.getPublication(publicationId);
    if (!['submitted', 'pending_confirmation', 'ambiguous', 'failed'].includes(record.state)) {
      return record;
    }
    this.audit.append('publication_revalidation_requested', { keyId, publicationId, state: record.state });
    if (record.resources.every((resource) => !resource.txRef)) return record;
    return await this.verifyAndFinalize(publicationId, keyId);
  }

  /**
   * Durable replay claim for one authenticated request. The in-memory cache in
   * auth.js already rejects concurrent duplicates; this layer closes the
   * timestamp window across broker restarts.
   */
  async claimNonce({ keyId, nonce, now = this.clock(), ttlMs = 600000 }) {
    return this.state.claimNonce({ keyId, nonce, now, expiresAt: now + ttlMs });
  }

  async status() {
    const snapshot = this.state.snapshot();
    return {
      schema: 'qms-test-broker-status@1',
      disabled: this.isDisabled(),
      publications: Object.keys(snapshot.publications).length,
      revokedKeys: snapshot.revokedKeys.length,
      budget: {
        windowStart: new Date(snapshot.budget.windowStart).toISOString(),
        spentAtomic: snapshot.budget.spentAtomic,
        spentQort: formatQort(snapshot.budget.spentAtomic),
        budgetAtomic: this.config.policy.budgetAtomic,
        budgetQort: formatQort(this.config.policy.budgetAtomic)
      },
      signingBackend: this.backend.constructor?.name ?? 'unknown',
      credential: this.credentials ? this.credentials.status() : null,
      replayEntries: Object.keys(snapshot.requestNonces).length,
      requestSchema: REQUEST_SCHEMA
    };
  }
}
