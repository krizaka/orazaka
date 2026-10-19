// Everything the suite needs comes from the environment; nothing is printed, nothing is committed.
//
//   BASE_URL                 the edge: http://localhost:8088 (local), https://dev.orazaka.com/edge (dev)
//   ORAZAKA_USER_EMAIL / ORAZAKA_USER_PASSWORD
//                            sign in as a person (tests the auth path, then uses the JWT)
//   USE_API_KEY=1            after signing in, mint an oz_ service key and call with it, which is how
//                            every product calls: this exercises the edge's key exchange (and removes
//                            the key at the end)
//   LOAD_STUDIO              the Studio a run starts (default compliance-check)
//   LOAD_INPUTS              JSON of its inputs (default: a short lease)
//   RATE                     requests per second of the sync scenario (profile default otherwise)
export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8088').replace(/\/$/, '');
export const EMAIL = __ENV.ORAZAKA_USER_EMAIL || 'qa@example.test';
export const PASSWORD = __ENV.ORAZAKA_USER_PASSWORD || '';
export const USE_API_KEY = __ENV.USE_API_KEY === '1';
export const STUDIO = __ENV.LOAD_STUDIO || 'compliance-check';
export const INPUTS = JSON.parse(
  __ENV.LOAD_INPUTS ||
    '{"document":"The tenant pays 900 dollars each month. The landlord may raise the rent by 10 percent at any time.","jurisdiction":"QC","asOf":"2026-10-17"}',
);
