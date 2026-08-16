package io.mxgenius.sensorbridge;

import android.graphics.Bitmap;
import android.os.SystemClock;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

final class MxgsFrameEncoder {
    private static final int HEADER_BYTES = 24;

    private MxgsFrameEncoder() {}

    static byte[] jpeg(Bitmap bitmap, String sessionId) throws JSONException {
        ByteArrayOutputStream pixels = new ByteArrayOutputStream();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 78, pixels)) {
            throw new IllegalStateException("Unable to encode the thermal frame.");
        }
        byte[] metadata = new JSONObject()
                .put("sessionId", sessionId)
                .put("sourceType", "flir-one-pro")
                .put("sdkVersion", BuildConfig.FLIR_SDK_VERSION)
                .put("radiometric", false)
                .toString()
                .getBytes(StandardCharsets.UTF_8);
        byte[] payload = pixels.toByteArray();
        ByteBuffer frame = ByteBuffer.allocate(HEADER_BYTES + metadata.length + payload.length)
                .order(ByteOrder.LITTLE_ENDIAN);
        frame.put(new byte[] { 'M', 'X', 'G', 'S' });
        frame.put((byte) 1); // MXGS version
        frame.put((byte) 1); // thermal frame
        frame.put((byte) 1); // JPEG
        frame.put((byte) 0); // flags
        frame.putShort((short) bitmap.getWidth());
        frame.putShort((short) bitmap.getHeight());
        frame.putLong(SystemClock.elapsedRealtimeNanos());
        frame.putInt(metadata.length);
        frame.put(metadata);
        frame.put(payload);
        return frame.array();
    }
}
