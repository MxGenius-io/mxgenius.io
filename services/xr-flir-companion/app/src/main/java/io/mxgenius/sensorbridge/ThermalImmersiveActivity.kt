package io.mxgenius.sensorbridge

import android.Manifest
import android.app.PendingIntent
import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.SpatialFeature
import com.meta.spatial.runtime.ReferenceSpace
import com.meta.spatial.toolkit.AppSystemActivity
import com.meta.spatial.toolkit.DpDisplayOptions
import com.meta.spatial.toolkit.Grabbable
import com.meta.spatial.toolkit.GrabbableType
import com.meta.spatial.toolkit.LayoutXMLPanelRegistration
import com.meta.spatial.toolkit.Panel
import com.meta.spatial.toolkit.PanelRegistration
import com.meta.spatial.toolkit.PanelStyleOptions
import com.meta.spatial.toolkit.QuadShapeOptions
import com.meta.spatial.toolkit.Transform
import com.meta.spatial.toolkit.UIPanelSettings
import com.meta.spatial.vr.LocomotionSystem
import com.meta.spatial.vr.VRFeature
import java.util.concurrent.atomic.AtomicBoolean

class ThermalImmersiveActivity : AppSystemActivity(), SensorBridgeService.StatusListener {
    companion object {
        private const val HEADSET_CAMERA_PERMISSION_REQUEST = 4211
        private const val WITNESS_PROJECTION_REQUEST = 4212
    }

    private val followHead = AtomicBoolean(true)
    private var bridgeService: SensorBridgeService? = null
    private var bound = false
    private var connectRequested = false
    private var panelRoot: View? = null
    private var sceneReady = false
    private var panelReadyTraced = false
    private var latestBitmap: Bitmap? = null
    private var bridgeState = "starting"
    private var relayState = "native spatial"
    private var cameraState = "standby"
    private var commissioningState = "NOT RUN · press RUN FULL DIAGNOSTIC"
    private var witnessState = "NO ACTIVE INVITATION"
    private var witnessUiState = RemoteWitnessUiState.EMPTY
    private var renderedWitnessQr: String? = null
    private var commissioningHandoffStarted = false

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            bridgeService = (binder as SensorBridgeService.LocalBinder).service()
            bound = true
            bridgeService?.setStatusListener(this@ThermalImmersiveActivity)
            if (hasHeadsetCameraPermissions()) bridgeService?.prepareHeadsetCamera()
            tracePanelReadyIfPossible()
            renderPanel()
        }

        override fun onServiceDisconnected(name: ComponentName) {
            bound = false
            bridgeService = null
            bridgeState = "service stopped"
            cameraState = "service stopped"
            renderPanel()
        }
    }

    override fun registerFeatures(): List<SpatialFeature> = listOf(VRFeature(this))

    override fun registerPanels(): List<PanelRegistration> = listOf(
        LayoutXMLPanelRegistration(
            R.id.thermal_spatial_panel,
            layoutIdCreator = { R.layout.immersive_thermal_panel },
            settingsCreator = {
                UIPanelSettings(
                    shape = QuadShapeOptions(width = 0.98f, height = 0.88f),
                    display = DpDisplayOptions(width = 560f, height = 520f, dpi = 600),
                    style = PanelStyleOptions(themeResourceId = R.style.SpatialPanelTheme),
                )
            },
            panelSetupWithRootView = { rootView, _, _ ->
                panelRoot = rootView
                rootView.findViewById<Button>(R.id.immersive_pin_toggle).setOnClickListener {
                    val nowFollowing = !followHead.get()
                    followHead.set(nowFollowing)
                    bridgeService?.recordTrace(
                        "N17",
                        "SPATIAL",
                        if (nowFollowing) "follow-head" else "pinned",
                        if (nowFollowing) "thermal panel resumed head-relative placement" else "thermal panel frozen in world space",
                        "info",
                    )
                    renderPanel()
                }
                rootView.findViewById<Button>(R.id.immersive_reconnect).setOnClickListener {
                    connectRequested = true
                    bridgeService?.reconnectCamera(this)
                }
                rootView.findViewById<Button>(R.id.immersive_commission).setOnClickListener {
                    bridgeService?.startCommissioning(this)
                }
                rootView.findViewById<Button>(R.id.immersive_arm_snapshot).setOnClickListener {
                    requestHeadsetCameraPermissionsIfNeeded()
                }
                rootView.findViewById<Button>(R.id.immersive_witness_capture).setOnClickListener {
                    requestWitnessProjection(false)
                }
                rootView.findViewById<Button>(R.id.immersive_witness_pause).setOnClickListener {
                    bridgeService?.pauseWitness()
                    renderPanel()
                }
                rootView.findViewById<Button>(R.id.immersive_witness_resume).setOnClickListener {
                    requestWitnessProjection(true)
                }
                rootView.findViewById<Button>(R.id.immersive_witness_end).setOnClickListener {
                    bridgeService?.endWitness()
                    renderPanel()
                }
                rootView.findViewById<Button>(R.id.immersive_witness_layers_toggle).setOnClickListener {
                    bridgeService?.toggleWitnessExtras()
                    renderPanel()
                }
                rootView.findViewById<Button>(R.id.immersive_panel_mode).setOnClickListener {
                    launchPanelModeInHome()
                }
                renderPanel()
            },
        ),
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        systemManager.unregisterSystem<LocomotionSystem>()
        systemManager.registerSystem(
            ThermalPanelFollowSystem(R.id.thermal_spatial_panel, followHead),
        )

        val serviceIntent = Intent(this, SensorBridgeService::class.java)
        intent.extras?.let(serviceIntent::putExtras)
        startForegroundService(serviceIntent)
    }

    override fun onStart() {
        super.onStart()
        bindService(
            Intent(this, SensorBridgeService::class.java),
            connection,
            Context.BIND_AUTO_CREATE,
        )
    }

    override fun onStop() {
        if (bound) {
            bridgeService?.clearStatusListener(this)
            unbindService(connection)
            bound = false
        }
        super.onStop()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != HEADSET_CAMERA_PERMISSION_REQUEST) return
        val granted = hasHeadsetCameraPermissions()
        if (granted) bridgeService?.prepareHeadsetCamera()
        bridgeService?.recordTrace(
            "N21",
            "SNAPSHOT",
            if (granted) "permission-granted" else "permission-denied",
            if (granted) "Quest RGB snapshot permissions granted" else "Quest RGB snapshot permissions denied; thermal remains available",
            if (granted) "success" else "warn",
        )
        renderPanel()
    }

    @Deprecated("MediaProjection still returns through the platform activity result on Horizon OS")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != WITNESS_PROJECTION_REQUEST) return
        if (resultCode == Activity.RESULT_OK && data != null) {
            bridgeService?.startWitnessCapture(resultCode, data)
        } else {
            bridgeService?.projectionConsentDenied()
        }
        renderPanel()
    }

    override fun onSceneReady() {
        super.onSceneReady()
        sceneReady = true
        scene.enablePassthrough(true)
        scene.setReferenceSpace(ReferenceSpace.LOCAL)
        val initialPose = ThermalPanelFollowSystem.panelPoseFor(scene.getViewerPose())
        Entity.create(
            listOf(
                Panel(R.id.thermal_spatial_panel),
                Transform(initialPose),
                Grabbable(
                    type = GrabbableType.PIVOT_Y,
                    minHeight = 0.45f,
                    maxHeight = 2.6f,
                ),
            ),
        )
        tracePanelReadyIfPossible()
    }

    override fun onStatus(bridge: String, relay: String, camera: String) {
        bridgeState = bridge
        relayState = relay
        cameraState = camera
        val cameraIdle = camera !in setOf("streaming", "connecting", "discovering", "waiting-usb", "permission-required", "reconnecting")
        if (!connectRequested && bridge.startsWith("ready") && cameraIdle) {
            connectRequested = true
            bridgeService?.connectCamera(this)
        }
        renderPanel()
    }

    override fun onFrame(bitmap: Bitmap) {
        latestBitmap = bitmap
        connectRequested = true
        val root = panelRoot ?: return
        runOnUiThread {
            root.findViewById<ImageView>(R.id.immersive_thermal_preview).setImageBitmap(bitmap)
        }
    }

    override fun onTrace(entries: List<String>) {
        renderPanel()
    }

    override fun onCommissioning(summary: String) {
        commissioningState = summary
        renderPanel()
        if (summary.startsWith("NATIVE PASS") && !commissioningHandoffStarted) {
            commissioningHandoffStarted = true
            runOnUiThread { launchCommissioningBrowserHandoff() }
        }
    }

    override fun onWitness(summary: String) {
        witnessState = summary
        renderPanel()
    }

    override fun onWitness(state: RemoteWitnessUiState) {
        witnessUiState = state
        renderPanel()
    }

    private fun renderPanel() {
        val root = panelRoot ?: return
        runOnUiThread {
            latestBitmap?.let { root.findViewById<ImageView>(R.id.immersive_thermal_preview).setImageBitmap(it) }
            root.findViewById<TextView>(R.id.immersive_session_status).text =
                "SESSION ${bridgeService?.sessionId()?.take(12) ?: "STANDALONE"}"
            root.findViewById<TextView>(R.id.immersive_camera_status).text = "FLIR ONE · $cameraState"
            root.findViewById<TextView>(R.id.immersive_bridge_status).text =
                "Native spatial bridge · $bridgeState · optional transport $relayState"
            root.findViewById<TextView>(R.id.immersive_commission_status).text =
                "COMMISSIONING · $commissioningState"
            root.findViewById<TextView>(R.id.immersive_witness_status).text =
                "CUSTOMER VIEW · ${witnessUiState.phase(System.currentTimeMillis()).name}"
            root.findViewById<TextView>(R.id.immersive_witness_audience).text =
                "Audience · ${witnessUiState.audience}"
            root.findViewById<TextView>(R.id.immersive_witness_code).text =
                "JOIN CODE · ${formatJoinCode(witnessUiState.manualCode)}"
            root.findViewById<TextView>(R.id.immersive_witness_detail).text =
                "${witnessUiState.viewerCount} ${if (witnessUiState.viewerCount == 1) "viewer" else "viewers"}" +
                    " · ${witnessUiState.networkState.replace('-', ' ')} · ${formatExpiry(witnessUiState.expiresAtMs)}"
            root.findViewById<TextView>(R.id.immersive_witness_layers).text = witnessUiState.layersSummary()
            root.findViewById<TextView>(R.id.immersive_witness_recording).text =
                "RECORDING · ${witnessUiState.recordingState.uppercase()}"
            root.findViewById<TextView>(R.id.immersive_witness_error).apply {
                text = witnessUiState.error ?: ""
                visibility = if (witnessUiState.error.isNullOrBlank()) View.GONE else View.VISIBLE
            }
            renderWitnessQr(root)
            root.findViewById<Button>(R.id.immersive_commission).apply {
                isEnabled = bridgeService?.canConnectCamera() == true && bridgeService?.commissioningRunning() != true
                text = if (bridgeService?.commissioningRunning() == true) "DIAGNOSTIC RUNNING…" else "RUN FULL DIAGNOSTIC"
            }
            root.findViewById<Button>(R.id.immersive_arm_snapshot).apply {
                isEnabled = bridgeService != null && bridgeService?.headsetCameraArmed() != true
                text = if (bridgeService?.headsetCameraArmed() == true) "RGB SNAPSHOT ARMED" else "ARM RGB SNAPSHOT"
            }
            root.findViewById<Button>(R.id.immersive_witness_capture).apply {
                isEnabled = witnessUiState.canStart(System.currentTimeMillis())
                text = "START"
            }
            root.findViewById<Button>(R.id.immersive_witness_pause).isEnabled =
                witnessUiState.canPause(System.currentTimeMillis())
            root.findViewById<Button>(R.id.immersive_witness_resume).isEnabled =
                witnessUiState.canResume(System.currentTimeMillis())
            root.findViewById<Button>(R.id.immersive_witness_end).isEnabled =
                witnessUiState.canEnd(System.currentTimeMillis())
            root.findViewById<Button>(R.id.immersive_witness_layers_toggle).apply {
                isEnabled = witnessUiState.canEnd(System.currentTimeMillis())
                text = if (witnessUiState.thermal || witnessUiState.caseMedia) {
                    "HIDE THERMAL + CASE MEDIA"
                } else {
                    "SHARE THERMAL + CASE MEDIA"
                }
            }
            root.findViewById<Button>(R.id.immersive_pin_toggle).text =
                if (followHead.get()) "PIN HERE" else "FOLLOW HEAD"
            root.findViewById<Button>(R.id.immersive_reconnect).isEnabled =
                cameraState !in setOf("connecting", "discovering", "waiting-usb", "permission-required", "reconnecting")
        }
    }

    private fun tracePanelReadyIfPossible() {
        val service = bridgeService ?: return
        if (!sceneReady || panelReadyTraced) return
        panelReadyTraced = true
        service.recordTrace(
            "N16",
            "SPATIAL",
            "ready",
            "native immersive panel created; browser transport is no longer on the frame path",
            "success",
        )
    }

    private fun hasHeadsetCameraPermissions(): Boolean =
        checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(HeadsetSnapshotController.HEADSET_CAMERA_PERMISSION) == PackageManager.PERMISSION_GRANTED

    private fun requestHeadsetCameraPermissionsIfNeeded() {
        if (hasHeadsetCameraPermissions()) {
            bridgeService?.prepareHeadsetCamera()
            renderPanel()
            return
        }
        requestPermissions(
            arrayOf(Manifest.permission.CAMERA, HeadsetSnapshotController.HEADSET_CAMERA_PERMISSION),
            HEADSET_CAMERA_PERMISSION_REQUEST,
        )
    }

    private fun requestWitnessProjection(resume: Boolean) {
        val service = bridgeService ?: return
        if (!service.canRequestWitnessCapture() || !service.beginWitnessStart(resume)) {
            service.recordTrace("W30", "WITNESS", "blocked", "customer view is not ready for compositor consent", "warn")
            renderPanel()
            return
        }
        val manager = getSystemService(MediaProjectionManager::class.java)
        service.recordTrace("W30", "WITNESS", "consent-requested", "wearer opened the Horizon compositor sharing prompt", "info")
        startActivityForResult(manager.createScreenCaptureIntent(), WITNESS_PROJECTION_REQUEST)
    }

    private fun renderWitnessQr(root: View) {
        val target = root.findViewById<ImageView>(R.id.immersive_witness_qr)
        val dataUrl = witnessUiState.qrDataUrl
        if (dataUrl.isNullOrBlank()) {
            target.visibility = View.GONE
            target.setImageDrawable(null)
            renderedWitnessQr = null
            return
        }
        if (renderedWitnessQr == dataUrl) return
        try {
            val modules = RemoteWitnessQrCode.decode(dataUrl)
            val scale = maxOf(2, 480 / modules.size)
            val bitmap = Bitmap.createBitmap(modules.size * scale, modules.size * scale, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            for (y in modules.indices) {
                for (x in modules[y].indices) {
                    if (!modules[y][x]) continue
                    for (dy in 0 until scale) for (dx in 0 until scale) {
                        bitmap.setPixel(x * scale + dx, y * scale + dy, Color.BLACK)
                    }
                }
            }
            target.setImageBitmap(bitmap)
            target.visibility = View.VISIBLE
            renderedWitnessQr = dataUrl
        } catch (_: IllegalArgumentException) {
            target.visibility = View.GONE
            target.setImageDrawable(null)
            renderedWitnessQr = null
        }
    }

    private fun formatJoinCode(code: String?): String {
        if (code.isNullOrBlank() || code.length != 12) return "—"
        return code.chunked(4).joinToString(" ")
    }

    private fun formatExpiry(expiresAtMs: Long): String {
        if (expiresAtMs <= 0L) return "expires —"
        val remainingMinutes = ((expiresAtMs - System.currentTimeMillis()).coerceAtLeast(0L) + 59_999L) / 60_000L
        return if (remainingMinutes >= 60L) {
            "expires in ${remainingMinutes / 60L}h ${remainingMinutes % 60L}m"
        } else {
            "expires in ${remainingMinutes}m"
        }
    }

    private fun launchPanelModeInHome() {
        bridgeService?.recordTrace(
            "N19",
            "SPATIAL",
            "panel-mode",
            "returning the live thermal viewer to the Horizon OS 2D panel",
            "info",
        )
        val panelIntent = Intent(applicationContext, MainActivity::class.java).apply {
            action = Intent.ACTION_MAIN
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        val pendingPanelIntent = PendingIntent.getActivity(
            applicationContext,
            0,
            panelIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val homeIntent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_HOME)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("extra_launch_in_home_pending_intent", pendingPanelIntent)
        startActivity(homeIntent)
        finish()
    }

    private fun launchCommissioningBrowserHandoff() {
        val handoffUrl = bridgeService?.browserHandoffUrl()
        if (handoffUrl.isNullOrBlank()) {
            commissioningHandoffStarted = false
            bridgeService?.recordTrace(
                "C00",
                "COMMISSION",
                "browser-handoff",
                "native soak passed but no authenticated browser handoff was available",
                "error",
            )
            return
        }
        bridgeService?.recordTrace(
            "C04",
            "COMMISSION",
            "browser-handoff",
            "native soak passed; reopening the authenticated Meta Browser scene",
            "success",
        )
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(handoffUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }
}
