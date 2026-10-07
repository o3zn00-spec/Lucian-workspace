"use client";

/* LUCIAN Settings — Privacy & Security section.
 *
 * Global privacy only. Vault-specific financial security (withdrawal
 * limits, allowlists, destination delay, 2FA) lives in Vault and is
 * NOT duplicated here. Settings links to /vault?tab=security.
 *
 * Auth-dependent features (startup auth, password management, active
 * sessions, sign-out, 2FA management) are explicitly NOT shown as
 * available — they will be added when account infrastructure ships.
 */

import { useRouter } from "next/navigation";
import { Shield, Lock } from "lucide-react";
import { useSettingsStore, type SettingsSectionId } from "@/store/settings";
import { SettingsGroup, SettingsRow, SettingsSectionHeader, StatusPill } from "@/components/settings/primitives";
import { Switch } from "@/components/ui-devspace/switch";
import { Button } from "@/components/ui-devspace/button";

export function PrivacySection({ onNavigate }: { onNavigate: (id: SettingsSectionId) => void }) {
  const router = useRouter();
  const privacy = useSettingsStore((s) => s.privacy);
  const setPrivacy = useSettingsStore((s) => s.setPrivacy);

  return (
    <div>
      <SettingsSectionHeader
        title="Privacy & Security"
        subtitle="Global privacy preferences. Vault-specific financial security lives in Vault."
      />

      <SettingsGroup title="Privacy Mode">
        <SettingsRow
          title="Privacy Mode"
          description="Mask sensitive values across LUCIAN (balances, account numbers, API hints)."
        >
          <Switch
            checked={privacy.privacyMode}
            onCheckedChange={(v) => setPrivacy({ privacyMode: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Masking">
        <SettingsRow title="Mask sensitive in notifications" description="Hide sensitive values inside notification messages.">
          <Switch
            checked={privacy.maskSensitiveInNotifications}
            onCheckedChange={(v) => setPrivacy({ maskSensitiveInNotifications: v })}
          />
        </SettingsRow>
        <SettingsRow title="Mask sensitive in Global Search" description="Hide sensitive values in Global Search results.">
          <Switch
            checked={privacy.maskSensitiveInGlobalSearch}
            onCheckedChange={(v) => setPrivacy({ maskSensitiveInGlobalSearch: v })}
          />
        </SettingsRow>
        <SettingsRow title="Mask sensitive on Home" description="Hide sensitive values on the Home page.">
          <Switch
            checked={privacy.maskSensitiveOnHome}
            onCheckedChange={(v) => setPrivacy({ maskSensitiveOnHome: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Vault Security">
        <SettingsRow
          title="Vault → Security"
          description="Withdrawal limits, crypto allowlists, new-destination delay, 2FA requirement. These live in Vault — Settings does not duplicate them."
        >
          <Button
            size="sm"
            variant="outline"
            data-navigation-target="/vault?tab=security"
            onClick={() => router.push("/vault?tab=security")}
          >
            <Shield className="h-3.5 w-3.5" />
            Open Vault Security
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Account Security (Auth-Dependent)">
        <SettingsRow
          title="Require authentication at startup"
          description="Available after account authentication is enabled."
        >
          <StatusPill status="setup_required" label="Requires account setup" />
        </SettingsRow>
        <SettingsRow
          title="Password management"
          description="Available after account authentication is enabled."
        >
          <StatusPill status="setup_required" label="Requires account setup" />
        </SettingsRow>
        <SettingsRow
          title="Active sessions"
          description="Available after account authentication is enabled."
        >
          <StatusPill status="setup_required" label="Requires account setup" />
        </SettingsRow>
        <SettingsRow
          title="Sign out other sessions"
          description="Available after account authentication is enabled."
        >
          <StatusPill status="setup_required" label="Requires account setup" />
        </SettingsRow>
        <SettingsRow
          title="Two-factor authentication"
          description="Available after account authentication is enabled."
        >
          <StatusPill status="setup_required" label="Requires account setup" />
        </SettingsRow>
        <div className="flex items-center gap-2 py-2 text-[11px] text-fg-muted">
          <Lock className="h-3 w-3" />
          Account security is not yet available. It will become available when account infrastructure is enabled.
        </div>
      </SettingsGroup>
    </div>
  );
}
