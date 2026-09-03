package io.mxgenius.sensorbridge;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Strict decoder for the bounded SVG QR shape produced by mxg-core. */
final class RemoteWitnessQrCode {
    private static final String PREFIX = "data:image/svg+xml;base64,";
    private static final int MAX_DATA_URL_CHARS = 32 * 1024;
    private static final Pattern VIEW_BOX = Pattern.compile("viewBox=\"0 0 (\\d{2,3}) \\1\"");
    private static final Pattern MODULE = Pattern.compile("M(\\d{1,3}) (\\d{1,3})h1v1h-1z");

    private RemoteWitnessQrCode() {}

    static boolean[][] decode(String dataUrl) {
        if (dataUrl == null || !dataUrl.startsWith(PREFIX) || dataUrl.length() > MAX_DATA_URL_CHARS) {
            throw new IllegalArgumentException("invalid witness QR data");
        }
        final String svg;
        try {
            svg = new String(Base64.getDecoder().decode(dataUrl.substring(PREFIX.length())), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            throw new IllegalArgumentException("invalid witness QR encoding", error);
        }
        if (!svg.startsWith("<svg ") || !svg.contains("shape-rendering=\"crispEdges\"")
                || !svg.contains("fill=\"#fff\"") || !svg.contains("fill=\"#000\"")) {
            throw new IllegalArgumentException("unsupported witness QR image");
        }
        Matcher box = VIEW_BOX.matcher(svg);
        if (!box.find()) throw new IllegalArgumentException("witness QR has no bounded view box");
        int size = Integer.parseInt(box.group(1));
        if (size < 29 || size > 177) throw new IllegalArgumentException("witness QR dimensions are invalid");
        boolean[][] modules = new boolean[size][size];
        Matcher module = MODULE.matcher(svg);
        int count = 0;
        while (module.find()) {
            int x = Integer.parseInt(module.group(1));
            int y = Integer.parseInt(module.group(2));
            if (x < 0 || y < 0 || x >= size || y >= size) {
                throw new IllegalArgumentException("witness QR module is outside its view box");
            }
            modules[y][x] = true;
            count += 1;
        }
        if (count < 100) throw new IllegalArgumentException("witness QR contains too few modules");
        return modules;
    }
}
