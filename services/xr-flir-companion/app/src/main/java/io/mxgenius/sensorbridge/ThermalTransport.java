package io.mxgenius.sensorbridge;

import android.graphics.Bitmap;

interface ThermalTransport {
    String label();
    void sendSourceStatus(String status, String reason);
    void sendFrame(Bitmap bitmap);
    void close();
}
