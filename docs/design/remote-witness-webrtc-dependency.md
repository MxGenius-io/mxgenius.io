# Remote Witness Android WebRTC dependency

## Pinned artifact

- Coordinate: `io.github.webrtc-sdk:android:150.7871.01`
- Origin: <https://github.com/webrtc-sdk/android>
- Distribution: Maven Central
- AAR size: `49,147,033` bytes
- AAR SHA-256: `0a1627b1a48c2bc17d9a40d62fc47bd45166f44a311e95917f147c402de379b0`
- POM SHA-256: `b740a6bec98f078892a70ee502404eb7b437feb0ef4a7fa74b4561ae25db553c`
- Maven transitives: none
- Wrapper repository license: MIT
- Published POM and bundled WebRTC license declaration: BSD 3-Clause. The
  upstream project maintains the full WebRTC third-party notice set at
  <https://github.com/webrtc-sdk/android/blob/main/Licenses/WEBRTC.md>.

The source AAR contains `armeabi-v7a`, `arm64-v8a`, `x86`, and `x86_64` native
libraries. The companion app keeps its existing `arm64-v8a` ABI filter, and the
release verifier rejects any APK containing another ABI.

The minified Alpha 20 APK is `176,491,178` bytes, an increase of `12,681,534`
bytes over Alpha 19 after ARM64-only packaging.

## Capture and codec posture

- `ScreenCapturerAndroid` connects the MediaProjection surface to WebRTC's
  texture-backed capturer; application code does not read pixels back to the CPU.
- The producer uses `HardwareVideoEncoderFactory`, not WebRTC's software encoder
  factory. H.264 is preferred through codec preferences when the device reports
  it, while the runtime keeps other device-supported hardware codecs as a
  compatibility fallback.
- The first profile is video-only `1280x720` at `15 fps`, with a sender range of
  `350 kbps` to `2.5 Mbps`. No microphone permission, audio source, or audio track
  is present.
- Connection statistics report the negotiated outbound codec, encoded frames,
  and sent bytes every five seconds. Hardware H.264 selection is a physical Quest
  acceptance item; a desktop build cannot prove the headset MediaCodec choice.

## Update procedure

1. Confirm the proposed coordinate in the project's release notes and source
   repository, then update only the pinned version in `app/build.gradle.kts`.
2. Resolve `debugRuntimeClasspath`; record the new AAR/POM sizes, SHA-256 values,
   licenses, and dependency tree here.
3. Build debug and minified release APKs. Run `verify-release.ps1` and confirm the
   APK still contains only `arm64-v8a` plus exactly one
   `libjingle_peerconnection_so.so`.
4. On Quest, grant fresh MediaProjection consent, connect the browser viewer,
   and record the outbound codec from the native stats trace. Reject the update
   if H.264 falls back to software or if FLIR/snapshot behavior regresses.
5. Upload the exact verified APK to Alpha and wait for Meta automated checks
   before changing this record's accepted version.
