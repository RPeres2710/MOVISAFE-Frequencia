## MOVISAFE - Frequência 2026

Este projeto é um `index.html` (front-end puro) que salva a escala/frequência no `localStorage` e, opcionalmente, faz backup na nuvem via Supabase (por usuário).

### 1) Configurar no Supabase

1. Crie um projeto no Supabase.
2. Vá em **SQL Editor** e execute o arquivo `supabase/schema.sql` (ele cria a tabela, RLS e triggers).
3. Vá em **Authentication → Providers** e confirme que **Email** está habilitado.
   - Se você não quiser confirmação por email, desative **Confirm email** em **Authentication → Settings**.

### 2) Configurar no projeto (local)

1. Abra `js/supabase-config.example.js`.
2. Copie para `js/supabase-config.js` (já existe) e preencha:
   - **Project URL** e **anon public key** em **Project Settings → API**.

Exemplo:

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxx.supabase.co",
  anonKey: "eyJ....",
};
```

### 3) Usar no app

- Abra `index.html` no navegador (de preferência servido por um servidor local).
  - VS Code: extensão **Live Server** (recomendado).
- No topo, use:
  - `☁️ Entrar` para logar/criar conta.
  - Após logar, o app **sincroniza automaticamente** com a nuvem:
    - No início, ele carrega/salva automaticamente escolhendo o estado **mais recente** (local x nuvem).
    - A cada alteração (autosave local), ele salva na nuvem com **debounce**.
  - Os botões `☁️ Salvar na Nuvem` e `☁️ Carregar da Nuvem` continuam disponíveis (manual), mas não são mais obrigatórios.

### (Opcional) Ajustar comportamento do auto-sync

Você pode configurar em qualquer lugar antes de `js/supabase-sync.js` rodar (ex.: no `index.html`):

```js
window.SUPABASE_SYNC_CONFIG = {
  autoLoad: true,
  autoSave: true,
  debounceMs: 1200,
  minIntervalMs: 4000,
};
```
