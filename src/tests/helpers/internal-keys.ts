/** Per-server keys the test run configures (see setup.ts). Test values only; never real keys. */
export const TEST_INTERNAL_KEYS = {
  "admin-web": "test-admin-web-key-0000000000000000",
  customer: "test-customer-key-00000000000000000",
  partner: "test-partner-key-000000000000000000",
  rider: "test-rider-key-0000000000000000000000",
  pos: "test-pos-key-000000000000000000000000",
} as const;
