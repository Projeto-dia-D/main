/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_SERVICE_ROLE_SECRET: string;
  readonly VITE_UAZAPI_URL: string;
  readonly VITE_UAZAPI_TOKEN: string;

  readonly VITE_META_TOKEN_RENAN: string;
  readonly VITE_META_ACCOUNT_RENAN: string;
  readonly VITE_META_TOKEN_WESLEI: string;
  readonly VITE_META_ACCOUNT_WESLEI: string;
  readonly VITE_META_TOKEN_ANDRE: string;
  readonly VITE_META_ACCOUNT_ANDRE: string;

  readonly VITE_MONDAY_TOKEN: string;
  readonly VITE_MONDAY_BOARD_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
