import { sb } from './supabase.js';
import { state } from './store.js';
import { app, esc, toast } from './ui.js';

export function renderLogin(){
  app.innerHTML = `<section class="auth-shell"><form class="auth-card" id="login-form">
    <div class="brand"><div class="brand-mark">A2C</div><div><h1>A2C Finanzas</h1><p class="muted">Acceso privado</p></div></div>
    <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
    <div class="field"><label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn primary full">Entrar</button>
  </form></section>`;
  document.querySelector('#login-form').addEventListener('submit', signIn);
}

async function signIn(event){
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const fd = new FormData(event.currentTarget);
  const { error } = await sb.auth.signInWithPassword({
    email: String(fd.get('email')).trim().toLowerCase(),
    password: String(fd.get('password'))
  });
  button.disabled = false;
  if(error) toast('Email o contraseña incorrectos', true);
}

export async function signOut(){ await sb.auth.signOut(); }

export async function loadIdentity(){
  const { data: sessionData } = await sb.auth.getSession();
  state.session = sessionData.session;
  state.user = sessionData.session?.user || null;
  if(!state.user) return false;

  const [{ data: profile, error: pe }, { data: permissions }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', state.user.id).single(),
    sb.from('user_permissions').select('*').eq('user_id', state.user.id).maybeSingle()
  ]);
  if(pe) throw pe;
  if(profile.active === false) throw new Error('Tu cuenta está desactivada.');
  state.profile = profile;
  state.permissions = permissions || {};
  return true;
}

export function isAdmin(){ return state.profile?.role === 'admin'; }
