import { useEffect, useState } from "react";
import { OrazakaLogo } from "@krizaka/ui";
import { AuthLayout } from "@krizaka/ui/auth-layout";
import { Alert } from "@krizaka/ui/alert";
import { Badge } from "@krizaka/ui/badge";
import { Button } from "@krizaka/ui/button";
import { api, errorMessage, hostOf, on, type Account, type Snapshot } from "../lib/api";
import { useI18n } from "../lib/i18n";

/** Sign-in with the system browser (OAuth code + PKCE) and the signed-in account. The app never holds a password;
 * the tokens stay in the macOS Keychain, on the Rust side — this screen only ever receives the account. */
export function AccountPanel({ snap }: { snap: Snapshot }) {
  const { t, format } = useI18n();
  const [account, setAccount] = useState<Account | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.account().then(setAccount).catch((e) => setError(errorMessage(e)));
    const offs = [
      on<Account>("auth-changed", (a) => {
        setAccount(a);
        setWaiting(false);
        setError(null);
      }),
      on<string>("auth-error", (message) => {
        setWaiting(false);
        setError(format(t("account.failed"), { message }));
      }),
    ];
    return () => offs.forEach((o) => void o.then((f) => f()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const begin = async () => {
    setError(null);
    try {
      await api.signIn();
      setWaiting(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const cancel = () => {
    void api.cancelSignIn();
    setWaiting(false);
  };

  if (!account) return null;

  if (!account.signedIn) {
    const where =
      snap.settings.mode === "local" ? t("account.localHint") : format(t("account.remoteHint"), { host: hostOf(snap.settings.remoteUrl) });
    return (
      <div className="overflow-hidden rounded-2xl border border-border-default">
        <AuthLayout
          brand={
            <span className="flex items-center gap-2">
              <OrazakaLogo size={28} animated={false} title="Orazaka" />
              <span className="font-semibold">Orazaka</span>
            </span>
          }
          title={t("account.signedOutTitle")}
          description={t("account.signedOutLead")}
          promise={t("account.promise")}
          aside={<p>{t("account.asideText")}</p>}
          asideFooter="© Krizaka · Montréal"
          className="min-h-[34rem]"
        >
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            {waiting ? (
              <>
                <Alert tone="info" role="status">
                  <strong>{t("account.waiting")}</strong> {t("account.waitingHint")}
                </Alert>
                <Button variant="secondary" onClick={cancel}>{t("account.cancel")}</Button>
              </>
            ) : (
              <Button size="lg" shape="cut" shimmer onClick={() => void begin()}>{t("account.signIn")}</Button>
            )}
            <p className="text-xs text-fg-secondary">{where}</p>
          </div>
        </AuthLayout>
      </div>
    );
  }

  const row = (label: string, value: string | null | undefined) => (
    <div className="flex items-baseline gap-4 py-2">
      <dt className="w-40 shrink-0 text-sm text-fg-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{t("account.title")}</h2>
        <Badge tone="success" dot>{account.username}</Badge>
      </div>
      <dl className="divide-y divide-border-subtle rounded-xl border border-border-default bg-surface-2 px-4">
        {row(t("account.name"), account.username)}
        {row(t("account.email"), account.email)}
        {row(t("account.roles"), account.authorities.map((r) => r.replace("ROLE_", "").toLowerCase()).join(", "))}
        {row(t("account.server"), account.server ? hostOf(account.server) : null)}
      </dl>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex items-center gap-3">
        <Button variant="danger" onClick={() => void api.signOut().then(setAccount).catch((e) => setError(errorMessage(e)))}>
          {t("account.signOut")}
        </Button>
      </div>
      <p className="text-xs text-fg-secondary">{t("account.signOutHint")} {t("account.keychain")}</p>
    </div>
  );
}
