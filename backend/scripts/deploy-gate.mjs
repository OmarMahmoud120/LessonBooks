// The deploy gate always fails until a human records every decision it lists. It
// validates which cloud runtime settings are already present so the operator sees the
// exact remaining work; it never deploys by itself.
const required = [
  ['CLOUD_RUNTIME_APPROVED', 'runtime approval recorded (CLOUD_RUNTIME_APPROVED=true)'],
  ['FIREBASE_PROJECT_ID', 'production Firebase project chosen'],
  ['GCLOUD_REGION', 'region and data-residency decision recorded'],
  ['CLOUD_TASKS_LOCATION', 'Cloud Tasks location matching the region'],
  ['CLOUD_TASKS_QUEUE', 'Cloud Tasks queue name'],
  ['WORKER_URL', 'deployed worker URL (fill after first worker deploy)'],
  ['WORKER_SERVICE_ACCOUNT', 'least-privilege worker service account'],
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
console.error(
  'Templates: backend/infra/cloudrun/{api,worker}.yaml. See doc/privacy-compliance.md.',
);
process.exitCode = 1;
