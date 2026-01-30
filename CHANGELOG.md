# Changelog

English · [简体中文](CHANGELOG.zh-CN.md)

All notable changes to Cockpit Tools will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---
## [0.4.7] - 2026-01-30

### Added
- **Authorized API cache**: Cache raw authorized API responses in `cache/quota_api_v1`.
- **Cache source marker**: Store `customSource` in API cache records to identify the writer.
- **Cache hit logging**: Log API cache hits/expiry during quota refresh.

### Changed
- **Legacy cache reader**: Reads the new API cache payload to preserve fast startup behavior.

## [0.4.6] - 2026-01-29

### Added
- **Update Notification**: Update dialog now displays release notes with localized content (English/Chinese).

### Fixed
- **i18n**: Fixed missing translations in Codex add account modal (OAuth, Token, Import tabs).
- **Accessibility**: Improved FREE tier badge contrast for better readability in light mode.
- **i18n**: Fixed hardcoded Chinese strings in tag deletion confirmation dialog.

---
## [0.4.3] - 2026-01-29

### Added
- **Codex Tag Management**: Added global tag deletion for Codex accounts.
- **Account Filtering & Tagging**:
  - Support for managing account tags (add/remove).
  - Support for filtering accounts by tags.
- **Compact View**:
  - Added compact view mode for account list.
  - Added status icons for disabled or warning states in compact view.
  - Support customizable model grouping in compact view.

### Changed
- **Smart Recommendations**: Improved dashboard recommendation logic to exclude disabled, forbidden, or empty accounts.
- **UI Improvements**:
  - Refined compact view interactions.
  - Removed redundant tag rendering in list views.
  
## [0.4.2] - 2026-01-29

### Added
- **Update Modal**: Unified update check into a modal dialog, including the entry in Settings → About.
- **Refresh Frequency**: Added Codex auto refresh interval settings (default 10 minutes).
- **Account Warnings**: Show refresh warnings in the account list, including invalid-credential hints.

### Changed
- **Update UX**: Update prompt now uses a non-transparent modal consistent with existing dialogs.

## [0.4.1] - 2026-01-29

### Added
- **Close Confirmation**: New close dialog with minimize/quit actions and a “remember choice” option.
- **Close Behavior Setting**: Configure the default close action in Settings → General.
- **Tray Menu**: System tray menu with navigation shortcuts and quota refresh actions.
- **Sorting Enhancements**: Sort by reset time for Antigravity group quotas and Codex weekly/hourly quotas.

### Changed
- **i18n**: Updated translations for close dialog, close behavior, and reset-time sorting across all 17 languages.
- **UI Polish**: Refined styling to support the new close dialog and related layout updates.


## [0.4.0] - 2026-01-28

### Added
- **Visual Dashboard**: Brand new dashboard providing a one-stop overview of both Antigravity and Codex accounts status.
- **Codex Support**: Full support for Codex account management.
  - View Hourly (5H) and Weekly quotas.
  - Automatic Plan recognition (Basic, Plus, Team, Enterprise).
  - Independent account list and card view.
- **Rebranding**: Project officially renamed to **Cockpit Tools**.
- **Sponsor & Feedback**: Added "Sponsor" and "Feedback" sections in Settings -> About for better community engagement.

### Changed
- **UI Overhaul**: Redesigned dashboard cards for extreme compactness and symmetry.
- **Typography**: switched default font to **Inter** for better readability.
- **Documentation**: Comprehensive update to README with fresh screenshots and structured feature overview.
- **i18n**: Updated translations for all 17 languages to cover new Dashboard and Codex features.


## [0.3.3] - 2026-01-24

### Added
- **Account Management**: Added sorting by creation time. Accounts are now sorted by creation time (descending) by default.
- **Database**: Added `created_at` field to the `accounts` table for precise account tracking.
- **i18n**: Added "Creation Time" related translations for all 17 supported languages.

## [0.3.2] - 2026-01-23

### Added
- **Engineering**: Added automatic version synchronization script. `package.json` version now automatically syncs to `tauri.conf.json` and `Cargo.toml`.
- **Engineering**: Added git pre-commit hook to strictly enforce Changelog updates when version changes.

## [0.3.1] - 2026-01-23

### Changed
- **Maintenance**: Routine version update and dependency maintenance.

## [0.3.0] - 2026-01-22

### Added
- **Model Grouping Management**: New grouping modal to customize model group display names.
  - Four fixed groups: Claude 4.5, G3-Pro, G3-Flash, G3-Image.
  - Custom group names are applied to account cards and sorting dropdowns.
  - Group settings are persisted locally and auto-initialized on first launch.
- **Account Sorting**: Added sorting options for account list.
  - Default sorting by overall quota.
  - Sort by specific group quota (e.g., by Claude 4.5 quota).
  - Secondary sorting by overall quota when group quotas are equal.
- **i18n**: Added sorting and group management translations for all 17 supported languages.

### Changed
- Model names on account cards now dynamically reflect custom group names.
- Removed "Other" group display to simplify the grouping model.
- Decoupled grouping configuration between desktop app and VS Code extension.

---

## [0.2.0] - 2026-01-21

### Added
- **Update Checker**: Implemented automatic update checking via GitHub Releases API.
  - On startup, the app checks for new versions (once every 24 hours by default).
  - A beautiful glassmorphism notification card appears in the top-right corner when an update is available.
  - Manual "Check for Updates" button added to **Settings → About** page with real-time status feedback.
  - Clicking the notification opens the GitHub release page for download.
- **i18n**: Added update notification translations for all 17 supported languages.

---

## [0.1.0] - 2025-01-21

### Added
- **Account Management**: Complete account management with OAuth authorization support.
  - Add accounts via Google OAuth authorization flow.
  - Import accounts from Antigravity Tools (`~/.antigravity_tools/`), local Antigravity client, or VS Code extension.
  - Export accounts to JSON for backup and migration.
  - Delete single or multiple accounts with confirmation.
  - Drag-and-drop reordering of account list.
- **Quota Monitoring**: Real-time monitoring of model quotas for all accounts.
  - Card view and list view display modes.
  - Filter accounts by subscription tier (PRO/ULTRA/FREE).
  - Auto-refresh with configurable intervals (2/5/10/15 minutes or disabled).
  - Quick switch between accounts with one click.
- **Device Fingerprints**: Comprehensive device fingerprint management.
  - Generate new fingerprints with customizable names.
  - Capture current device fingerprint.
  - Bind fingerprints to accounts for device simulation.
  - Import fingerprints from Antigravity Tools or JSON files.
  - Preview fingerprint profile details.
- **Wakeup Tasks**: Automated account wakeup scheduling system.
  - Create multiple wakeup tasks with independent controls.
  - Supports scheduled, Crontab, and quota-reset trigger modes.
  - Multi-model and multi-account selection.
  - Custom wakeup prompts and max token limits.
  - Trigger history with detailed logs.
  - Global wakeup toggle for quick enable/disable.
- **Antigravity Cockpit Integration**: Deep integration with the VS Code extension.
  - WebSocket server for bidirectional communication.
  - Remote account switching from the extension.
  - Account import/export synchronization.
- **Settings**: Comprehensive application settings.
  - Language selection (17 languages supported).
  - Theme switching (Light/Dark/System).
  - WebSocket service configuration with custom port support.
  - Data and fingerprint directory shortcuts.
- **i18n**: Full internationalization support for 17 languages.
  - 🇨🇳 简体中文, 🇹🇼 繁體中文, 🇺🇸 English
  - 🇯🇵 日本語, 🇰🇷 한국어, 🇻🇳 Tiếng Việt
  - 🇩🇪 Deutsch, 🇫🇷 Français, 🇪🇸 Español, 🇮🇹 Italiano, 🇵🇹 Português
  - 🇷🇺 Русский, 🇹🇷 Türkçe, 🇵🇱 Polski, 🇨🇿 Čeština, 🇸🇦 العربية
- **UI/UX**: Modern, polished user interface.
  - Glassmorphism design with smooth animations.
  - Responsive sidebar navigation.
  - Dark mode support with seamless theme transitions.
  - Native macOS window controls and drag region.

### Technical
- Built with Tauri 2.0 + React + TypeScript.
- SQLite database for local data persistence.
- Secure credential storage using system keychain.
- Cross-platform support (macOS primary, Windows/Linux planned).
