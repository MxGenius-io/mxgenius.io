package io.mxgenius.sensorbridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

public final class PiDiagnosticsClientTest {
    @Test public void readsPiLengthPrefixedDiagnosticsState() throws Exception {
        String json = "{\"type\":\"diagnostics.state\",\"schema\":\"mxg.edge.diagnostics\",\"sequence\":4}";
        JSONObject message = PiDiagnosticsClient.readMessage(frame(json));
        assertEquals("diagnostics.state", message.getString("type"));
        assertEquals(4, message.getInt("sequence"));
    }

    @Test public void rejectsOversizedPiMessage() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        new DataOutputStream(bytes).writeInt((1024 * 1024) + 1);
        assertThrows(IOException.class, () -> PiDiagnosticsClient.readMessage(
                new DataInputStream(new ByteArrayInputStream(bytes.toByteArray()))));
    }

    @Test public void rejectsNonDiagnosticJson() throws Exception {
        String json = "{\"type\":\"source.status\",\"schema\":\"mxg.edge.diagnostics\"}";
        assertThrows(JSONException.class, () -> PiDiagnosticsClient.readMessage(frame(json)));
    }

    private static DataInputStream frame(String json) throws IOException {
        byte[] payload = json.getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream output = new DataOutputStream(bytes);
        output.writeInt(payload.length);
        output.write(payload);
        return new DataInputStream(new ByteArrayInputStream(bytes.toByteArray()));
    }
}
