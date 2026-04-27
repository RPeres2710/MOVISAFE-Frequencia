(function () {
  "use strict";

  const STORAGE_KEY = "movisafe_data_2026";
  const TABLE = "movisafe_state";
  const DEFAULT_SYNC_CONFIG = {
    autoLoad: true,
    autoSave: true,
    debounceMs: 1200,
    minIntervalMs: 4000,
    compareMarginMs: 2000, // tolerância de relógio (local x servidor)
  };

  let suppressSchedule = false;
  let applyingRemote = false;
  let saveTimer = null;
  let inFlightSave = false;
  let saveAgainAfter = false;
  let lastCloudSaveAt = 0;
  let lastSyncHint = "";

  function getStatusEl() {
    return document.getElementById("cloudStatus");
  }

  function setStatus(text) {
    const el = getStatusEl();
    if (el) el.textContent = text || "";
  }

  function setStatusState(state) {
    const el = getStatusEl();
    if (!el) return;

    el.classList.remove(
      "status-online",
      "status-offline",
      "status-error",
      "status-not-configured"
    );

    if (!state) return;
    el.classList.add(`status-${state}`);
  }

  function isSupabaseReady() {
    const cfg = window.SUPABASE_CONFIG || {};
    return !!(
      cfg.url &&
      cfg.anonKey &&
      window.supabase &&
      typeof window.supabase.createClient === "function"
    );
  }

  function getSyncConfig() {
    const cfg = window.SUPABASE_SYNC_CONFIG || {};
    return {
      ...DEFAULT_SYNC_CONFIG,
      ...cfg,
    };
  }

  function renderStatus({ user, hint, authError }) {
    if (!isSupabaseReady()) {
      setStatus("☁️ (não configurado)");
      setStatusState("not-configured");
      return;
    }
    if (!navigator.onLine) {
      setStatus("☁️ offline");
      setStatusState("offline");
      return;
    }
    if (authError) {
      setStatus("☁️ erro (auth)");
      setStatusState("error");
      return;
    }
    if (!user) {
      const suffix = hint ? ` • ${hint}` : "";
      setStatus(`☁️ online${suffix}`);
      setStatusState("online");
      return;
    }
    const email = user.email || "logado";
    const suffix = hint ? ` • ${hint}` : "";
    setStatus(`☁️ ${email}${suffix}`);
    setStatusState("online");
  }

  function requireSupabaseConfig() {
    const cfg = window.SUPABASE_CONFIG || {};
    if (!cfg.url || !cfg.anonKey) {
      alert(
        "Supabase não configurado.\n\nPreencha `js/supabase-config.js` com Project URL e anon public key (Settings → API)."
      );
      return null;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      alert(
        "Biblioteca do Supabase não carregou.\n\nVerifique sua conexão e o <script> do supabase-js no <head>."
      );
      return null;
    }
    return { url: cfg.url, anonKey: cfg.anonKey };
  }

  function getClient() {
    const cfg = requireSupabaseConfig();
    if (!cfg) return null;
    if (!window.__MOVISAFE_SUPABASE__) {
      window.__MOVISAFE_SUPABASE__ = window.supabase.createClient(cfg.url, cfg.anonKey);
    }
    return window.__MOVISAFE_SUPABASE__;
  }

  async function getUser(client) {
    const { data, error } = await client.auth.getUser();
    if (error) {
      // Supabase lança AuthSessionMissingError quando não há sessão; isso não é "falha", só significa "sem login".
      const msg = String(error?.message || "");
      const name = String(error?.name || "");
      if (name === "AuthSessionMissingError" || msg.toLowerCase().includes("auth session missing")) {
        return { user: null, error: null };
      }
      return { user: null, error };
    }
    return { user: data?.user || null, error: null };
  }

  async function updateCloudStatus() {
    const client = getClient();
    if (!client) {
      setStatus("☁️ (não configurado)");
      return null;
    }
    const { user, error } = await getUser(client);
    if (error) console.warn("[supabase] auth.getUser error:", error);
    renderStatus({ user, hint: lastSyncHint, authError: !!error });
    return { client, user, authError: !!error };
  }

  async function supabaseLogin() {
    const client = getClient();
    if (!client) return;

    const email = (prompt("Email (Supabase Auth):") || "").trim();
    if (!email) return;
    const password = prompt("Senha:") || "";
    if (!password) return;

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (!error) {
      await updateCloudStatus();
      alert("✅ Logado no Supabase.");
      return;
    }

    const wantsSignup = confirm(
      "Não foi possível entrar.\n\nQuer criar uma conta com esse email e senha agora?"
    );
    if (!wantsSignup) return;

    const signup = await client.auth.signUp({ email, password });
    if (signup.error) {
      alert(`❌ Erro ao criar conta: ${signup.error.message}`);
      return;
    }

    await updateCloudStatus();
    alert(
      "✅ Conta criada.\n\nSe seu projeto exige confirmação por email, confirme o link e depois tente entrar novamente."
    );
  }

  async function supabaseLogout() {
    const client = getClient();
    if (!client) return;
    await client.auth.signOut();
    lastSyncHint = "";
    await updateCloudStatus();
  }

  function readLocalState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { raw: null, payload: null, lastSavedMs: 0, parseError: false };
    try {
      const payload = JSON.parse(raw);
      const lastSavedMs = Date.parse(payload?.lastSaved || "") || 0;
      return { raw, payload, lastSavedMs, parseError: false };
    } catch {
      return { raw, payload: null, lastSavedMs: 0, parseError: true };
    }
  }

  async function fetchCloudRow(client) {
    return client
      .from(TABLE)
      .select("payload, updated_at")
      .eq("storage_key", STORAGE_KEY)
      .maybeSingle();
  }

  function applyPayloadToApp(payload) {
    applyingRemote = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));

      if (typeof window.loadFromLocalStorage === "function") {
        try {
          window.loadFromLocalStorage();
        } catch {}
      }
      if (typeof window.updateCalendar === "function") {
        try {
          window.updateCalendar();
        } catch {}
      } else {
        window.location.reload();
      }
    } finally {
      // libera o autosave no próximo tick, evitando salvar de volta imediatamente após aplicar o remoto
      setTimeout(() => {
        applyingRemote = false;
      }, 0);
    }
  }

  async function cloudSaveCore({ silent }) {
    const client = getClient();
    if (!client) return { ok: false, reason: "not_configured" };

    const { user, error: authError } = await getUser(client);
    if (authError || !user) {
      if (!silent) alert("Você precisa estar logado para salvar na nuvem.");
      return { ok: false, reason: "not_logged_in" };
    }

    if (typeof window.saveToLocalStorage === "function") {
      suppressSchedule = true;
      try {
        window.saveToLocalStorage();
      } catch {}
      suppressSchedule = false;
    }

    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      if (!silent) alert("Não há dados locais para salvar (localStorage vazio).");
      return { ok: false, reason: "empty_local" };
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      if (!silent) alert("Dados locais inválidos (JSON).");
      return { ok: false, reason: "invalid_local_json" };
    }

    const { error } = await client
      .from(TABLE)
      .upsert(
        { user_id: user.id, storage_key: STORAGE_KEY, payload },
        { onConflict: "user_id,storage_key" }
      );

    if (error) {
      if (!silent) alert(`❌ Erro ao salvar na nuvem: ${error.message}`);
      return { ok: false, reason: "save_error", error };
    }

    return { ok: true };
  }

  async function cloudLoadCore({ silent }) {
    const client = getClient();
    if (!client) return { ok: false, reason: "not_configured" };

    const { user, error: authError } = await getUser(client);
    if (authError || !user) {
      if (!silent) alert("Você precisa estar logado para carregar da nuvem.");
      return { ok: false, reason: "not_logged_in" };
    }

    const { data, error } = await fetchCloudRow(client);

    if (error) {
      if (!silent) alert(`❌ Erro ao carregar da nuvem: ${error.message}`);
      return { ok: false, reason: "load_error", error };
    }
    if (!data?.payload) {
      if (!silent) alert("Nenhum backup encontrado na nuvem para este usuário.");
      return { ok: false, reason: "no_backup" };
    }

    applyPayloadToApp(data.payload);
    return { ok: true, updatedAt: data.updated_at };
  }

  async function cloudSave() {
    const res = await cloudSaveCore({ silent: false });
    if (res.ok) alert("✅ Salvo na nuvem!");
  }

  async function cloudLoad() {
    const res = await cloudLoadCore({ silent: false });
    if (res.ok) alert("✅ Dados carregados da nuvem.");
  }

  function scheduleCloudSave(reason) {
    const cfg = getSyncConfig();
    if (!cfg.autoSave) return;
    if (suppressSchedule) return;
    if (applyingRemote) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void cloudSaveSilent(reason);
    }, cfg.debounceMs);
  }

  async function cloudSaveSilent(reason) {
    const cfg = getSyncConfig();
    const client = getClient();
    if (!client) return;
    if (!navigator.onLine) {
      lastSyncHint = "offline";
      const { user, error: authError } = await getUser(client);
      renderStatus({ user, hint: lastSyncHint, authError: !!authError });
      return;
    }

    const { user, error: authError } = await getUser(client);
    if (authError || !user) return;

    if (inFlightSave) {
      saveAgainAfter = true;
      return;
    }

    const now = Date.now();
    if (now - lastCloudSaveAt < cfg.minIntervalMs) {
      scheduleCloudSave("rate-limit");
      return;
    }

    inFlightSave = true;
    lastSyncHint = "salvando…";
    renderStatus({ user, hint: lastSyncHint, authError: false });

    const res = await cloudSaveCore({ silent: true });
    inFlightSave = false;

    if (res.ok) {
      lastCloudSaveAt = Date.now();
      lastSyncHint = reason ? `sincronizado (${reason})` : "sincronizado";
      renderStatus({ user, hint: lastSyncHint, authError: false });
    } else {
      lastSyncHint = "erro ao salvar";
      renderStatus({ user, hint: lastSyncHint, authError: false });
    }

    if (saveAgainAfter) {
      saveAgainAfter = false;
      scheduleCloudSave("pending");
    }
  }

  async function autoSyncOnLogin() {
    const cfg = getSyncConfig();
    if (!cfg.autoLoad && !cfg.autoSave) return;

    const client = getClient();
    if (!client) return;
    const { user, error: authError } = await getUser(client);
    if (authError || !user) return;

    // Auto-load (e resolução de conflitos simples: mais recente vence)
    if (cfg.autoLoad) {
      lastSyncHint = "sincronizando…";
      renderStatus({ user, hint: lastSyncHint, authError: false });

      const local = readLocalState();
      if (local.parseError) {
        // Não sobrescreve cloud com local inválido; tenta puxar da nuvem.
        const load = await cloudLoadCore({ silent: true });
        if (load.ok) {
          lastSyncHint = "carregado";
          renderStatus({ user, hint: lastSyncHint, authError: false });
        } else {
          lastSyncHint = "local inválido";
          renderStatus({ user, hint: lastSyncHint, authError: false });
        }
        return;
      }

      const { data, error } = await fetchCloudRow(client);
      if (error) {
        lastSyncHint = "erro ao carregar";
        renderStatus({ user, hint: lastSyncHint, authError: false });
        return;
      }

      const cloudPayload = data?.payload || null;
      const cloudMs = Date.parse(data?.updated_at || "") || 0;
      const localMs = local.lastSavedMs || 0;
      const margin = cfg.compareMarginMs;

      if (!cloudPayload && !local.payload) {
        lastSyncHint = "sem backup";
        renderStatus({ user, hint: lastSyncHint, authError: false });
        return;
      }

      if (cloudPayload && !local.payload) {
        applyPayloadToApp(cloudPayload);
        lastSyncHint = "carregado";
        renderStatus({ user, hint: lastSyncHint, authError: false });
        return;
      }

      if (!cloudPayload && local.payload) {
        const saved = await cloudSaveCore({ silent: true });
        lastSyncHint = saved.ok ? "salvo" : "erro ao salvar";
        renderStatus({ user, hint: lastSyncHint, authError: false });
        return;
      }

      // Ambos existem: escolhe o mais recente.
      if (cloudMs > localMs + margin) {
        applyPayloadToApp(cloudPayload);
        lastSyncHint = "carregado";
        renderStatus({ user, hint: lastSyncHint, authError: false });
        return;
      }
      if (localMs > cloudMs + margin) {
        const saved = await cloudSaveCore({ silent: true });
        lastSyncHint = saved.ok ? "salvo" : "erro ao salvar";
        renderStatus({ user, hint: lastSyncHint, authError: false });
        return;
      }

      lastSyncHint = "em dia";
      renderStatus({ user, hint: lastSyncHint, authError: false });
    }
  }

  function hookLocalSave() {
    const cfg = getSyncConfig();
    if (!cfg.autoSave) return;
    if (window.__MOVISAFE_CLOUD_HOOKED__) return;

    const orig = window.saveToLocalStorage;
    if (typeof orig !== "function") return;

    window.saveToLocalStorage = function (...args) {
      const result = orig.apply(this, args);
      scheduleCloudSave("local");
      return result;
    };

    window.__MOVISAFE_CLOUD_HOOKED__ = true;
  }

  window.supabaseLogin = supabaseLogin;
  window.supabaseLogout = supabaseLogout;
  window.cloudSave = cloudSave;
  window.cloudLoad = cloudLoad;
  window.updateCloudStatus = updateCloudStatus;

  document.addEventListener("DOMContentLoaded", async () => {
    const cfg = getSyncConfig();

    const status = await updateCloudStatus();
    const client = getClient();
    if (!client) return;

    hookLocalSave();

    const statusEl = getStatusEl();
    if (statusEl && !statusEl.__movisafeBound) {
      statusEl.__movisafeBound = true;
      statusEl.title = "Clique para entrar (Supabase). Clique com botão direito para sair.";
      statusEl.addEventListener("click", () => {
        void supabaseLogin();
      });
      statusEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        void supabaseLogout();
      });
    }

    // Caso já exista sessão (o supabase-js restaura), faz o sync automaticamente.
    if (cfg.autoLoad || cfg.autoSave) {
      if (status?.user) {
        await autoSyncOnLogin();
      }
    }

    client.auth.onAuthStateChange(async () => {
      const s = await updateCloudStatus();
      if (s?.user) {
        await autoSyncOnLogin();
      }
    });

    window.addEventListener("online", async () => {
      const { user, error: authError } = await getUser(client);
      if (authError || !user) return;
      if (lastSyncHint === "offline") {
        scheduleCloudSave("online");
      }
    });

    window.addEventListener("offline", () => {
      void updateCloudStatus();
    });
  });
})();
