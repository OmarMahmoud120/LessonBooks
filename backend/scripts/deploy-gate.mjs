// The deploy gate always fails until a human records every decision it lists. It
// validates which self-hosted VPS deployment settings are already present so the
// operator sees the exact remaining work; it never deploys by itself.
const required = [
  ['VPS_HOST', 'provisioned VPS host recorded'],
  ['VPS_DEPLOY_KEY', 'deployment SSH key or access path recorded'],
  ['CADDY_TLS_EMAIL', "TLS/contact email for Caddy's automatic certificates"],
  ['POSTGRES_URL', 'production Postgres connection URL (injected as a secret)'],
  ['KEYCLOAK_ISSUER', 'production Keycloak issuer URL'],
  ['S3_ENDPOINT', 'production Garage/S3 endpoint'],
];
const decisions = [
  'retention and tombstone policy recorded in doc/privacy-compliance.md',
  'legally sufficient parental consent text approved',
  'vendor processing review for model/OCR providers completed',
  'spend budget and alerting approved',
  'explicit human deployment authorization given',
];
console.error('Deployment is intentionally blocked. Missing runtime settings:');
for (const [name, description] of required) {
  if (!process.env[name]) console.error(`  - ${name}: ${description}`);
}
console.error('Decisions still required before any deploy:');
for (const decision of decisions) console.error(`  - ${decision}`);
console.error('Deployment target: the self-hosted VPS stack (doc/vps-migration.md, ADR 0013).');
process.exitCode = 1;
