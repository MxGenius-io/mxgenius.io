package io.mxgenius.sensorbridge

import android.Manifest
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.IBinder
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.ScrollView
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
    }

    private val followHead = AtomicBoolean(true)
    private var bridgeService: SensorBridgeService? = null
    private var bound = false
    private var connectRequested = false
    private var panelRoot: View? = null
    private var sceneReady = false
    private var panelReadyTraced = false
    private var latestBitmap: Bitmap? = null
    private var latestTrace: List<String> = emptyList()
    private var bridgeState = "starting"
    private var relayState = "native spatial"
    private var cameraState = "standby"
    private var commissioningState = "NOT RUN · press RUN FULL DIAGNOSTIC"
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
                    shape = QuadShapeOptions(width = 0.98f, height = 0.74f),
                    display = DpDisplayOptions(width = 560f, height = 420f, dpi = 600),
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
        val cameraIdle = camera !in setOf("streaming", "connecting", "discovering", "permission-required", "reconnecting")
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
        latestTrace = entries
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
            root.findViewById<Button>(R.id.immersive_commission).apply {
                isEnabled = bridgeService?.canConnectCamera() == true && bridgeService?.commissioningRunning() != true
                text = if (bridgeService?.commissioningRunning() == true) "DIAGNOSTIC RUNNING…" else "RUN FULL DIAGNOSTIC"
            }
            root.findViewById<Button>(R.id.immersive_arm_snapshot).apply {
                isEnabled = bridgeService != null && bridgeService?.headsetCameraArmed() != true
                text = if (bridgeService?.headsetCameraArmed() == true) "RGB SNAPSHOT ARMED" else "ARM RGB SNAPSHOT"
            }
            root.findViewById<Button>(R.id.immersive_pin_toggle).text =
                if (followHead.get()) "PIN HERE" else "FOLLOW HEAD"
            root.findViewById<Button>(R.id.immersive_reconnect).isEnabled =
                cameraState !in setOf("connecting", "discovering", "permission-required", "reconnecting")
            root.findViewById<TextView>(R.id.immersive_trace).text =
                latestTrace.takeLast(18).joinToString("\n").ifBlank { "Waiting for bridge trace…" }
            root.findViewById<ScrollView>(R.id.immersive_trace_scroll).post {
                root.findViewById<ScrollView>(R.id.immersive_trace_scroll).fullScroll(View.FOCUS_DOWN)
            }
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
