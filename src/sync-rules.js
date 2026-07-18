export const MAX_TAKEOVER_CLAIM_ATTEMPTS = 3;

export function canChangeLocalState(syncRole) {
  return syncRole !== 'viewer';
}

export function shouldAttemptTakeoverClaim(attempt) {
  return Number.isInteger(attempt)
    && attempt >= 1
    && attempt <= MAX_TAKEOVER_CLAIM_ATTEMPTS;
}
