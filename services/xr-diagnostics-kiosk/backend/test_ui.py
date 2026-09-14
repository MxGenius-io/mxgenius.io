import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "frontend" / "index.html").read_text(encoding="utf-8")
JS = (ROOT / "frontend" / "assets" / "kiosk.js").read_text(encoding="utf-8")
BLUETOOTH_COMPAT = (ROOT / "systemd" / "mxg-bluetooth-compat.conf").read_text(encoding="utf-8")
INSTALL = (ROOT / "install.sh").read_text(encoding="utf-8")
UPDATE = (ROOT / "update.sh").read_text(encoding="utf-8")
BLUETOOTH_STREAM = (ROOT / "backend" / "bluetooth_stream.py").read_text(encoding="utf-8")
DESKTOP_ENTRY = (ROOT / "systemd" / "mxg-diagnostics-kiosk.desktop").read_text(encoding="utf-8")
CONTROL_SERVICE = (ROOT / "systemd" / "mxg-edge-control.service").read_text(encoding="utf-8")
CONTROL_AGENT = (ROOT / "backend" / "control_agent.py").read_text(encoding="utf-8")
APPLIANCE_CONFIG = (ROOT / "scripts" / "configure-appliance.sh").read_text(encoding="utf-8")
APPLIANCE_DIAGNOSTIC = (ROOT / "scripts" / "diagnose-appliance.sh").read_text(encoding="utf-8")
BOOT_STATUS = (ROOT / "scripts" / "boot-status.sh").read_text(encoding="utf-8")
BOOT_STATUS_SERVICE = (ROOT / "systemd" / "mxg-boot-status.service").read_text(encoding="utf-8")
KIOSK_SERVICE = (ROOT / "systemd" / "mxg-diagnostics-kiosk.service").read_text(encoding="utf-8")
KIOSK_START = (ROOT / "scripts" / "start-kiosk.sh").read_text(encoding="utf-8")
IMAGE_BUILDER = (ROOT / "scripts" / "build-appliance-image.sh").read_text(encoding="utf-8")
IMAGE_WRAPPER = (ROOT / "scripts" / "build-appliance-image.ps1").read_text(encoding="utf-8")
SD_COMMISSION = (ROOT / "deploy-to-sd.ps1").read_text(encoding="utf-8")
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()


class KioskUiContractTests(unittest.TestCase):
    def test_canonical_logo_is_packaged_and_used(self):
        logo = ROOT / "frontend" / "assets" / "mxgenius-logo.png"
        self.assertTrue(logo.is_file())
        self.assertGreater(logo.stat().st_size, 1000)
        self.assertIn("/assets/mxgenius-logo.png", HTML)

    def test_boot_splash_matches_the_web_brand_language_without_losing_live_state(self):
        for marker in ("boot-ambient", "boot-brand", "MXGenius<span>.</span>", "bootProgressBar"):
            self.assertIn(marker, HTML)
        for marker in ("--boot-progress", "boot-orbit", "boot-frame"):
            self.assertIn(marker, (ROOT / "frontend" / "assets" / "kiosk.css").read_text(encoding="utf-8"))
        self.assertIn("setBootStage('bootReady'", JS)

    def test_kiosk_assets_are_cache_busted_with_the_exact_release_version(self):
        self.assertIn(f'/assets/kiosk.css?v={VERSION}', HTML)
        self.assertIn(f'/assets/kiosk.js?v={VERSION}', HTML)

    def test_temperature_gauge_and_uptime_history_are_visible(self):
        for marker in ('id="temperatureGauge"', 'id="performanceCanvas"', 'PERFORMANCE OVER UPTIME'):
            self.assertIn(marker, HTML)
        for marker in ('diagnostics.performance-history', 'recordPerformance(snapshot)', 'drawPerformanceGraph'):
            self.assertIn(marker, JS)

    def test_peripheral_readiness_profiles_are_visible(self):
        for profile in ("FLIR ONE Pro", "Honeywell Xenon XP 1950g", "Zebra DS3608", "Socket Mobile S740"):
            self.assertIn(profile, HTML)

    def test_commissioning_log_has_filters_export_and_privacy_copy(self):
        for marker in ("id=\"logView\"", "id=\"exportLogs\"", "data-level=\"warning\"", "Raw scanner values are never written"):
            self.assertIn(marker, HTML)
        self.assertIn("Unverified scanner observation received", JS)
        self.assertNotIn("rawValue: event.rawValue", JS)

    def test_normalized_fixture_registry_is_loaded_from_local_bridge(self):
        self.assertIn("/api/v1/integrations/simulated", JS)
        self.assertIn("Normalized API shape previewed", JS)

    def test_bluetooth_serial_profile_enables_the_bluez_compatibility_interface(self):
        self.assertIn("bluetoothd --compat", BLUETOOTH_COMPAT)
        for script in (INSTALL, UPDATE):
            self.assertIn("mxg-bluetooth-compat.conf", script)
            self.assertIn("systemctl restart bluetooth.service", script)
            self.assertIn("scripts", script)
        self.assertIn('getattr(socket, "BDADDR_ANY", "00:00:00:00:00:00")', BLUETOOTH_STREAM)

    def test_kiosk_autostart_uses_a_desktop_entry_safe_exec_line(self):
        exec_line = next(line for line in DESKTOP_ENTRY.splitlines() if line.startswith("Exec="))
        self.assertEqual(exec_line, "Exec=/opt/mxg-diagnostics-kiosk/scripts/start-kiosk.sh")
        self.assertNotIn("'", exec_line)

    def test_boot_status_is_persistent_bounded_and_does_not_write_on_every_poll(self):
        for marker in (
            "mxg-boot-status.txt", "kioskService=", "controlService=", "networkManagerService=",
            "localHealth=", "wifiRadio=", "wifiState=", "ethernetState=", "last_hash",
        ):
            self.assertIn(marker, BOOT_STATUS)
        self.assertIn("http://127.0.0.1:8844/api/v1/health", BOOT_STATUS)
        self.assertNotIn("http://127.0.0.1:8844/health", BOOT_STATUS)
        self.assertIn("ProtectSystem=strict", BOOT_STATUS_SERVICE)
        self.assertIn("ReadWritePaths=/var/lib/mxg-diagnostics-kiosk /boot /boot/firmware", BOOT_STATUS_SERVICE)
        self.assertIn("mxg-boot-status.service", INSTALL)
        self.assertIn("mxg-boot-status.service", UPDATE)

    def test_local_golden_image_builder_pins_and_verifies_the_base_and_output(self):
        base_contract = (ROOT / "image" / "base-image.env").read_text(encoding="utf-8")
        for marker in ("MXG_BASE_IMAGE_URL=https://downloads.raspberrypi.com/", "MXG_BASE_IMAGE_SHA256="):
            self.assertIn(marker, base_contract)
        for marker in ("sha256sum", "losetup --find --show --partscan", "e2fsck", "fsck.vfat", "MXG_IMAGE_BUILD=1"):
            self.assertIn(marker, IMAGE_BUILDER)
        self.assertIn("Get-FileHash", IMAGE_WRAPPER)
        self.assertIn("ssh-keygen.exe", IMAGE_WRAPPER)
        self.assertNotIn("systemd.run", IMAGE_BUILDER)
        self.assertIn('rm -f "$ROOT_MOUNT/etc/xdg/autostart/piwiz.desktop"', IMAGE_BUILDER)

    def test_appliance_surface_exposes_local_connections_and_guarded_power(self):
        for marker in ('data-view="connections"', 'id="wifiScan"', 'id="bluetoothScan"', 'id="powerDialog"'):
            self.assertIn(marker, HTML)
        self.assertIn("X-MXG-Control-Token", JS)
        self.assertNotIn("wifiPassword').value, error", JS)

    def test_wifi_scan_has_visible_busy_feedback_and_saved_reconnect(self):
        css = (ROOT / "frontend" / "assets" / "kiosk.css").read_text(encoding="utf-8")
        for marker in ('class="button-spinner"', 'id="wifiScanLabel"'):
            self.assertIn(marker, HTML)
        for marker in ("button.classList.add('is-busy')", "label.textContent = 'Searching…'", "aria-busy"):
            self.assertIn(marker, JS)
        self.assertIn(".scan-button.is-busy .button-spinner", css)
        for marker in ("connection.autoconnect", "connection.autoconnect-priority", '"saved": True'):
            self.assertIn(marker, CONTROL_AGENT)
        self.assertIn("dismissAfterMs", JS)
        self.assertIn("saved for automatic reconnect`, 'success', 5000", JS)

    def test_equipment_pack_status_is_compact_and_claim_is_device_originated(self):
        for marker in ('id="equipmentPackTitle"', 'id="packPhase"', 'id="packRetry"', 'id="packClaimCode"',
                       'id="packProgress"', 'id="packUnregister"'):
            self.assertIn(marker, HTML)
        self.assertIn('Open MXGenius Settings', HTML)
        for marker in ('/api/v1/equipment-pack/status', '/api/v1/equipment-pack/claim',
                       '/api/v1/equipment-pack/reconcile', '/api/v1/equipment-pack/unregister'):
            self.assertIn(marker, JS)
        self.assertNotIn('id="packEnrollCode"', HTML)
        self.assertNotIn("status.credential", JS)
        for marker in ("activePackName", "activeVersionNumber", "LOADED PACK"):
            self.assertIn(marker, JS + HTML)

    def test_equipment_pack_cloud_is_preconfigured_for_appliance_enrollment(self):
        for script in (INSTALL, UPDATE):
            self.assertIn('ensure_env MXG_EDGE_PACKS_ENABLED 1', script)
            self.assertIn(
                'ensure_env MXG_EDGE_CORE_URL https://mxg-core.kindbush-8fee3a17.centralus.azurecontainerapps.io',
                script,
            )

    def test_appliance_install_includes_deterministic_recovery_services(self):
        for package in ("curl", "avahi-daemon", "openssh-server"):
            self.assertIn(package, INSTALL)
            self.assertIn(package, UPDATE)
        self.assertIn("MXG_IMAGE_BUILD", INSTALL)
        for script in (INSTALL, UPDATE):
            self.assertIn("systemctl enable bluetooth.service avahi-daemon.service ssh.service", script)
            self.assertIn("systemctl disable NetworkManager-wait-online.service", script)
            self.assertNotIn("rpi-splash-screen-support", script)
            self.assertNotIn("imagemagick", script)

    def test_incremental_update_preserves_the_complete_boot_contract(self):
        for marker in (
            'install -m 0644 "$INSTALL_DIR/systemd/mxg-boot-status.service"',
            '"$INSTALL_DIR/scripts/boot-status.sh"',
            '"$INSTALL_DIR/scripts/start-kiosk.sh"',
            "systemctl restart mxg-boot-status.service",
        ):
            self.assertIn(marker, UPDATE)

    def test_wired_recovery_keeps_dhcp_and_adds_link_local_addressing(self):
        for marker in (
            "/etc/NetworkManager/conf.d/90-mxgenius-wired-recovery.conf",
            "match-device=type:ethernet",
            "ipv4.link-local=enabled",
            "ipv4.may-fail=true",
        ):
            self.assertIn(marker, APPLIANCE_CONFIG)
        self.assertNotIn("ipv4.method=shared", APPLIANCE_CONFIG)

    def test_kiosk_boot_is_offline_first_and_has_one_display_owner(self):
        self.assertIn("After=network.target", KIOSK_SERVICE)
        self.assertNotIn("network-online.target", KIOSK_SERVICE)
        for marker in ("fullscreen_logo", "fullscreen_logo_name", "splash"):
            self.assertIn(marker, APPLIANCE_CONFIG)
            self.assertIn(marker, SD_COMMISSION)
        self.assertNotIn("configure-splash", APPLIANCE_CONFIG)
        self.assertNotIn("wlr-randr", KIOSK_START)

    def test_software_update_is_prepared_before_cutover_and_rolls_back_on_failed_health(self):
        self.assertLess(UPDATE.index('python3 -m venv "$NEXT_DIR/venv"'), UPDATE.index('mv "$NEXT_DIR" "$INSTALL_DIR"'))
        for marker in ('PREVIOUS_DIR=', 'rollback_on_error()', 'restoring the last known working appliance release', '/api/v1/health'):
            self.assertIn(marker, UPDATE)

    def test_appliance_diagnostic_covers_boot_services_identity_cloud_and_usb_without_secrets(self):
        for marker in ('systemd.run=', 'NetworkManager.service', 'mxg-boot-status.service',
                       '90-mxgenius-wired-recovery.conf', 'mxg-diagnostics-kiosk.service', 'mxg-device-identity.json',
                       '/api/v1/equipment-pack/status', '/sys/class/udc', '/usb_gadget/mxgenius/UDC'):
            self.assertIn(marker, APPLIANCE_DIAGNOSTIC)
        self.assertNotIn('mxg-diagnostics-kiosk.env', APPLIANCE_DIAGNOSTIC)

    def test_sd_commissioning_cannot_install_an_application_or_change_the_boot_target(self):
        self.assertIn("systemd\\.run=\\S+", SD_COMMISSION)
        self.assertIn("mxg-device-identity", (ROOT / "scripts" / "provision-device-identity.ps1").read_text(encoding="utf-8"))
        for forbidden in ('release-files.txt', "Join-Path $root 'firstrun.sh'", 'Staged MXG diagnostics kiosk'):
            self.assertNotIn(forbidden, SD_COMMISSION)

    def test_local_control_session_does_not_block_enrollment_on_the_root_broker(self):
        app_source = (ROOT / "backend" / "app.py").read_text(encoding="utf-8")
        self.assertIn('asyncio.wait_for(request_control("status"), timeout=3.0)', app_source)
        self.assertIn('except (ControlUnavailable, asyncio.TimeoutError):', app_source)

    def test_privileged_control_plane_is_allow_listed_and_separate(self):
        self.assertIn("User=root", CONTROL_SERVICE)
        self.assertIn("Group=mxgdiag", CONTROL_SERVICE)
        self.assertIn("ProtectSystem=strict", CONTROL_SERVICE)
        self.assertNotIn("shell=True", CONTROL_AGENT)
        self.assertIn('action == "poweroff"', CONTROL_AGENT)

    def test_appliance_boot_enables_autologin_and_keeps_branding_in_the_web_ui(self):
        self.assertIn("do_boot_behaviour B4", APPLIANCE_CONFIG)
        self.assertIn("The branded boot experience is owned by the local web application", APPLIANCE_CONFIG)
        self.assertIn("boot-brand", HTML)


if __name__ == "__main__":
    unittest.main()
