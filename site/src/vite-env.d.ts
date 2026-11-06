/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public Keycloak issuer, e.g. https://auth.example.com/realms/lessonbooks. */
  readonly VITE_OIDC_AUTHORITY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
