// Arquivo propositalmente "safe" para deploy (GitHub Pages etc.).
// - Mantém o script existindo para evitar 404.
// - Não hardcodeia chaves no repositório.
// - O app pode ser configurado via UI (clique no ☁️), salvando em `localStorage` como `movisafe_supabase_config`.

(function () {
  window.SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};

  try {
    if (!window.SUPABASE_CONFIG.url || !window.SUPABASE_CONFIG.anonKey) {
      const raw = localStorage.getItem("movisafe_supabase_config");
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg?.url && cfg?.anonKey) window.SUPABASE_CONFIG = cfg;
      }
    }
  } catch {}
})();
