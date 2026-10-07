"use client";

/* LUCIAN Settings — General section.
 *
 * Startup, Navigation, Regional preferences. All persisted to the
 * central useSettingsStore (one localStorage key, versioned).
 *
 * HONESTY RULE:
 *   - Settings that LUCIAN cannot genuinely support yet are marked with
 *     a "Not yet supported" badge rather than silently storing a value.
 *   - Settings that ARE wired show their effect immediately.
 */

import { useSettingsStore } from "@/store/settings";
import { SettingsGroup, SettingsRow, SettingsSectionHeader, StatusPill } from "@/components/settings/primitives";
import { Switch } from "@/components/ui-devspace/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui-devspace/select";

export function GeneralSection() {
  const startup = useSettingsStore((s) => s.general.startup);
  const navigation = useSettingsStore((s) => s.general.navigation);
  const regional = useSettingsStore((s) => s.general.regional);
  const setStartup = useSettingsStore((s) => s.setGeneralStartup);
  const setNavigation = useSettingsStore((s) => s.setGeneralNavigation);
  const setRegional = useSettingsStore((s) => s.setGeneralRegional);

  return (
    <div>
      <SettingsSectionHeader
        title="General"
        subtitle="Startup behavior, navigation, and regional formatting."
      />

      <SettingsGroup title="Startup">
        <SettingsRow title="Open Home on launch" description="Open the Home page when LUCIAN starts. When OFF, LUCIAN opens your default landing page instead.">
          <Switch checked={startup.openHomeOnLaunch} onCheckedChange={(v) => setStartup({ openHomeOnLaunch: v })} />
        </SettingsRow>
        <SettingsRow title="Reopen last module" description="Restore the module you last used. Not yet supported — LUCIAN's routing doesn't track 'last module' across sessions yet.">
          <Switch
            checked={startup.reopenLastModule}
            onCheckedChange={(v) => setStartup({ reopenLastModule: v })}
            disabled
          />
          <span className="ml-2"><StatusPill status="setup_required" label="Not yet supported" /></span>
        </SettingsRow>
        <SettingsRow title="Reopen last DevWorkspace project" description="Restore the last open DevWorkspace project. Wired to DevWorkspace startup (see DevWorkspace settings).">
          <Switch checked={startup.reopenLastDevWorkspaceProject} onCheckedChange={(v) => setStartup({ reopenLastDevWorkspaceProject: v })} />
        </SettingsRow>
        <SettingsRow title="Restore previous tabs / session" description="Restore the tabs and modules from your previous session. Not yet supported — LUCIAN doesn't persist per-tab session state yet.">
          <Switch
            checked={startup.restorePreviousTabs}
            onCheckedChange={(v) => setStartup({ restorePreviousTabs: v })}
            disabled
          />
          <span className="ml-2"><StatusPill status="setup_required" label="Not yet supported" /></span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Navigation">
        <SettingsRow title="Default landing page" description="Where LUCIAN lands when you open the app (applied when 'Open Home on launch' is OFF).">
          <Select value={navigation.defaultLandingPage} onValueChange={(v) => setNavigation({ defaultLandingPage: v as typeof navigation.defaultLandingPage })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="home">Home</SelectItem>
              <SelectItem value="vault">Vault</SelectItem>
              <SelectItem value="markets">Markets</SelectItem>
              <SelectItem value="dev-workspace">DevWorkspace</SelectItem>
              <SelectItem value="economy-hub">Economy Hub</SelectItem>
              <SelectItem value="news-feed">News</SelectItem>
              <SelectItem value="research">Research</SelectItem>
              <SelectItem value="knowledge-library">Mindset Library</SelectItem>
              <SelectItem value="chess-academy">Chess</SelectItem>
              <SelectItem value="investing">Investing</SelectItem>
              <SelectItem value="notes">Notes</SelectItem>
              <SelectItem value="browser">Browser</SelectItem>
              <SelectItem value="settings">Settings</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Internal links" description="Whether in-app links open in the same tab or a new tab.">
          <Select value={navigation.internalLinks} onValueChange={(v) => setNavigation({ internalLinks: v as typeof navigation.internalLinks })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="same-tab">Same tab</SelectItem>
              <SelectItem value="new-tab">New tab</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="External links" description="Whether external links open in the same tab or a new tab.">
          <Select value={navigation.externalLinks} onValueChange={(v) => setNavigation({ externalLinks: v as typeof navigation.externalLinks })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="same-tab">Same tab</SelectItem>
              <SelectItem value="new-tab">New tab</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Remember sidebar collapsed state" description="Keep the sidebar collapsed or expanded as you left it. When OFF, the sidebar always starts expanded.">
          <Switch checked={navigation.rememberSidebarCollapsed} onCheckedChange={(v) => setNavigation({ rememberSidebarCollapsed: v })} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Regional">
        <SettingsRow title="Language" description="Display language for LUCIAN. Additional languages require translation support which is not yet implemented.">
          <Select value={regional.language} onValueChange={(v) => setRegional({ language: v as typeof regional.language })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Time format" description="How times are displayed across LUCIAN. Applied through the shared regional formatter.">
          <Select value={regional.timeFormat} onValueChange={(v) => setRegional({ timeFormat: v as typeof regional.timeFormat })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="12h">12-hour</SelectItem>
              <SelectItem value="24h">24-hour</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Date format" description="How dates are displayed. Applied through the shared regional formatter.">
          <Select value={regional.dateFormat} onValueChange={(v) => setRegional({ dateFormat: v as typeof regional.dateFormat })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="iso">ISO (2026-08-27)</SelectItem>
              <SelectItem value="us">US (08/27/2026)</SelectItem>
              <SelectItem value="eu">EU (27/08/2026)</SelectItem>
              <SelectItem value="long">Long (Aug 27, 2026)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Number format" description="How numbers are displayed. Applied through the shared regional formatter.">
          <Select value={regional.numberFormat} onValueChange={(v) => setRegional({ numberFormat: v as typeof regional.numberFormat })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="us">US (1,234.56)</SelectItem>
              <SelectItem value="eu">EU (1.234,56)</SelectItem>
              <SelectItem value="iso">ISO (1 234.56)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Currency display" description="Whether currency is shown as symbol, code, or name. Applied through the shared regional formatter.">
          <Select value={regional.currencyDisplay} onValueChange={(v) => setRegional({ currencyDisplay: v as typeof regional.currencyDisplay })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="symbol">Symbol ($)</SelectItem>
              <SelectItem value="code">Code (USD)</SelectItem>
              <SelectItem value="name">Name (US Dollar)</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
