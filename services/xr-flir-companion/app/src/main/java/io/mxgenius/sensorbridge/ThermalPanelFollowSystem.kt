package io.mxgenius.sensorbridge

import com.meta.spatial.core.Entity
import com.meta.spatial.core.Pose
import com.meta.spatial.core.Quaternion
import com.meta.spatial.core.SystemBase
import com.meta.spatial.core.Vector3
import com.meta.spatial.toolkit.Transform
import java.util.concurrent.atomic.AtomicBoolean

internal class ThermalPanelFollowSystem(
    private val panelEntityId: Int,
    private val followHead: AtomicBoolean,
) : SystemBase() {
    override fun execute() {
        if (!followHead.get()) return
        val viewerPose = getScene()?.getViewerPose() ?: return
        if (viewerPose == Pose()) return
        Entity(panelEntityId).setComponent(Transform(panelPoseFor(viewerPose)))
    }

    companion object {
        fun panelPoseFor(viewerPose: Pose): Pose {
            val headRelativeOffset = viewerPose.q * Vector3(0f, 0.04f, 1.15f)
            return Pose(
                viewerPose.t + headRelativeOffset,
                Quaternion.lookRotationAroundY(headRelativeOffset),
            )
        }
    }
}
