import React from 'react';
import { Field } from './Common.js';
export type WordPressAuthMode = 'none' | 'application_password' | 'session';
export function wordpressAuth(mode: WordPressAuthMode, username: string, password: string): Record<string, unknown> {
  return mode === 'none' ? { mode } : mode === 'application_password' ? { mode, username, appPassword: password } : { mode, username, password };
}
export function WordPressConnection({ mode, onMode, username, onUsername, password, onPassword, remember, onRemember, keyringAvailable = false, busy = false, browserOpened = false, onOpenBrowser, onUseBrowser }: {
  mode: WordPressAuthMode; onMode: (value: WordPressAuthMode) => void; username: string; onUsername: (value: string) => void;
  password: string; onPassword: (value: string) => void; remember: boolean; onRemember: (value: boolean) => void;
  keyringAvailable?: boolean; busy?: boolean; browserOpened?: boolean; onOpenBrowser: () => void; onUseBrowser: () => void;
}) {
  return <div className="stack-sm">
    <Field label="WordPress access method" hint="Choose the kind of credentials you actually have. Your normal website password is different from a WordPress application password.">
      <select value={mode} disabled={busy} onChange={event => onMode(event.target.value as WordPressAuthMode)}>
        <option value="none">Public content - no login</option>
        <option value="session">Website account - normal login password</option>
        <option value="application_password">WordPress application password - generated separately</option>
      </select>
    </Field>
    {mode === 'none' && <p className="small muted">Some websites protect their REST API even for published articles. If you receive HTTP 401, select Website account and sign in.</p>}
    {mode !== 'none' && <>
      <div className="grid-2"><Field label="WordPress username or email"><input value={username} autoComplete="username" disabled={busy} onChange={event => onUsername(event.target.value)} /></Field>
      <Field label={mode === 'session' ? 'Website login password' : 'WordPress application password'} hint={mode === 'session' ? 'Use the same password as on the website.' : 'A separate password generated in WordPress Users → Profile → Application Passwords. A membership account may not offer this feature.'}><input type="password" value={password} autoComplete="new-password" disabled={busy} onChange={event => onPassword(event.target.value)} /></Field></div>
      <label className="checkbox"><input type="checkbox" checked={remember} disabled={busy || !keyringAvailable} onChange={event => onRemember(event.target.checked)} />Remember in system password store{!keyringAvailable && ' (unavailable - session only)'}</label>
      {mode === 'session' && <details className="stack-sm" open={browserOpened || undefined}><summary>Trouble signing in?</summary><p className="small">Use this optional method only if the normal connection fails and the website needs an extra sign-in check. Sign in in the website window, choose Back to QMS after signing in, then Use signed-in session here.</p><div className="row wrap gap"><button type="button" disabled={busy} onClick={onOpenBrowser}>Open WordPress login window</button><button type="button" disabled={busy || !browserOpened} onClick={onUseBrowser}>Use signed-in session</button></div>{browserOpened && <p role="status" className="small">The login window is open. Finish signing in there, then return here to use the session.</p>}</details>}
    </>}
  </div>;
}
