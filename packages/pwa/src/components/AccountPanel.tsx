import type { AccountInfo } from '../lib/store.js';

/**
 * Kiro account panel — who the agent runs as, plus sign in and sign out.
 *
 * The identity shown is only ever what `kiro-cli whoami` reported. When the CLI
 * gives no email, this says so rather than inventing a label that reads like
 * data (context.md §6).
 *
 * Sign-in uses the CLI's OAuth device flow, so the code and URL come from Kiro
 * itself; Aibou never handles the password and never sees a Kiro credential.
 */
interface AccountPanelProps {
  account: AccountInfo | null;
  /** False while the Bridge is unreachable, so this cannot claim to be checking. */
  connected: boolean;
  onLogin: (social?: 'google' | 'github') => void;
  onCancelLogin: () => void;
  onLogout: () => void;
}

export function AccountPanel({
  account,
  connected,
  onLogin,
  onCancelLogin,
  onLogout,
}: AccountPanelProps) {
  // The account can only come from the Bridge. Saying "checking…" while there is
  // no connection describes work that is not happening.
  if (!connected && !account) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400">
        Not connected to the Bridge, so the Kiro account is unknown.
      </div>
    );
  }

  if (!account) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 text-sm text-gray-400">
        Checking the Kiro account…
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-gray-300">Kiro account</h2>
          <Identity account={account} />
        </div>
        <Actions
          account={account}
          onLogin={onLogin}
          onCancelLogin={onCancelLogin}
          onLogout={onLogout}
        />
      </div>

      {account.state === 'authenticating' && (
        <DeviceFlow account={account} onCancelLogin={onCancelLogin} />
      )}

      {account.state === 'unauthenticated' && (
        <p className="mt-3 text-xs text-amber-400">
          The agent cannot run until an account is signed in. Signing in here keeps you signed in
          until you sign out — restarting the Bridge or the watch will not end the session.
        </p>
      )}

      {account.reason && account.state !== 'authenticating' && (
        <p className="mt-3 text-xs text-gray-400">{account.reason}</p>
      )}
    </div>
  );
}

function Identity({ account }: { account: AccountInfo }) {
  switch (account.state) {
    case 'authenticated': {
      // Prefer the email, but never fabricate one when the CLI omitted it.
      const label = account.email ?? account.accountType ?? 'Signed in';
      return (
        <div className="mt-1">
          <p className="text-white truncate" title={label}>
            {label}
          </p>
          <p className="text-xs text-gray-400">
            {[account.provider, account.accountType].filter(Boolean).join(' · ') ||
              'signed in'}
          </p>
        </div>
      );
    }

    case 'authenticating':
      return <p className="mt-1 text-amber-400">Waiting for you to confirm sign-in…</p>;

    case 'mock':
      return <p className="mt-1 text-amber-400">No account — the mock agent uses none</p>;

    case 'unavailable':
      return <p className="mt-1 text-red-400">Could not read the account</p>;

    case 'unauthenticated':
    default:
      return <p className="mt-1 text-white">Not signed in</p>;
  }
}

function Actions({
  account,
  onLogin,
  onCancelLogin,
  onLogout,
}: {
  account: AccountInfo;
  onLogin: (social?: 'google' | 'github') => void;
  onCancelLogin: () => void;
  onLogout: () => void;
}) {
  if (account.state === 'mock') return null;

  if (account.state === 'authenticating') {
    return (
      <button
        type="button"
        onClick={onCancelLogin}
        className="shrink-0 px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600 text-white"
      >
        Cancel
      </button>
    );
  }

  if (account.state === 'authenticated') {
    return (
      <button
        type="button"
        onClick={onLogout}
        className="shrink-0 px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-red-700 text-white"
      >
        Sign out
      </button>
    );
  }

  return (
    <div className="shrink-0 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => onLogin('google')}
        className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500 text-white"
      >
        Sign in with Google
      </button>
      <button
        type="button"
        onClick={() => onLogin('github')}
        className="px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600 text-white"
      >
        GitHub
      </button>
      <button
        type="button"
        onClick={() => onLogin()}
        className="px-3 py-1.5 text-xs rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
      >
        Builder ID / other
      </button>
    </div>
  );
}

/**
 * The device-flow instructions.
 *
 * Only rendered once Kiro has actually printed a URL or code — until then this
 * says it is waiting, rather than showing an empty box that looks broken.
 */
function DeviceFlow({
  account,
  onCancelLogin,
}: {
  account: AccountInfo;
  onCancelLogin: () => void;
}) {
  const { verificationUri, userCode } = account;

  if (!verificationUri && !userCode) {
    return (
      <p className="mt-3 text-xs text-gray-400">
        Starting sign-in… Kiro will provide a link and a code.{' '}
        <button type="button" onClick={onCancelLogin} className="underline">
          Cancel
        </button>
      </p>
    );
  }

  return (
    <div className="mt-3 rounded bg-gray-900 p-3 space-y-2">
      {verificationUri && (
        <div>
          <p className="text-xs text-gray-400">Open this link</p>
          <a
            href={verificationUri}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-blue-400 underline break-all"
          >
            {verificationUri}
          </a>
        </div>
      )}
      {userCode && (
        <div>
          <p className="text-xs text-gray-400">and enter this code</p>
          <p className="text-lg font-mono tracking-widest text-white">{userCode}</p>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Aibou never sees your Kiro password. This code is issued by Kiro.
      </p>
    </div>
  );
}
